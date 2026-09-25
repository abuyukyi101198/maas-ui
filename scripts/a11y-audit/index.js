#!/usr/bin/env node
/*
 * a11y-audit — accessibility audit for the MAAS UI.
 *
 * Detects the major sections from the live main navigation and lets you choose
 * which sections to audit (or pass --sections / --all). Each chosen section is
 * crawled breadth-first; every page is captured once while loaded: its
 * Chromium accessibility tree, axe-core results, optional keyboard checks and
 * (with --interactions) the UI its known triggers open. A local Ollama model
 * (default: llama3) then reviews a pruned outline of each view for
 * context-dependent issues that a rule engine can't judge. Findings are
 * grounded against the outline the model saw, annotated with a confidence
 * level, de-duplicated across views, and written to the console, an optional
 * Markdown report and a JSON file.
 *
 * Usage: yarn a11y-audit <url> -u <username> [options]   (see docs/A11Y_AUDIT.md)
 */

import inquirer from "inquirer";
import pc from "picocolors";
import { chromium } from "playwright";

import { axeElementKey, axeFinding, loadAxeSource } from "./axe.js";
import { capturePage } from "./capture.js";
import { MAX_CONTEXT_FINDINGS, sortFindings } from "./constants.js";
import {
  authenticate,
  buildAuthCookies,
  crawlSection,
  createPagePool,
  createSimilarityFilter,
  detectMajorRoutes,
  routePattern,
  sectionPrefix,
} from "./crawl.js";
import {
  annotateContextFindings,
  applyVerification,
  collectOutlineText,
  isGroundedFinding,
} from "./grounding.js";
import { loadInteractionConfig } from "./interactions.js";
import {
  buildSystemPrompt,
  buildUserMessage,
  checkOllama,
  loadAllowLabels,
  resolveNumCtx,
  runContextChecks,
  verifyContextFinding,
} from "./llm.js";
import { parseOptions } from "./options.js";
import {
  capOutlineToContext,
  chromeSignatures,
  estimateTokens,
  preprocessTree,
  pruneChromeByOwner,
  treeToOutline,
} from "./prune.js";
import {
  countAtOrAbove,
  formatContextWindow,
  formatFindingsForConsole,
  formatUsage,
  printCapturedContents,
  printSummary,
  withSpinner,
  writeJsonReport,
  writeMarkdownReport,
} from "./report.js";
import {
  createLimiter,
  errorMessage,
  mapPool,
  retry,
  runAbort,
  throwIfAborted,
} from "./util.js";

const { opts, startUrl } = parseOptions(process.argv);

// An error whose message is the whole story (no stack trace needed).
function userError(message) {
  const err = new Error(message);
  err.expected = true;
  return err;
}

/* ---- Setup ---------------------------------------------------------- */

// The start URL is either the MAAS origin (any path above the UI base, e.g.
// http://host:5240/MAAS) or a page under the UI base, which then becomes the
// section to audit (e.g. http://host:5240/MAAS/r/machines).
function resolveStart(url, appBase) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw userError(`Invalid URL: ${url}`);
  }
  const path = u.pathname.replace(/\/+$/, "");
  if (path === "" || path === appBase || appBase.startsWith(`${path}/`)) {
    return { origin: u.origin, startRoute: null };
  }
  if (path.startsWith(`${appBase}/`)) {
    return {
      origin: u.origin,
      startRoute: path.slice(appBase.length) + u.search,
    };
  }
  throw userError(
    `The URL path ${path} is not under the MAAS UI base ${appBase} ` +
      `(--basename ${opts.basename} --ui-base ${opts.uiBase}). Pass the MAAS ` +
      `origin (e.g. ${u.origin}) or a page under ${u.origin}${appBase}/.`
  );
}

// Resolve the MAAS password without requiring it on the command line: prefer
// MAAS_PASSWORD, fall back to -p (with a warning), then a hidden prompt.
async function resolvePassword() {
  if (process.env.MAAS_PASSWORD) return process.env.MAAS_PASSWORD;
  if (opts.password) {
    console.log(
      pc.yellow(
        "  ! Passing the password with -p exposes it in shell history and " +
          "the process list; prefer the MAAS_PASSWORD environment variable."
      )
    );
    return opts.password;
  }
  if (opts.yes || !process.stdin.isTTY) {
    throw userError(
      "No password provided. Set MAAS_PASSWORD (or pass -p) when not " +
        "running interactively."
    );
  }
  const { password } = await inquirer.prompt([
    {
      type: "password",
      name: "password",
      mask: "*",
      message: `MAAS password for ${opts.username}:`,
      validate: (value) => (value ? true : "A password is required."),
    },
  ]);
  return password;
}

// Map a --sections entry (a label such as "Devices", or a path such as
// /devices or /machine/abc/summary) to a section to crawl.
function matchSection(ref, majorRoutes) {
  const low = ref.toLowerCase();
  const byLabel = majorRoutes.find((r) => r.label.toLowerCase() === low);
  if (byLabel) return byLabel;
  const path = ref.startsWith("/") ? ref : `/${ref}`;
  const byPath = majorRoutes.find(
    (r) => r.path.toLowerCase() === path.toLowerCase()
  );
  if (byPath) return byPath;
  const owner = majorRoutes.find(
    (r) => sectionPrefix(r.path) === sectionPrefix(path)
  );
  if (owner) return { label: `${owner.label} (${path})`, path };
  if (ref.startsWith("/")) return { label: path, path };
  throw userError(
    `Unknown section "${ref}". Detected sections: ${majorRoutes
      .map((r) => `${r.label} (${r.path})`)
      .join(", ")}. A path starting with "/" is also accepted.`
  );
}

async function selectSections(majorRoutes, startRoute) {
  if (opts.all) return majorRoutes;
  const requested = opts.sections ?? (startRoute ? [startRoute] : null);
  if (requested) {
    const selected = [];
    for (const ref of requested) {
      const section = matchSection(ref, majorRoutes);
      if (!selected.some((s) => s.path === section.path)) {
        selected.push(section);
      }
    }
    return selected;
  }
  if (opts.yes || !process.stdin.isTTY) {
    console.log(
      pc.dim(
        "  not interactive: auditing every detected section (use --sections to choose)"
      )
    );
    return majorRoutes;
  }
  const { selectedSections } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "selectedSections",
      message: "Select the navigation sections you want to audit:",
      choices: majorRoutes.map((route) => ({
        name: `${route.label} ${pc.dim(route.path)}`,
        value: route,
      })),
      validate: (ans) => (ans.length > 0 ? true : "Pick at least one section."),
    },
  ]);
  return selectedSections;
}

/* ---- Cross-view de-duplication -------------------------------------- */

// Report each issue once, on the first view (in audit order) where it
// appears, and record later views in `alsoOn`. axe findings are compared per
// flagged ELEMENT (rule + selector + HTML fingerprint), so a finding is only
// a repeat if every element it flags was already reported; partially
// repeated findings keep just the new elements. Keyboard findings are keyed
// by the focused element's selector.
function createDeduper() {
  const canonicalByKey = new Map();
  const noteAlsoOn = (canonical, label) => {
    canonical.alsoOn ??= [];
    if (!canonical.alsoOn.includes(label)) canonical.alsoOn.push(label);
  };
  return (merged, label) => {
    const findings = [];
    let repeats = 0;
    for (const f of merged) {
      if (f.source === "axe" && f.elements?.length) {
        const fresh = [];
        for (const element of f.elements) {
          const canonical = canonicalByKey.get(axeElementKey(f.id, element));
          if (canonical) noteAlsoOn(canonical, label);
          else fresh.push(element);
        }
        if (fresh.length === 0) {
          repeats += 1;
          continue;
        }
        const rebuilt = axeFinding(f.violation, fresh);
        for (const element of fresh) {
          canonicalByKey.set(axeElementKey(f.id, element), rebuilt);
        }
        findings.push(rebuilt);
        continue;
      }
      const finding = f.violation ? axeFinding(f.violation, []) : f;
      const key = `${f.source}|${f.id}|${f.selector || f.location}`;
      const canonical = canonicalByKey.get(key);
      if (canonical) {
        noteAlsoOn(canonical, label);
        repeats += 1;
        continue;
      }
      canonicalByKey.set(key, finding);
      findings.push(finding);
    }
    return { findings: findings.sort(sortFindings), repeats };
  };
}

/* ---- Run ------------------------------------------------------------ */

// `run` carries resources main() must release however the audit ends.
async function runAudit(run) {
  // The SPA is mounted at <basename><ui-base> (e.g. /MAAS/r).
  const appBase = `${opts.basename}${opts.uiBase}`.replace(/\/+$/, "");
  const { origin, startRoute } = resolveStart(startUrl, appBase);
  const appRoot = `${origin}${appBase}/`;
  const routeOf = (path) =>
    path.startsWith(appBase) ? path.slice(appBase.length) || "/" : path;

  console.log(
    pc.bold(pc.magenta(`\n♿ a11y-audit`)) + pc.dim(` — ${startUrl}`)
  );

  // Check Ollama up front (only when the context review is enabled) and
  // resolve the context window from the model via /api/show.
  let numCtx = null;
  if (opts.contextChecks) {
    let modelMaxContext;
    try {
      modelMaxContext = await withSpinner(
        `Checking Ollama model ${pc.cyan(opts.model)}`,
        () => checkOllama(opts.ollamaUrl, opts.model, opts.ollamaTimeout)
      );
    } catch {
      process.exitCode = 1;
      return;
    }
    const resolved = resolveNumCtx(opts.numCtx, modelMaxContext);
    numCtx = resolved.numCtx;
    console.log(
      pc.dim(
        `  model ${opts.model} · context ${numCtx} tokens (${resolved.source})` +
          (modelMaxContext ? ` · model max ${modelMaxContext}` : "")
      )
    );
    if (resolved.source === "override, capped") {
      console.log(
        pc.yellow(
          `  ! --num-ctx ${opts.numCtx} exceeds model max ${modelMaxContext}; capped to ${numCtx}.`
        )
      );
    }
    if (opts.llmConcurrency > 1) {
      console.log(
        pc.dim(
          `  --llm-concurrency ${opts.llmConcurrency}: the Ollama server needs ` +
            `OLLAMA_NUM_PARALLEL >= ${opts.llmConcurrency}; if requests time ` +
            "out while queued, the audit falls back to 1 at a time."
        )
      );
    }
  }

  let axeSource;
  let allowLabels = [];
  let interactionConfig = null;
  try {
    axeSource = await loadAxeSource();
  } catch (err) {
    throw userError(`Could not load axe-core: ${errorMessage(err)}`);
  }
  if (opts.contextChecks && opts.allowLabels) {
    try {
      allowLabels = await loadAllowLabels(opts.allowLabels);
    } catch (err) {
      throw userError(
        `Could not read --allow-labels ${opts.allowLabels}: ${errorMessage(err)}`
      );
    }
  }
  if (opts.interactions) {
    try {
      interactionConfig = await loadInteractionConfig(opts.interactionsConfig);
    } catch (err) {
      throw userError(
        `Could not load the interactions config: ${errorMessage(err)}`
      );
    }
  }

  let tokens;
  try {
    const password = await resolvePassword();
    tokens = await withSpinner(
      `Authenticating as ${pc.cyan(opts.username)}`,
      () =>
        retry(
          () =>
            authenticate(
              origin,
              opts.basename,
              opts.username,
              password,
              opts.timeout
            ),
          { attempts: opts.retries + 1, delayMs: 750 }
        )
    );
  } catch (err) {
    if (err?.expected) throw err;
    process.exitCode = 1;
    return;
  }

  const browser = await withSpinner("Launching browser", () =>
    chromium.launch({ headless: !opts.headed })
  );
  run.browser = browser;
  // bypassCSP so axe-core can be injected on pages with a strict CSP.
  const context = await browser.newContext({ bypassCSP: true });
  await context.addCookies(buildAuthCookies(origin, tokens));
  // Expand the main navigation so its links render and are discoverable.
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("appSideNavIsCollapsed", "false");
    } catch {
      // ignore storage access errors
    }
  });
  const firstPage = await context.newPage();

  // 1. Identify the major routes from the live main navigation.
  const majorRoutes = await withSpinner(
    "Detecting major navigation routes",
    () =>
      detectMajorRoutes(
        firstPage,
        origin,
        appBase,
        appRoot,
        opts.timeout,
        opts.settle
      )
  );

  // 2. Choose the sections to audit.
  const selectedSections = await selectSections(majorRoutes, startRoute);

  // Overall wall-clock guard, started once the selection is done. Aborting
  // cancels in-flight fetches, closes the browser (failing pending page
  // operations) and stops the work loops; main() then cleans up.
  if (opts.auditTimeout > 0) {
    run.timer = setTimeout(() => {
      runAbort.abort(
        new Error(`Audit timeout of ${opts.auditTimeout}ms exceeded.`)
      );
      browser.close().catch(() => {});
    }, opts.auditTimeout);
  }

  const stats = {
    similarSkipped: 0,
    crossSectionDuplicates: 0,
    skippedPages: 0,
    failedPages: 0,
    interactionErrors: 0,
    unsettled: 0,
    truncated: 0,
    contextErrors: 0,
    parseFailures: 0,
    dropped: 0,
    invalidWcag: 0,
    capped: 0,
    repeats: 0,
  };

  // 3. Crawl each chosen section, capturing every page while it is loaded.
  //    Each crawl may roam anywhere in the app except into *other* major
  //    sections, so it reaches its own detail pages without contaminating
  //    sibling sections. Pages reached from several sections are captured
  //    once (see `claimed`).
  const pages = [firstPage];
  for (let k = 1; k < opts.concurrency; k++)
    pages.push(await context.newPage());
  const pool = createPagePool(context, pages);
  const allMajorPrefixes = majorRoutes.map(
    (route) => `${appBase}${sectionPrefix(route.path)}`
  );
  const claimed = new Map();
  const views = [];
  for (const section of selectedSections) {
    const ownPrefix = `${appBase}${sectionPrefix(section.path)}`;
    const similarityFilter = createSimilarityFilter(opts.samplesPerPattern);
    const title = `Crawling ${pc.cyan(section.path)}`;
    const entries = await withSpinner(title, (setText) =>
      crawlSection({
        pool,
        origin,
        appBase,
        sectionRoute: section.path,
        otherMajorPrefixes: allMajorPrefixes.filter((p) => p !== ownPrefix),
        similarityFilter,
        claimed,
        sectionLabel: section.label,
        opts,
        capture: (page, { path, settled }) =>
          capturePage(page, {
            opts,
            path,
            origin,
            interactionConfig,
            axeSource,
            settled,
          }),
        onProgress: (captured, loaded) =>
          setText(
            `${title} ${pc.dim(`— ${captured} captured, ${loaded} loaded`)}`
          ),
      }).then((found) => {
        const captured = found.filter((e) => e.capture).length;
        const skipped = similarityFilter.skipped;
        setText(
          `Crawled ${pc.cyan(section.path)} ${pc.dim(
            `— ${captured} page(s) captured${
              skipped ? `, ${skipped} similar skipped` : ""
            }`
          )}`
        );
        return found;
      })
    );
    stats.similarSkipped += similarityFilter.skipped;

    for (const entry of entries) {
      const route = routeOf(entry.path);
      const base = {
        section: section.label,
        path: entry.path,
        label: entry.path,
        route,
        routePattern: routePattern(route),
        findings: [],
      };
      if (entry.duplicateOf) {
        if (entry.crossSection) stats.crossSectionDuplicates += 1;
        continue;
      }
      if (entry.skipped) {
        stats.skippedPages += 1;
        views.push({ ...base, skipped: entry.skipped });
        continue;
      }
      if (entry.error) {
        stats.failedPages += 1;
        views.push({ ...base, error: entry.error });
        continue;
      }
      const cap = entry.capture;
      views.push({
        ...base,
        ...(entry.redirectedFrom
          ? { redirectedFrom: entry.redirectedFrom }
          : {}),
        capture: cap,
      });
      for (const it of cap.interactions) {
        const label = `${entry.path} (after ${it.trigger.role} "${it.trigger.name}")`;
        if (it.skipped) continue;
        if (it.error) {
          stats.interactionErrors += 1;
          views.push({
            ...base,
            label,
            interaction: it.trigger,
            error: `could not activate: ${it.error}`,
          });
          continue;
        }
        views.push({ ...base, label, interaction: it.trigger, capture: it });
      }
    }
  }

  if (!views.some((v) => v.capture)) {
    console.log(pc.yellow("No pages were captured. Exiting."));
    process.exitCode = 1;
    return;
  }

  // Chrome ownership: the first view (in audit order) containing each shared
  // region owns it, so parallel reviews prune shared chrome consistently.
  const chromeOwner = new Map();
  if (opts.contextChecks) {
    views.forEach((view, i) => {
      if (!view.capture) return;
      for (const sig of chromeSignatures(view.capture.tree)) {
        if (!chromeOwner.has(sig)) chromeOwner.set(sig, i);
      }
    });
  }

  // 4. Context review (parallel) with ordered output: each view's block is
  //    printed in audit order as soon as it AND all earlier views are ready.
  //    The flush is synchronous, so workers never interleave console output.
  const systemPrompt = opts.contextChecks ? buildSystemPrompt(allowLabels) : "";
  const systemTokens = estimateTokens(systemPrompt);
  const limiter = createLimiter(opts.llmConcurrency);

  // One Ollama call through the shared limiter, with retries. A timeout while
  // other requests were in flight most likely means the server queued it
  // (OLLAMA_NUM_PARALLEL lower than --llm-concurrency); serialise from then on
  // so queue time stops counting against --ollama-timeout.
  const callModel = (fn) =>
    retry(
      (attempt) =>
        limiter.run(async () => {
          const concurrent = limiter.active > 1;
          try {
            return await fn(attempt);
          } catch (err) {
            if (err?.timedOut && concurrent && limiter.limit > 1) {
              limiter.reduceTo(1);
              console.warn(
                pc.yellow(
                  "  ! Ollama request timed out with other requests in " +
                    "flight; the server is likely queueing them. Continuing " +
                    "with 1 request at a time (raise OLLAMA_NUM_PARALLEL on " +
                    "the server to use --llm-concurrency)."
                )
              );
            }
            throw err;
          }
        }),
      {
        attempts: opts.retries + 1,
        delayMs: 750,
        onError: (err) => {
          if (err?.parseError) stats.parseFailures += 1;
        },
      }
    );

  const reviewView = async (view, i) => {
    const cap = view.capture;
    const uniqueTree = pruneChromeByOwner(cap.tree, chromeOwner, i);
    const sentTree = opts.prune
      ? preprocessTree(uniqueTree, opts.treeSamples)
      : uniqueTree;
    const knownRuleIds = [...new Set(cap.axeFindings.map((f) => f.id))];
    const page = view.interaction
      ? `${view.route}, after activating ${view.interaction.role} "${view.interaction.name}"`
      : view.route;
    // Measure the prompt around the outline so the outline gets exactly the
    // context budget that remains.
    const overhead =
      systemTokens +
      estimateTokens(buildUserMessage({ page, knownRuleIds, outline: "" }));
    const { text: outline, truncated } = capOutlineToContext(
      treeToOutline(sentTree, origin),
      numCtx,
      overhead
    );
    const outlineStats = {
      outlineLines: outline.split("\n").length,
      outlineTokens: estimateTokens(outline),
      truncated,
    };
    const common = {
      ollamaUrl: opts.ollamaUrl,
      model: opts.model,
      numCtx,
      timeoutMs: opts.ollamaTimeout,
    };
    let result;
    try {
      result = await callModel((attempt) =>
        runContextChecks({
          ...common,
          attempt,
          systemPrompt,
          userMessage: buildUserMessage({ page, knownRuleIds, outline }),
        })
      );
    } catch (err) {
      throwIfAborted();
      // The context review is optional: a failure must not lose the
      // deterministic axe/keyboard findings or abort the run.
      return { findings: [], error: errorMessage(err), ...outlineStats };
    }
    // Anti-hallucination guard: drop findings citing elements that aren't in
    // the outline the model was given. Survivors are annotated with a
    // confidence level (never dropped) so unreliable ones are flagged.
    const outlineText = collectOutlineText(outline);
    const grounded = result.findings.filter((f) =>
      isGroundedFinding(f, outlineText)
    );
    let findings = annotateContextFindings(grounded, cap.tree, allowLabels);
    let verifyTokens = 0;
    if (opts.verify) {
      const verified = [];
      for (const finding of findings) {
        try {
          const answer = await callModel((attempt) =>
            verifyContextFinding({ ...common, attempt, page, outline, finding })
          );
          verifyTokens +=
            (answer.usage.prompt_eval_count ?? 0) +
            (answer.usage.eval_count ?? 0);
          verified.push(applyVerification(finding, answer));
        } catch (err) {
          throwIfAborted();
          verified.push({
            ...finding,
            flags: [...finding.flags, "verify-failed"],
            verifyReason: errorMessage(err),
          });
        }
      }
      findings = verified;
    }
    return {
      findings,
      usage: result.usage,
      verifyTokens,
      dropped: result.findings.length - grounded.length,
      capped: result.capped,
      invalidWcag: result.invalidWcag,
      ...outlineStats,
    };
  };

  const dedupe = createDeduper();
  const slots = new Array(views.length);
  let nextToPrint = 0;

  const finishView = (i) => {
    const view = views[i];
    const counter = pc.dim(`[${i + 1}/${views.length}]`);
    if (view.skipped) {
      console.log(
        pc.yellow(`  ${counter} Skipped ${view.label}: ${view.skipped}`)
      );
      return;
    }
    if (view.error) {
      console.error(
        pc.red(`  ${counter} Failed: ${view.label}: ${view.error}`)
      );
      return;
    }
    const cap = view.capture;
    const cr = slots[i];
    printCapturedContents(view.label, cap.summary, cap.treeJson);
    if (view.redirectedFrom) {
      console.log(
        pc.yellow(`  ${counter} reached via ${view.redirectedFrom} (redirect)`)
      );
    }
    if (!cap.settled) {
      stats.unsettled += 1;
      console.log(
        pc.yellow(
          `  ${counter} page did not finish loading within --timeout; ` +
            "findings may reflect a partially rendered view"
        )
      );
    }
    const kbNote = opts.keyboardChecks
      ? `, keyboard: ${cap.keyboardFindings.length} issue(s)`
      : "";
    let contextNote = "";
    if (opts.contextChecks) {
      contextNote =
        `; context outline: ${cr.outlineLines} lines (~${cr.outlineTokens} tokens)` +
        (cr.truncated ? pc.yellow(" — cut to fit the context window") : "") +
        (cr.dropped ? `, ${cr.dropped} ungrounded dropped` : "") +
        (cr.invalidWcag
          ? `, ${cr.invalidWcag} with invalid WCAG dropped`
          : "") +
        (cr.capped
          ? `, ${cr.capped} over the ${MAX_CONTEXT_FINDINGS}-finding cap dropped`
          : "");
    }
    console.log(
      pc.dim(
        `  ${counter} axe: ${cap.axeFindings.length} issue(s)${kbNote}${contextNote}`
      )
    );
    if (cr.truncated) stats.truncated += 1;
    stats.dropped += cr.dropped || 0;
    stats.capped += cr.capped || 0;
    stats.invalidWcag += cr.invalidWcag || 0;
    if (cr.error) {
      stats.contextErrors += 1;
      console.log(pc.yellow(`  ${counter} context review failed: ${cr.error}`));
    }

    const merged = [
      ...cap.axeFindings,
      ...cap.keyboardFindings,
      ...cr.findings,
    ];
    const { findings, repeats } = dedupe(merged, view.label);
    stats.repeats += repeats;
    Object.assign(view, {
      findings,
      settled: cap.settled,
      summary: cap.summary,
      treeJson: cap.treeJson,
      usage: cr.usage ?? null,
      verifyTokens: cr.verifyTokens ?? 0,
      ...(cr.truncated ? { truncated: true } : {}),
      ...(cr.error ? { contextError: cr.error } : {}),
    });
    delete view.capture; // release the tree

    const count = (src) => findings.filter((f) => f.source === src).length;
    console.log(
      pc.bold(
        `\n${pc.green("●")} Findings for ${pc.cyan(view.label)} ` +
          pc.dim(
            `(${findings.length}: ${count("axe")} axe + ${count(
              "keyboard"
            )} keyboard + ${count("ai")} context` +
              (repeats ? `, ${repeats} repeated filtered` : "") +
              ")"
          )
      )
    );
    console.log(formatFindingsForConsole(findings));
    if (view.usage) {
      console.log(formatUsage(view.usage));
      console.log(formatContextWindow(view.usage, numCtx) + "\n");
    } else {
      console.log("");
    }
  };

  const flushReady = () => {
    while (nextToPrint < views.length && slots[nextToPrint] !== undefined) {
      finishView(nextToPrint);
      nextToPrint += 1;
    }
  };

  const reviewCount = views.filter((v) => v.capture).length;
  if (opts.contextChecks) {
    console.log(
      pc.bold(
        `\nReviewing ${reviewCount} view(s) with ${pc.cyan(opts.model)} ` +
          `(×${opts.llmConcurrency}):\n`
      )
    );
  }
  await mapPool(views, opts.llmConcurrency, async (view, i) => {
    slots[i] =
      view.capture && opts.contextChecks
        ? await reviewView(view, i)
        : { findings: [] };
    flushReady();
  });
  flushReady();

  // 5. Summary and reports.
  printSummary(views, stats, { opts, numCtx });
  const meta = {
    site: startUrl,
    model: opts.contextChecks ? opts.model : null,
    generated: new Date().toISOString(),
  };
  if (opts.report) {
    await writeMarkdownReport(opts.report, views, meta);
    console.log(pc.green(`✔ Report written to ${pc.bold(opts.report)}`));
  }
  if (opts.json) {
    await writeJsonReport(opts.json, views, meta, stats);
    console.log(
      pc.green(`✔ Structured findings written to ${pc.bold(opts.json)}`)
    );
  }

  if (opts.failOn) {
    const failing = countAtOrAbove(views, opts.failOn);
    if (failing > 0) {
      console.log(
        pc.red(
          `✖ ${failing} finding(s) at or above "${opts.failOn}" ` +
            "(low-confidence context findings excluded); exiting with code 2."
        )
      );
      process.exitCode = 2;
    }
  }
}

// Run the audit and always release its resources — including when it throws
// or is aborted by --audit-timeout — so no Chromium process is left behind.
async function main() {
  const run = { browser: null, timer: null };
  try {
    await runAudit(run);
  } finally {
    if (run.timer) clearTimeout(run.timer);
    await run.browser?.close().catch(() => {});
  }
}

main().catch((err) => {
  // After an abort, whatever surfaces first may be a secondary error (e.g. a
  // Playwright "target closed"), so report the abort reason itself.
  if (runAbort.signal.aborted) {
    console.error(
      pc.red(`\n${errorMessage(runAbort.signal.reason)} Aborting.`)
    );
  } else if (err?.expected) {
    console.error(pc.red(errorMessage(err)));
  } else {
    console.error(pc.red("Fatal error:"), err);
  }
  process.exitCode = 1;
});
