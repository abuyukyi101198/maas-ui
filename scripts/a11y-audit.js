#!/usr/bin/env node
/**
 * a11y-audit-cli
 * --------------
 * 1. Launches Playwright and crawls a target site (same-origin links only)
 * 2. Lets the user pick which discovered paths to audit (interactive checkbox)
 * 3. Visits each selected path, pulls the accessibility tree (roles, names,
 *    states - not raw DOM/HTML) and trims it down to a11y-relevant fields
 * 4. Sends that tree to a local Ollama model with an accessibility-audit
 *    prompt and prints/saves the model's findings
 *
 * Requires: Node 18+, Playwright browsers installed (`npx playwright install`),
 * and a running Ollama instance (`ollama serve`) with a model pulled
 * (e.g. `ollama pull llama3.1`).
 */

import { chromium } from "playwright";
import { Command } from "commander";
import inquirer from "inquirer";
import ora from "ora";
import pc from "picocolors";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/* -------------------------------------------------------------------- */
/* General helpers (errors, retries, timeouts)                          */
/* -------------------------------------------------------------------- */

// Safely turn any thrown value into a readable string. Not everything thrown
// is an Error (code can throw strings, objects, etc.), so reading `.message`
// blindly can itself produce confusing output.
function errorMessage(err) {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// Retry an async operation a few times with linear backoff. Used for
// transient failures (slow navigation, late websocket data, a briefly busy
// Ollama server or backend). `attempts` is the TOTAL number of tries.
async function retry(fn, { attempts = 3, delayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw lastError;
}

// fetch() with an AbortController-based timeout so a hung Ollama/MAAS request
// can't stall the whole run indefinitely. A non-positive timeout disables it.
async function fetchWithTimeout(url, options = {}, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return fetch(url, options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const program = new Command();

program
  .name("a11y-audit")
  .description(
    "Crawl a site, select pages, and run an LLM accessibility audit via Ollama"
  )
  .argument("<url>", "Starting URL to crawl (e.g. https://example.com)")
  .requiredOption(
    "-u, --username <username>",
    "MAAS username to authenticate with"
  )
  .requiredOption(
    "-p, --password <password>",
    "MAAS password to authenticate with"
  )
  .option(
    "--basename <path>",
    "MAAS backend base path (used for the auth endpoint)",
    "/MAAS"
  )
  .option(
    "--ui-base <path>",
    "MAAS UI base path (where the SPA is mounted under the backend basename)",
    "/r"
  )
  .option("-m, --model <name>", "Ollama model to use", "llama3")
  .option("-o, --ollama-url <url>", "Ollama base URL", "http://localhost:11434")
  .option(
    "--num-ctx <n>",
    "Override the context window size (tokens). Defaults to the model's own " +
      "context length as reported by Ollama",
    (v) => parseInt(v, 10)
  )
  .option(
    "--max-pages <n>",
    "Max pages to discover while crawling",
    (v) => parseInt(v, 10),
    25
  )
  .option(
    "--max-depth <n>",
    "Max link-following depth while crawling",
    (v) => parseInt(v, 10),
    2
  )
  .option("--headed", "Run the browser with a visible window", false)
  .option(
    "--show-tree",
    "Print the full captured accessibility tree (JSON) for each page",
    false
  )
  .option(
    "--report <path>",
    "Write the full audit report to a Markdown file",
    null
  )
  .option(
    "--timeout <ms>",
    "Per-page navigation timeout in ms",
    (v) => parseInt(v, 10),
    15000
  )
  .option(
    "--settle <ms>",
    "How long the DOM must be mutation-free before a page is considered " +
      "settled (lets async websocket data render before snapshotting)",
    (v) => parseInt(v, 10),
    1000
  )
  .option(
    "--samples-per-pattern <n>",
    "How many example pages to keep per group of similar paths (e.g. the " +
      "detail pages of different records). Raise to cover conditional rendering",
    (v) => parseInt(v, 10),
    1
  )
  .option(
    "--no-prune",
    "Disable accessibility-tree preprocessing (send the full tree to the model)"
  )
  .option(
    "--tree-samples <n>",
    "When preprocessing, how many examples of each repeated sibling subtree " +
      "(e.g. table rows, list items) to keep",
    (v) => parseInt(v, 10),
    3
  )
  .option(
    "--axe-tags <list>",
    "Comma-separated axe-core rule tags to run",
    (v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]
  )
  .option(
    "--no-context-checks",
    "Skip the LLM context-aware review (run only the deterministic axe-core checks)"
  )
  .option(
    "--concurrency <n>",
    "How many pages to capture/audit in parallel",
    (v) => Math.max(1, parseInt(v, 10) || 1),
    3
  )
  .option(
    "--keyboard-checks",
    "Run keyboard-navigation smoke checks (focus movement, offscreen/hidden " +
      "focus, focus traps) on each page",
    false
  )
  .option(
    "--ollama-timeout <ms>",
    "Per-request timeout for Ollama calls in ms (0 = disabled)",
    (v) => parseInt(v, 10),
    120000
  )
  .option(
    "--retries <n>",
    "Retry attempts for transient navigation/auth/Ollama failures",
    (v) => Math.max(0, parseInt(v, 10) || 0),
    2
  )
  .option(
    "--audit-timeout <ms>",
    "Overall wall-clock timeout for the entire run in ms (0 = disabled)",
    (v) => parseInt(v, 10),
    0
  )
  .parse(process.argv);

const opts = program.opts();
const startUrl = program.args[0];

/* -------------------------------------------------------------------- */
/* CLI presentation helpers                                              */
/* -------------------------------------------------------------------- */

// Run an async task behind an animated spinner (animated ellipsis). Falls
// back to plain logging when stdout isn't a TTY (e.g. piped to a file).
async function withSpinner(text, task) {
  const spinner = ora({
    text,
    spinner: "dots",
    isEnabled: process.stdout.isTTY,
  }).start();
  try {
    const result = await task((newText) => {
      spinner.text = newText;
    });
    spinner.succeed();
    return result;
  } catch (err) {
    spinner.fail(`${text} — ${errorMessage(err)}`);
    throw err;
  }
}

// Ollama returns nanosecond durations and token counts; turn them into a
// compact, human-readable usage line.
function formatUsage(usage) {
  if (!usage) return pc.dim("usage: n/a");
  const promptTokens = usage.prompt_eval_count ?? 0;
  const completionTokens = usage.eval_count ?? 0;
  const totalTokens = promptTokens + completionTokens;
  const evalSeconds = (usage.eval_duration ?? 0) / 1e9;
  const totalSeconds = (usage.total_duration ?? 0) / 1e9;
  const tps =
    evalSeconds > 0 ? (completionTokens / evalSeconds).toFixed(1) : "0.0";
  return pc.dim(
    `tokens: ${totalTokens} (prompt ${promptTokens} + completion ${completionTokens}) · ` +
      `${tps} tok/s · ${totalSeconds.toFixed(1)}s`
  );
}

// Colour a context-window "fullness" bar: green (roomy) → yellow (filling) →
// red (near/over the limit, i.e. truncation risk).
function fullnessColor(ratio) {
  if (ratio >= 0.85) return pc.red;
  if (ratio >= 0.6) return pc.yellow;
  return pc.green;
}

// Report how much of the context window a call consumed (prompt + completion
// tokens vs the configured num_ctx), with a colour-coded fullness bar.
function formatContextWindow(usage, numCtx) {
  const used = (usage?.prompt_eval_count ?? 0) + (usage?.eval_count ?? 0);
  if (!numCtx) return pc.dim(`context: ${used} / ? tokens`);
  const ratio = used / numCtx;
  const barWidth = 16;
  const filled = Math.max(0, Math.min(barWidth, Math.round(ratio * barWidth)));
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
  const color = fullnessColor(ratio);
  const pct = `${(ratio * 100).toFixed(0)}%`;
  const overflow = used > numCtx ? pc.red(" ⚠ truncation risk") : "";
  return (
    pc.dim("context: ") +
    color(`[${bar}] ${pct}`) +
    pc.dim(` (${used}/${numCtx})`) +
    overflow
  );
}

// Query Ollama for the model's maximum trained context length (informational
// + to warn if --num-ctx exceeds it). Returns null if unavailable.
async function getModelMaxContext(ollamaUrl, model, timeoutMs) {
  try {
    const res = await fetchWithTimeout(
      `${ollamaUrl}/api/show`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      },
      timeoutMs
    );
    if (!res.ok) return null;
    const data = await res.json();
    const info = data.model_info || {};
    const key = Object.keys(info).find((k) => k.endsWith(".context_length"));
    return key ? info[key] : null;
  } catch {
    return null;
  }
}

// Severity → colour mapping for terminal output.
const severityColor = {
  critical: (s) => pc.red(s.toUpperCase()),
  serious: (s) => pc.redBright(s.toUpperCase()),
  moderate: (s) => pc.yellow(s.toUpperCase()),
  minor: (s) => pc.cyan(s.toUpperCase()),
};

function colorSeverity(severity) {
  const fn = severityColor[severity] ?? ((s) => s.toUpperCase());
  return fn(severity);
}

// Pretty, boxed-ish captured-contents panel for the console.
function printCapturedContents(pagePath, summary, treeJson, showTree) {
  const bar = pc.dim("─".repeat(64));
  console.log(
    pc.bold(pc.blue(`\n▼ Captured contents`)) + pc.dim(` ${pagePath}`)
  );
  console.log(bar);
  console.log(
    `  ${pc.bold("nodes")}     ${summary.total} ${pc.dim(
      `(${summary.named} named)`
    )}`
  );
  console.log(
    `  ${pc.bold("landmarks")} ${
      summary.landmarks.length
        ? summary.landmarks.map((l) => pc.green(l)).join(pc.dim(", "))
        : pc.yellow("none")
    }`
  );
  console.log(
    `  ${pc.bold("headings")}  ${
      summary.headings.length
        ? summary.headings.map((h) => pc.cyan(h)).join(pc.dim(", "))
        : pc.yellow("none")
    }`
  );
  const topRoles = Object.entries(summary.roleCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([role, count]) => `${role}${pc.dim(`×${count}`)}`)
    .join(pc.dim(", "));
  console.log(`  ${pc.bold("roles")}     ${topRoles || pc.yellow("none")}`);
  if (showTree) {
    console.log(pc.dim("\n  tree (JSON):"));
    console.log(
      treeJson
        .split("\n")
        .map((line) => `  ${pc.dim(line)}`)
        .join("\n")
    );
  }
  console.log(bar);
}

/* -------------------------------------------------------------------- */
/* Authentication                                                        */
/* -------------------------------------------------------------------- */

// Mirrors the e2e `cy.login()` command: POST credentials to the MAAS auth
// endpoint, then inject the returned JWT/refresh tokens as cookies so the
// crawler is treated as an authenticated session. Without this every
// protected route just redirects to /login.
async function authenticate(origin, basename, username, password, timeoutMs) {
  const loginUrl = `${origin}${basename}/a/v3/auth/login`;
  const res = await fetchWithTimeout(
    loginUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password }).toString(),
    },
    timeoutMs
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Login failed (${res.status} ${res.statusText}) at ${loginUrl}: ${body}`
    );
  }
  const data = await res.json();
  if (!data.access_token || !data.refresh_token) {
    throw new Error(
      "Login response did not include access_token / refresh_token."
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  };
}

// Build the cookie set an authenticated MAAS session needs:
//  - the JWT/refresh tokens from the login response
//  - skipsetupintro / skipintro so the app doesn't redirect into the
//    first-run setup wizard (which is button-driven and untraversable)
// Playwright requires either `url` OR a `domain`/`path` pair (not both), so
// we derive the domain from the origin and set an explicit path of "/".
function buildAuthCookies(origin, { accessToken, refreshToken }) {
  const domain = new URL(origin).hostname;
  return [
    {
      name: "maas.local_jwt_token_cookie",
      value: accessToken,
      domain,
      path: "/",
      sameSite: "Strict",
    },
    {
      name: "maas.local_refresh_token_cookie",
      value: refreshToken,
      domain,
      path: "/",
      sameSite: "Strict",
    },
    { name: "skipsetupintro", value: "true", domain, path: "/" },
    { name: "skipintro", value: "true", domain, path: "/" },
  ];
}

// The SPA renders asynchronously and shows a "Loading" state before content
// is ready. Mirroring the e2e `waitForPageToLoad`, wait until the page has
// settled: a heading has rendered, no "loading" text remains, and nothing
// is still flagged as busy or showing a loading spinner/skeleton. This avoids
// snapshotting the loading shell.
//
// WebSocket-heavy views (notably the Machines list) are the tricky case: they
// render a real heading plus ~5 skeleton placeholder rows *before* the data
// arrives over the socket. That shell satisfies the naive "heading exists"
// check, sets no aria-busy, and its skeletons animate purely in CSS (no DOM
// mutations) — so neither the heading check nor a "DOM is quiet" check can
// tell it apart from the loaded page. We therefore detect MAAS's concrete
// loading markers directly.
async function waitForAppReady(page, timeout) {
  try {
    await page.waitForFunction(
      () => {
        const isVisible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(el);
          return style.visibility !== "hidden" && style.display !== "none";
        };

        // 1. Some real content heading has rendered.
        const hasHeading = document.querySelector("h1, h2, [role='heading']");
        if (!hasHeading) return false;

        // 2. No visible element still shows a "loading" label.
        const hasLoadingText = Array.from(
          document.querySelectorAll("body *")
        ).some((el) => {
          if (el.children.length > 0) return false; // leaf nodes only
          return isVisible(el) && /loading/i.test(el.textContent || "");
        });
        if (hasLoadingText) return false;

        // 3. No loading indicator still rendering. MAAS shows these while
        //    websocket data loads; none of them set aria-busy and the
        //    skeletons animate in CSS (no DOM mutations), so they must be
        //    detected explicitly:
        //      - aria-busy / progressbar (generic)
        //      - Vanilla Spinner: .p-icon--spinner / .u-animation--spin
        //      - skeleton placeholders: .p-placeholder, [data-testid=placeholder]
        //      - BEM loading modifiers, e.g. .machine-list--loading
        //      - elements labelled as loading, e.g. grid aria-label="Loading machines"
        const LOADING_SELECTORS = [
          "[aria-busy='true']",
          "[role='progressbar']",
          ".p-icon--spinner",
          ".u-animation--spin",
          ".p-spinner",
          ".p-placeholder",
          "[data-testid='placeholder']",
          "[class*='--loading']",
          "[aria-label*='loading' i]",
        ];
        const stillLoading = Array.from(
          document.querySelectorAll(LOADING_SELECTORS.join(","))
        ).some(isVisible);
        return !stillLoading;
      },
      { timeout, polling: 250 }
    );
  } catch {
    // Some pages may legitimately never satisfy every condition (or are
    // slow); fall back to auditing whatever has rendered rather than failing.
  }
}

// Wait until the DOM has been free of mutations for `quietMs` (capped by
// `timeout`). MAAS hydrates many views from WebSocket responses that arrive
// *after* the first paint — e.g. a device detail page first renders a
// transient "Device not found" state, then swaps in the real content (with
// its tab links) once `device.get` resolves over the socket. Waiting for the
// DOM to go quiet bridges that gap so we snapshot/crawl the settled page.
// (DOM mutations are used rather than network activity because the socket
// emits periodic pings that would never let a network-idle wait resolve.)
async function waitForDomQuiet(page, quietMs, timeout) {
  try {
    await page.evaluate(
      ({ quietMs, timeout }) =>
        new Promise((resolve) => {
          const target = document.body || document.documentElement;
          if (!target) {
            resolve();
            return;
          }
          let quietTimer;
          const finish = () => {
            clearTimeout(quietTimer);
            clearTimeout(hardCap);
            observer.disconnect();
            resolve();
          };
          const observer = new MutationObserver(() => {
            clearTimeout(quietTimer);
            quietTimer = setTimeout(finish, quietMs);
          });
          observer.observe(target, {
            attributes: true,
            characterData: true,
            childList: true,
            subtree: true,
          });
          quietTimer = setTimeout(finish, quietMs);
          // Absolute upper bound so a constantly-mutating page can't hang us.
          const hardCap = setTimeout(finish, timeout);
        }),
      { quietMs, timeout }
    );
  } catch {
    // ignore — fall back to whatever has rendered
  }
}

// Settle a page before snapshotting or reading its links: wait until it's
// ready (no spinner/skeleton), let async (websocket) content stop mutating
// the DOM, then re-check readiness in case data only just started loading —
// and give the newly rendered real content a final chance to settle. The
// trailing quiet matters for WS-heavy views (e.g. Machines): once the
// skeleton clears, the real rows render and mutate the DOM, so we wait for
// those to stop before capturing.
async function settlePage(page, timeout, settleMs) {
  await waitForAppReady(page, timeout);
  await waitForDomQuiet(page, settleMs, timeout);
  await waitForAppReady(page, timeout);
  await waitForDomQuiet(page, settleMs, timeout);
}

/* -------------------------------------------------------------------- */
/* Route detection                                                       */
/* -------------------------------------------------------------------- */

// Static fallback used if the live main navigation can't be read (e.g. the
// markup changes). Mirrors the routes in the e2e navigation feature.
const FALLBACK_MAJOR_ROUTES = [
  { label: "Machines", path: "/machines" },
  { label: "Devices", path: "/devices" },
  { label: "Controllers", path: "/controllers" },
  { label: "LXD", path: "/kvm/lxd" },
  { label: "Images", path: "/images" },
  { label: "DNS", path: "/domains" },
  { label: "Networks", path: "/networks/subnets" },
  { label: "Settings", path: "/settings/configuration/general" },
  { label: "AZs", path: "/zones" },
];

// The "section" of a route is its first path segment under the app base.
// e.g. /networks/subnets -> "/networks", /kvm/lxd -> "/kvm".
function sectionPrefix(route) {
  const [first] = route.replace(/^\/+/, "").split("/");
  return `/${first}`;
}

// Read the major routes straight from the live main navigation so the list
// reflects what the user actually sees. Falls back to FALLBACK_MAJOR_ROUTES.
async function detectMajorRoutes(
  page,
  origin,
  appBase,
  appRoot,
  timeout,
  settleMs
) {
  try {
    await page.goto(appRoot, { waitUntil: "domcontentloaded", timeout });
    await settlePage(page, timeout, settleMs);

    const links = await page.evaluate(() => {
      const selectors = [
        "[aria-label*='main navigation' i]",
        "header[aria-label*='navigation' i]",
        ".p-side-navigation",
        "nav",
      ];
      let container = null;
      for (const selector of selectors) {
        container = document.querySelector(selector);
        if (container) break;
      }
      if (!container) return [];
      return Array.from(container.querySelectorAll("a[href]"))
        .map((a) => ({
          label: (a.textContent || "").trim().replace(/\s+/g, " "),
          href: a.href,
        }))
        .filter((l) => l.label);
    });

    const seen = new Set();
    const routes = [];
    for (const { label, href } of links) {
      let pathname;
      try {
        const u = new URL(href);
        if (u.origin !== origin) continue;
        pathname = u.pathname + u.search;
      } catch {
        continue;
      }
      const route = pathname.startsWith(appBase)
        ? pathname.slice(appBase.length) || "/"
        : pathname;
      // Group by section so we don't list two links that map to the same
      // top-level section (which would crawl the same confined area twice).
      const key = sectionPrefix(route);
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push({ label, path: route });
    }
    if (routes.length > 0) return routes;
  } catch (err) {
    console.warn(`  ! Could not read main navigation: ${errorMessage(err)}`);
  }
  return FALLBACK_MAJOR_ROUTES;
}

/* -------------------------------------------------------------------- */
/* Path similarity / de-duplication                                      */
/* -------------------------------------------------------------------- */

// A path segment is treated as a dynamic identifier (record id) when it looks
// like one: a numeric id, a UUID, or a mixed alphanumeric token (e.g. a MAAS
// system_id like "w8aqpg"). Note: not all ids contain digits (e.g. "rwrqae"),
// so this is only one of the signals used by isSameView below — see
// isIdLikeSegment, which also uses the parent segment for context.
function isDynamicSegment(seg) {
  if (!seg) return false;
  if (/^\d+$/.test(seg)) return true; // pure numeric id
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) return true; // uuid
  if (/\d/.test(seg) && /[a-z]/i.test(seg)) return true; // mixed alphanumeric
  return false;
}

// MAAS detail routes put a record id directly after a singular resource noun
// (e.g. /machine/<system_id>, /subnet/<id>, /kvm/lxd/<id>). Many ids — notably
// machine/device/controller system_ids — are all-letters (e.g. "aspfkw"), so
// isDynamicSegment can't recognise them on its own. The preceding segment is a
// reliable, low-false-positive signal that the next segment is an id, which
// lets us collapse base detail pages of different records even though the id
// is the final path segment. Derived from the app's route definitions.
const RESOURCE_ID_PARENTS = new Set([
  "machine",
  "device",
  "controller",
  "domain",
  "tag",
  "fabric",
  "space",
  "subnet",
  "vlan",
  "zone",
  "pool",
  "pod",
  "lxd", // /kvm/lxd/<id>
  "virsh", // /kvm/virsh/<id>
  "cluster", // /kvm/lxd/cluster/<id>
  "host", // /kvm/lxd/cluster/<id>/host/<id>
  "group", // /settings/user-management/group/<id>
]);

// Whether the segment at `index` occupies a record-id position: either it
// already looks id-like, or its parent segment is a known resource prefix
// whose next segment is always an id.
function isIdLikeSegment(segments, index) {
  if (isDynamicSegment(segments[index])) return true;
  return (
    index > 0 && RESOURCE_ID_PARENTS.has(segments[index - 1].toLowerCase())
  );
}

function pathSegments(pathname) {
  const [pathOnly] = pathname.split("?");
  return pathOnly.split("/").filter(Boolean);
}

// Two paths render the "same view" when they share the same structure and
// differ only in record-id positions. A differing segment is treated as an id
// (and thus ignored for view identity) when it is NOT the final segment — ids
// are containers with sub-views, e.g. /device/<id>/summary — or when it
// occupies a record-id position (see isIdLikeSegment): either it looks id-like
// or it directly follows a resource prefix such as /machine/<system_id>. This
// collapses the detail pages of different records (/device/A == /device/B and
// /device/A/summary == /device/B/summary) while keeping genuinely different
// leaf pages distinct, e.g. tabs (.../summary vs .../network) and siblings
// (/images vs /devices).
function isSameView(a, b) {
  const sa = pathSegments(a);
  const sb = pathSegments(b);
  if (sa.length !== sb.length) return false;
  const lastIndex = sa.length - 1;
  for (let i = 0; i < sa.length; i++) {
    if (sa[i].toLowerCase() === sb[i].toLowerCase()) continue;
    const differingSegmentIsId =
      i !== lastIndex || isIdLikeSegment(sa, i) || isIdLikeSegment(sb, i);
    if (!differingSegmentIsId) return false;
  }
  return true;
}

// Decide which discovered paths to keep, suppressing later paths that render
// the same view as one already accepted (same structure, different record).
// Up to `samplesPerPattern` examples are kept per view so some
// conditional-rendering variation across records is still covered.
function createSimilarityFilter(samplesPerPattern) {
  const groups = []; // { repr, count }
  let skipped = 0;
  return {
    get skipped() {
      return skipped;
    },
    accept(pathname) {
      const group = groups.find((g) => isSameView(pathname, g.repr));
      if (!group) {
        groups.push({ repr: pathname, count: 1 });
        return true;
      }
      if (group.count < samplesPerPattern) {
        group.count += 1;
        return true;
      }
      skipped += 1;
      return false;
    },
  };
}

/* -------------------------------------------------------------------- */
/* Crawling                                                              */
/* -------------------------------------------------------------------- */

// Crawl a single section. Rather than confining to a hardcoded prefix, we
// follow any in-app link EXCEPT those that belong to a different detected
// major route (`otherMajorPrefixes`). This lets a section reach its own
// detail pages (e.g. /devices -> /device/<id>/summary, which is not itself a
// major route) while still preventing bleed into sibling sections like
// /machines or /pools.
async function discoverSectionPaths(
  page,
  sectionRootUrl,
  appBase,
  otherMajorPrefixes,
  maxPages,
  maxDepth,
  timeout,
  settleMs,
  similarityFilter
) {
  const origin = new URL(sectionRootUrl).origin;
  const visited = new Set();
  const queued = new Set([sectionRootUrl]);
  const queue = [{ url: sectionRootUrl, depth: 0 }];
  const discovered = new Set();
  // Register the section root so later near-duplicates group against it.
  similarityFilter.accept(new URL(sectionRootUrl).pathname);

  const underPrefix = (pathname, prefix) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`);
  const inSection = (pathname) =>
    // Must stay inside the app, and must not fall under another major route.
    underPrefix(pathname, appBase) &&
    !otherMajorPrefixes.some((prefix) => underPrefix(pathname, prefix));

  while (queue.length && visited.size < maxPages) {
    const { url, depth } = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    let pathOnly;
    try {
      const u = new URL(url);
      pathOnly = u.pathname + u.search || "/";
    } catch {
      continue;
    }
    discovered.add(pathOnly);

    if (depth >= maxDepth) continue;

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout });
      // Wait for the SPA to finish rendering AND for async websocket content
      // (e.g. detail pages and their tab links) to settle before reading links.
      await settlePage(page, timeout, settleMs);
    } catch (err) {
      console.warn(
        `  ! Skipping (failed to load): ${url} - ${errorMessage(err)}`
      );
      continue;
    }

    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.href));
    for (const href of hrefs) {
      try {
        const u = new URL(href);
        if (u.origin !== origin) continue;
        // Confine the crawl: only follow links that stay within this section.
        if (!inSection(u.pathname)) continue;
        const clean = u.origin + u.pathname + u.search; // drop hash fragments
        if (
          !visited.has(clean) &&
          !queued.has(clean) &&
          visited.size + queue.length < maxPages &&
          // Skip paths that are near-duplicates of ones already accepted
          // (e.g. the detail page of a different record).
          similarityFilter.accept(u.pathname)
        ) {
          queued.add(clean);
          queue.push({ url: clean, depth: depth + 1 });
        }
      } catch {
        // ignore malformed hrefs (mailto:, javascript:, etc.)
      }
    }
  }

  return Array.from(discovered).sort();
}

/* -------------------------------------------------------------------- */
/* Accessibility extraction                                              */
/* -------------------------------------------------------------------- */

// Keys we keep from each accessibility-tree node. This is the set of
// fields that actually matter for an a11y audit (role/name/state info),
// as opposed to layout, styling, or full DOM markup.
const A11Y_KEYS = [
  "role",
  "name",
  "value",
  "description",
  "roledescription",
  "valuetext",
  "disabled",
  "expanded",
  "focused",
  "modal",
  "multiline",
  "multiselectable",
  "readonly",
  "required",
  "selected",
  "pressed",
  "level",
  "valuemin",
  "valuemax",
  "autocomplete",
  "haspopup",
  "invalid",
  "orientation",
  "checked",
];

function trimA11yNode(node) {
  if (!node) return null;
  const trimmed = {};
  for (const key of A11Y_KEYS) {
    if (node[key] !== undefined && node[key] !== false)
      trimmed[key] = node[key];
  }
  if (node.children?.length) {
    const kids = node.children.map(trimA11yNode).filter(Boolean);
    if (kids.length) trimmed.children = kids;
  }
  // Drop nodes that carry no useful information at all
  if (Object.keys(trimmed).length === 0) return null;
  return trimmed;
}

async function extractAccessibilityTree(page) {
  // Playwright removed the page.accessibility API, so we pull the computed
  // accessibility tree straight from Chromium via the DevTools Protocol.
  // `Accessibility.getFullAXTree` returns the same role/name/state data that
  // assistive technology perceives.
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Accessibility.enable");
    const { nodes } = await client.send("Accessibility.getFullAXTree");
    const raw = cdpTreeToNode(nodes);
    return trimA11yNode(raw);
  } finally {
    await client.detach().catch(() => {});
  }
}

// Convert a CDP node's role/name/value/description plus its `properties`
// array into the flat `{ role, name, checked, ... }` shape trimA11yNode reads.
function cdpNodeProps(node) {
  const props = {};
  if (node.role) props.role = node.role.value;
  if (node.name) props.name = node.name.value;
  if (node.value) props.value = node.value.value;
  if (node.description) props.description = node.description.value;
  for (const prop of node.properties || []) {
    props[prop.name] = prop.value?.value;
  }
  return props;
}

// CDP returns a flat list of nodes referencing children by id. Rebuild the
// hierarchy, skipping "ignored" nodes (the rough equivalent of Playwright's
// interestingOnly) by bubbling their children up to the nearest kept parent.
function cdpTreeToNode(nodes) {
  if (!nodes || nodes.length === 0) return null;
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));

  const buildChildren = (node) => {
    const children = [];
    for (const childId of node.childIds || []) {
      const child = byId.get(childId);
      if (!child) continue;
      if (child.ignored) {
        children.push(...buildChildren(child));
      } else {
        children.push(buildNode(child));
      }
    }
    return children;
  };

  const buildNode = (node) => {
    const built = cdpNodeProps(node);
    const children = buildChildren(node);
    if (children.length) built.children = children;
    return built;
  };

  const root = nodes.find((n) => !n.parentId) || nodes[0];
  if (root.ignored) {
    const children = buildChildren(root);
    return { role: "RootWebArea", children };
  }
  return buildNode(root);
}

// Walk the captured tree and produce a quick, human-readable summary so the
// user can sanity-check that landmarks, headings and named controls were
// actually captured before trusting the audit.
function summarizeA11yTree(tree) {
  const landmarkRoles = new Set([
    "banner",
    "navigation",
    "main",
    "complementary",
    "contentinfo",
    "region",
    "search",
    "form",
  ]);
  const roleCounts = {};
  const headings = [];
  const landmarks = [];
  let total = 0;
  let named = 0;

  const walk = (node) => {
    if (!node) return;
    total += 1;
    if (node.name) named += 1;
    if (node.role) {
      roleCounts[node.role] = (roleCounts[node.role] || 0) + 1;
      if (node.role === "heading") {
        headings.push(
          `${node.name || "(no name)"}${node.level ? ` [h${node.level}]` : ""}`
        );
      }
      if (landmarkRoles.has(node.role)) {
        landmarks.push(`${node.role}${node.name ? `: ${node.name}` : ""}`);
      }
    }
    (node.children || []).forEach(walk);
  };
  walk(tree);

  return { total, named, roleCounts, headings, landmarks };
}

// Render the captured-tree summary as plain text for console / report output.
function formatTreeSummary(summary) {
  const topRoles = Object.entries(summary.roleCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([role, count]) => `${role}×${count}`)
    .join(", ");
  return [
    `nodes: ${summary.total} (named: ${summary.named})`,
    `landmarks (${summary.landmarks.length}): ${
      summary.landmarks.length ? summary.landmarks.join("; ") : "none"
    }`,
    `headings (${summary.headings.length}): ${
      summary.headings.length ? summary.headings.join("; ") : "none"
    }`,
    `roles: ${topRoles || "none"}`,
  ].join("\n");
}

/* -------------------------------------------------------------------- */
/* Tree preprocessing (token reduction)                                  */
/* -------------------------------------------------------------------- */

// Node states worth keeping for an audit (everything except role/name/value,
// which are handled separately).
const STATE_KEYS = [
  "disabled",
  "expanded",
  "focused",
  "modal",
  "multiline",
  "multiselectable",
  "readonly",
  "required",
  "selected",
  "pressed",
  "level",
  "valuemin",
  "valuemax",
  "autocomplete",
  "haspopup",
  "invalid",
  "orientation",
  "checked",
];

// Roles that carry no audit value and only bloat the tree. InlineTextBox is a
// verbatim duplicate of its StaticText parent's name; LineBreak is layout-only.
const NOISE_ROLES = new Set(["InlineTextBox", "LineBreak"]);

// Structural wrappers with no semantics — flattened (replaced by their
// children) when they carry no accessible name or state.
const FLATTEN_ROLES = new Set(["generic", "none", "GenericContainer"]);

const MAX_TEXT_LEN = 80;

function truncateText(str, max) {
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

// A shallow structural signature used to detect repeated sibling subtrees
// (e.g. many identical table rows / list items). Names are intentionally
// excluded so rows that differ only by their data collapse together.
function siblingSignature(node) {
  if (node.role === "__omitted__") return `__omitted__#${node.omittedRole}`;
  const childRoles = (node.children || []).map((c) => c.role).join(",");
  return `${node.role}|${childRoles}`;
}

// Keep the first `keep` of each group of structurally-identical siblings and
// replace the remainder with a single "omitted" marker per group.
function collapseRepeatedSiblings(children, keep) {
  const counts = new Map();
  const omitted = new Map();
  const result = [];
  for (const child of children) {
    const sig = siblingSignature(child);
    const seen = (counts.get(sig) || 0) + 1;
    counts.set(sig, seen);
    if (seen <= keep) {
      result.push(child);
    } else {
      omitted.set(sig, (omitted.get(sig) || 0) + 1);
    }
  }
  for (const [sig, count] of omitted) {
    result.push({ role: "__omitted__", omittedRole: sig.split("|")[0], count });
  }
  return result;
}

// Recursively prune a node: drop noise, truncate text, collapse repeated
// siblings, and flatten empty structural wrappers. Returns an array because a
// flattened node is replaced by its children.
function preprocessNode(node, keepSamples) {
  if (!node) return [];
  if (NOISE_ROLES.has(node.role)) return [];

  let children = (node.children || []).flatMap((c) =>
    preprocessNode(c, keepSamples)
  );
  children = collapseRepeatedSiblings(children, keepSamples);

  const out = { ...node };
  delete out.children;
  if (typeof out.name === "string")
    out.name = truncateText(out.name, MAX_TEXT_LEN);
  if (typeof out.value === "string")
    out.value = truncateText(out.value, MAX_TEXT_LEN);

  const hasName = typeof out.name === "string" && out.name.length > 0;
  const hasState = STATE_KEYS.some(
    (k) => out[k] !== undefined && out[k] !== false
  );
  if (FLATTEN_ROLES.has(node.role) && !hasName && !hasState) {
    return children; // bubble children up, drop the empty wrapper
  }
  if (children.length) out.children = children;
  return [out];
}

function preprocessTree(tree, keepSamples) {
  const roots = preprocessNode(tree, keepSamples);
  return roots.length === 1
    ? roots[0]
    : { role: "RootWebArea", children: roots };
}

// Serialise the tree as a compact indented outline. This is dramatically
// cheaper in tokens than pretty-printed JSON while preserving role/name/state.
function serializeOutline(node, depth, lines) {
  if (!node) return lines;
  const indent = "  ".repeat(depth);
  if (node.role === "__omitted__") {
    lines.push(`${indent}… (${node.count} more similar ${node.omittedRole})`);
    return lines;
  }
  const parts = [node.role || "node"];
  if (node.name) parts.push(JSON.stringify(node.name));
  const states = [];
  for (const key of STATE_KEYS) {
    if (node[key] !== undefined && node[key] !== false) {
      states.push(`${key}=${node[key]}`);
    }
  }
  if (node.value) states.push(`value=${JSON.stringify(node.value)}`);
  if (node.description) states.push(`desc=${JSON.stringify(node.description)}`);
  if (states.length) parts.push(`[${states.join(" ")}]`);
  lines.push(indent + parts.join(" "));
  for (const child of node.children || []) {
    serializeOutline(child, depth + 1, lines);
  }
  return lines;
}

function treeToOutline(tree) {
  return serializeOutline(tree, 0, []).join("\n");
}

// Hard cap the outline to fit the model's context window, reserving room for
// the instructions/schema and the model's JSON response.
function capOutlineToContext(outline, numCtx) {
  const budgetTokens = Math.max((numCtx || 4096) - 1200, 800);
  const budgetChars = budgetTokens * 4; // ~4 chars per token (rough)
  if (outline.length <= budgetChars) return { text: outline, truncated: false };
  const lines = outline.split("\n");
  const kept = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > budgetChars) break;
    kept.push(line);
    length += line.length + 1;
  }
  kept.push("… (tree truncated to fit the model context window)");
  return { text: kept.join("\n"), truncated: true };
}

// Shared "site chrome" — navigation, banner, footer, status bar — is byte-for-
// byte identical across every view, so it produces the same findings on every
// page. We detect it deterministically and audit it only once.

// A structural signature that ignores volatile states (e.g. which nav item is
// aria-current on this page) so the same region matches across pages.
function subtreeSignature(node) {
  if (!node) return "";
  const name = typeof node.name === "string" ? node.name : "";
  const kids = (node.children || []).map(subtreeSignature).join(",");
  return `${node.role || ""}:${name}(${kids})`;
}

const CHROME_ROLES = new Set([
  "banner",
  "navigation",
  "complementary",
  "contentinfo",
]);

// Collect the signatures of every chrome region in a tree (without recursing
// into them). Used to determine chrome "ownership" deterministically across
// pages regardless of the order they were captured in.
function chromeSignatures(tree) {
  const sigs = new Set();
  const walk = (node) => {
    if (!node) return;
    if (CHROME_ROLES.has(node.role)) {
      sigs.add(subtreeSignature(node));
      return;
    }
    (node.children || []).forEach(walk);
  };
  walk(tree);
  return sigs;
}

// Prune chrome regions not owned by this page index (owner = first page, in
// audit order, that contains the region). Order-independent equivalent of
// pruneSharedChrome, so it works with parallel capture.
function pruneChromeByOwner(node, ownerBySig, index) {
  if (!node) return null;
  if (CHROME_ROLES.has(node.role)) {
    return ownerBySig.get(subtreeSignature(node)) === index ? node : null;
  }
  const children = (node.children || [])
    .map((c) => pruneChromeByOwner(c, ownerBySig, index))
    .filter(Boolean);
  return { ...node, children };
}

/* -------------------------------------------------------------------- */
/* Concurrency                                                           */
/* -------------------------------------------------------------------- */

// Run `fn` over items with a fixed pool of workers, preserving result order.
async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i], i);
    }
  };
  const count = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: count }, worker));
  return results;
}

// Like mapPool, but each worker owns one Playwright page from `pages` for the
// duration of the run, so page work happens in parallel without sharing a page.
async function mapWithPages(items, pages, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    pages.map(async (page) => {
      for (let i = next++; i < items.length; i = next++) {
        results[i] = await fn(items[i], i, page);
      }
    })
  );
  return results;
}

/* -------------------------------------------------------------------- */
/* Ollama                                                                */
/* -------------------------------------------------------------------- */

/* -------------------------------------------------------------------- */
/* Analysis: axe-core (deterministic) + LLM (context-aware)              */
/* -------------------------------------------------------------------- */

const SEVERITY_RANK = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
};
const SEVERITIES = ["critical", "serious", "moderate", "minor"];

// Deterministic-first ordering across finding sources: axe (rule engine),
// then keyboard (heuristic interaction checks), then ai (context review).
const SOURCE_RANK = { axe: 0, keyboard: 1, ai: 2 };

function kebab(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Findings are ordered by severity, then deterministic (axe) before heuristic
// (ai), then id — so output is stable across runs.
function sortFindings(a, b) {
  const rank = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (rank !== 0) return rank;
  const sourceRank =
    (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9);
  if (sourceRank !== 0) return sourceRank;
  return a.id.localeCompare(b.id);
}

/* ---- Deterministic layer: axe-core (the engine Lighthouse uses) ------ */

// Inject axe-core into the page (once) and run it for the given WCAG tag set.
// bypassCSP on the browser context ensures the inline script is allowed.
async function runAxe(page, axeSource, tags) {
  const loaded = await page.evaluate(() => Boolean(window.axe));
  if (!loaded) await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(
    (runOptions) => window.axe.run(document, runOptions),
    { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] }
  );
  return result?.violations ?? [];
}

// Extract the WCAG success-criterion number (e.g. "4.1.2") from axe's tags.
function wcagFromTags(tags = []) {
  for (const tag of tags) {
    const match = /^wcag(\d)(\d)(\d+)$/.exec(tag);
    if (match) return `${match[1]}.${match[2]}.${match[3]}`;
  }
  return "";
}

// Pull a concise remediation line out of axe's multi-line failureSummary.
function summarizeFailure(node) {
  const summary = node?.failureSummary || "";
  const line = summary
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .find((s) => !/^fix (any|all) of the following/i.test(s));
  return line || "";
}

function axeViolationsToFindings(violations) {
  return violations.map((v) => {
    const nodes = v.nodes || [];
    const example = nodes[0];
    return {
      source: "axe",
      id: v.id,
      severity: SEVERITIES.includes(v.impact) ? v.impact : "moderate",
      wcag: wcagFromTags(v.tags),
      count: nodes.length || 1,
      location: example ? (example.target || []).join(" ") : "",
      examples: nodes.slice(0, 3).map((n) => (n.target || []).join(" ")),
      issue: v.help,
      fix: summarizeFailure(example) || v.description || `See ${v.helpUrl}`,
      helpUrl: v.helpUrl,
    };
  });
}

/* ---- Interaction layer: keyboard-navigation smoke checks ------------ */

// Lightweight keyboard-accessibility smoke test. Tabs through the page and
// flags the most common keyboard barriers a static tree/axe scan can't see:
//  - focus that never moves at all (missing tab stops / scripted trap)
//  - focus landing on hidden or offscreen elements (invisible focus)
//  - focus getting stuck on a single element while tabbing (focus trap)
// This is a best-effort heuristic, not an exhaustive keyboard audit.
async function runKeyboardChecks(page, maxTabs = 30) {
  const describeActive = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) {
        return null;
      }
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const name = (
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.textContent ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60);
      const role = el.getAttribute("role") || el.tagName.toLowerCase();
      const visible =
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0;
      const inViewport =
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < (window.innerHeight || 0) &&
        rect.left < (window.innerWidth || 0);
      return {
        descriptor: `${role}:${name}:${Math.round(rect.top)}x${Math.round(
          rect.left
        )}`,
        role,
        name,
        visible,
        inViewport,
      };
    });

  const findings = [];
  const pushOnce = (() => {
    const seen = new Set();
    return (finding) => {
      const key = `${finding.id}|${finding.location}`;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push(finding);
    };
  })();

  // Start from a known baseline so the first Tab lands on the first stop.
  try {
    await page.evaluate(() => {
      const el = document.activeElement;
      if (el && typeof el.blur === "function") el.blur();
    });
  } catch {
    // ignore — some pages restrict focus scripting
  }

  let movedAtLeastOnce = false;
  let lastDescriptor = null;
  let stuckCount = 0;

  for (let i = 0; i < maxTabs; i++) {
    try {
      await page.keyboard.press("Tab");
    } catch {
      break;
    }
    let info;
    try {
      info = await describeActive();
    } catch {
      break;
    }
    if (!info) continue;

    if (info.descriptor === lastDescriptor) {
      stuckCount += 1;
    } else {
      stuckCount = 0;
      movedAtLeastOnce = true;
    }
    lastDescriptor = info.descriptor;

    const where = `${info.role}${info.name ? ` "${info.name}"` : ""}`;
    if (!info.visible) {
      pushOnce({
        source: "keyboard",
        id: "keyboard-hidden-focus",
        severity: "serious",
        wcag: "2.4.7",
        count: 1,
        location: where,
        issue: "A focusable element receives keyboard focus while not visible.",
        fix: "Remove hidden/offscreen elements from the tab order, or reveal them when focused.",
      });
    } else if (!info.inViewport) {
      pushOnce({
        source: "keyboard",
        id: "keyboard-offscreen-focus",
        severity: "moderate",
        wcag: "2.4.7",
        count: 1,
        location: where,
        issue:
          "Keyboard focus moves to an element rendered outside the viewport.",
        fix: "Ensure focused elements scroll into view, or are not focusable while offscreen.",
      });
    }

    if (stuckCount >= 5) {
      pushOnce({
        source: "keyboard",
        id: "keyboard-focus-trap",
        severity: "critical",
        wcag: "2.1.2",
        count: 1,
        location: where,
        issue:
          "Keyboard focus appears trapped on a single element while tabbing.",
        fix: "Allow focus to move away with Tab/Shift+Tab; only trap focus inside open modals.",
      });
      break;
    }
  }

  if (!movedAtLeastOnce) {
    pushOnce({
      source: "keyboard",
      id: "keyboard-no-focus-move",
      severity: "serious",
      wcag: "2.1.1",
      count: 1,
      location: "document",
      issue: "Pressing Tab did not move focus to any interactive element.",
      fix: "Provide focusable, keyboard-operable controls with a logical tab order.",
    });
  }

  return findings;
}

/* ---- Context-aware layer: the LLM (what axe can't judge) ------------- */

function buildContextPrompt(pagePath, treeOutline, knownRuleIds) {
  return `You are a senior accessibility (WCAG 2.1/2.2 AA) expert reviewing the page ${pagePath}.

The page's accessibility tree is given as an indented outline: each line is role "accessible name" [state=value ...]; deeper indentation = descendant; a line like '… (12 more similar listitem)' means structurally-identical siblings were omitted.

Shared site chrome (main navigation, banner, footer, status bar) has been REMOVED from this outline because it is audited once elsewhere. Review only the page-unique content shown.

A deterministic rule engine (axe-core) has ALREADY reported these rule ids — do NOT repeat or restate them: ${knownRuleIds.join(", ") || "(none)"}.

Report ONLY genuine issues that need human-like CONTEXT a rule engine cannot judge, where a screen-reader user would be confused or misled. For example:
- two or more controls with the SAME accessible name leading to DIFFERENT destinations/actions, with nothing to tell them apart
- an accessible name that clearly contradicts or misrepresents the control's purpose
- heading text or order that misrepresents the actual content hierarchy

Strict rules — follow ALL of them:
- Be conservative: when in doubt, do NOT report. Prefer zero findings over speculative ones.
- A finding MUST cite a real WCAG success-criterion number (e.g. "2.4.4"). If you cannot, omit the finding.
- Quote the exact accessible name from the outline in "location".
- Do NOT claim anything is "duplicated" — repeated/omitted siblings are not shown, so you cannot judge counts.
- Do NOT flag concise, conventional UI labels that are clear in context. These are FINE, never report them: "Delete", "Save", "Edit", "Add device", "Filters", "Take action", "Summary"/"Network"/"Configuration" tabs, a logo/"Homepage" link, usernames, and product/brand names.
- Do NOT restate rule-engine checks (missing name, missing alt, contrast, ARIA validity, list nesting).
- Do NOT suggest making labels longer purely for verbosity.
- NEVER include a URL, link, or web address in any field.
- Report at most 3 of the highest-confidence issues.

For each issue output:
- "severity": "critical" | "serious" | "moderate" | "minor"
- "wcag": success criterion number only (e.g. "2.4.4")
- "location": short locator quoting role + exact name + nearest landmark/heading from the outline
- "issue": one factual sentence (<= 22 words) citing the evidence
- "fix": one imperative sentence (<= 22 words)

Accessibility outline:
${treeOutline}

Return ONLY JSON: {"findings":[{"severity":string,"wcag":string,"location":string,"issue":string,"fix":string}]}`;
}

async function runContextChecks(
  ollamaUrl,
  model,
  pagePath,
  treeOutline,
  knownRuleIds,
  numCtx,
  timeoutMs
) {
  const prompt = buildContextPrompt(pagePath, treeOutline, knownRuleIds);
  const res = await fetchWithTimeout(
    `${ollamaUrl}/api/generate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: "json",
        options: {
          temperature: 0,
          top_p: 1,
          top_k: 1,
          seed: 42,
          repeat_penalty: 1,
          ...(numCtx ? { num_ctx: numCtx } : {}),
        },
      }),
    },
    timeoutMs
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Ollama request failed (${res.status} ${res.statusText}): ${body}`
    );
  }
  const data = await res.json();
  const usage = {
    prompt_eval_count: data.prompt_eval_count,
    eval_count: data.eval_count,
    eval_duration: data.eval_duration,
    total_duration: data.total_duration,
  };
  const findings = [];
  try {
    const parsed = JSON.parse(data.response?.trim() ?? "");
    const used = new Set();
    // The context model must never emit URLs; strip any that slip through.
    const stripUrls = (s) =>
      s
        .replace(/https?:\/\/\S+/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    for (const f of parsed.findings || []) {
      const issue = stripUrls(String(f?.issue ?? "").trim());
      if (!issue) continue;
      const wcag = String(f?.wcag ?? "").trim();
      // Precision filters: require a real WCAG criterion and reject the
      // duplication claims the model cannot actually verify from the outline.
      if (!/^\d\.\d\.\d+$/.test(wcag)) continue;
      if (/\bduplicat/i.test(issue)) continue;
      const base =
        kebab(String(f?.location || issue).slice(0, 40)) || "context-issue";
      let id = base;
      let n = 2;
      while (used.has(id)) id = `${base}-${n++}`;
      used.add(id);
      findings.push({
        source: "ai",
        id,
        severity: SEVERITIES.includes(f?.severity) ? f.severity : "moderate",
        wcag,
        count: 1,
        location: stripUrls(String(f?.location ?? "").trim()),
        issue,
        fix: stripUrls(String(f?.fix ?? "").trim()),
      });
    }
  } catch {
    // The context layer is best-effort; ignore malformed JSON.
  }
  return { findings, usage };
}

/* ---- Anti-hallucination guard --------------------------------------- */

// Collect every accessible name and role actually present in the tree so we
// can verify the LLM's findings reference real elements.
function collectTreeText(tree) {
  const names = new Set();
  const roles = new Set();
  const walk = (node) => {
    if (!node) return;
    if (node.role) roles.add(node.role.toLowerCase());
    if (typeof node.name === "string" && node.name.trim()) {
      names.add(node.name.trim().toLowerCase());
    }
    (node.children || []).forEach(walk);
  };
  walk(tree);
  return { names, roles };
}

// State/structure words that legitimately appear quoted in a finding but are
// not accessible names (so they shouldn't count as invented references).
const NON_NAME_WORDS = new Set([
  "true",
  "false",
  "focused",
  "invalid",
  "pressed",
  "selected",
  "expanded",
  "disabled",
  "required",
  "checked",
  "current",
  "level",
  "nearest landmark",
  "main content",
]);

function quotedTokens(text) {
  const tokens = [];
  const re = /'([^']+)'|"([^"]+)"/g;
  let match;
  while ((match = re.exec(text))) {
    tokens.push((match[1] ?? match[2]).trim());
  }
  return tokens;
}

// A finding is "grounded" only if it quotes at least one accessible name that
// actually exists in the tree, and quotes no name that does NOT exist. Quotes
// that are roles or state words are ignored. Findings that quote nothing are
// allowed (nothing specific to verify).
function isGroundedFinding(finding, names, roles) {
  const quoted = quotedTokens(`${finding.location} ${finding.issue}`).filter(
    (q) => q.length >= 2 && /[a-z]/i.test(q)
  );
  if (quoted.length === 0) return true;
  let referencesRealName = false;
  for (const q of quoted) {
    const norm = q.toLowerCase();
    if (names.has(norm)) {
      referencesRealName = true;
      continue;
    }
    if (roles.has(norm) || NON_NAME_WORDS.has(norm)) continue;
    return false; // quoted something that isn't a real name/role/state word
  }
  return referencesRealName;
}

/* ---- Context confidence annotation (tags, never drops) -------------- */

// Confidence scoring tags each LLM context finding with a reliability level and
// the data-driven signals behind it, so a human engineer is warned about
// shaky findings WITHOUT any finding being silently removed. Every signal looks
// at the finding's own wording and the captured tree — nothing app-specific.

// Interactive roles that legitimately carry an accessible name a user acts on.
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "textbox",
  "combobox",
  "searchbox",
  "slider",
  "spinbutton",
]);

// Roles that can receive focus (used by interaction-related criteria).
const FOCUSABLE_ROLES = new Set([
  ...INTERACTIVE_ROLES,
  "treegrid",
  "grid",
  "gridcell",
  "row",
  "tablist",
]);

// Role vocabulary used only to parse the cited element's role out of a
// finding's free-text location (lowercased to match outline tokens such as
// RootWebArea / StaticText / LabelText).
const ROLE_VOCAB = new Set([
  ...FOCUSABLE_ROLES,
  "rootwebarea",
  "main",
  "banner",
  "navigation",
  "complementary",
  "contentinfo",
  "region",
  "form",
  "search",
  "heading",
  "sectionheader",
  "sectionfooter",
  "list",
  "listitem",
  "columnheader",
  "rowgroup",
  "table",
  "cell",
  "separator",
  "image",
  "img",
  "paragraph",
  "statictext",
  "labeltext",
  "generic",
  "group",
  "alert",
  "status",
  "dialog",
  "strong",
  "emphasis",
  "code",
  "tree",
  "menulistpopup",
]);

// Generic WCAG criterion → roles the criterion can apply to (WCAG semantics,
// not anything MAAS-specific). Criteria with no rule here are always allowed.
function criterionAllowsRole(wcag, role) {
  if (!role) return true; // role indeterminate → no signal
  switch (wcag) {
    case "2.4.4": // Link Purpose (In Context)
      return role === "link";
    case "2.5.3": // Label in Name
      return INTERACTIVE_ROLES.has(role);
    case "2.4.7": // Focus Visible
    case "2.1.1": // Keyboard
    case "2.1.2": // No Keyboard Trap
    case "2.1.4": // Character Key Shortcuts
      return FOCUSABLE_ROLES.has(role);
    default:
      return true;
  }
}

// Phrasing detectors inspect what the finding CLAIMS (never page identity).
function assertsMissingName(text) {
  return (
    /\b(lacks?|missing|without|has no|have no|no)\b[^.]*\b(accessible\s+)?(name|label|text|description)\b/i.test(
      text
    ) ||
    /\bdoes not (have|provide)\b[^.]*\b(name|label|text|description|clear|meaningful|descriptive)\b/i.test(
      text
    ) ||
    /\bnot\s+(descriptive|unique|meaningful|clear|concise)\b/i.test(text)
  );
}

function assertsDuplicateName(text) {
  return (
    /\b(same|identical|duplicate|duplicated)\b[^.]*\b(name|label|text)\b/i.test(
      text
    ) ||
    /\b(multiple controls|ambiguous|indistinguishable)\b/i.test(text) ||
    /\bdistinguish\b/i.test(text)
  );
}

function isSubjectiveStyle(text) {
  return (
    /\bnot\s+(descriptive|unique|meaningful|clear|concise)\b/i.test(text) ||
    /\b(rephrase|reword|rename)\b/i.test(text) ||
    /\bupdate the (heading|button|label|text|static text)\b/i.test(text) ||
    /\bprovide (more )?context\b/i.test(text) ||
    /\badd (a |an )?(descriptive|brief|clear|concise|meaningful|unique)\b/i.test(
      text
    ) ||
    /\bdoes not provide (sufficient|a clear|a meaningful|a descriptive)\b/i.test(
      text
    ) ||
    /\blacks? (a |an )?(clear|concise|meaningful|unique|descriptive)\b/i.test(
      text
    )
  );
}

// "Verifiable" findings point at a relationship checkable from the tree
// (duplicate/ambiguous name, mismatch, or missing association) rather than a
// single-element opinion.
function hasVerifiableAnchor(text) {
  return (
    assertsDuplicateName(text) ||
    /\b(mismatch|contradicts?|does not match|inconsistent with|conflicts?)\b/i.test(
      text
    ) ||
    /\b(missing|no)\b[^.]*\b(label|relationship|association|programmatic)\b/i.test(
      text
    )
  );
}

// Parse the cited element's role: the role token just before the first quoted
// name in the location (falling back to the last role token anywhere).
function citedTargetRole(finding) {
  const loc = finding.location || "";
  const firstQuote = loc.search(/['"]/);
  const head = firstQuote >= 0 ? loc.slice(0, firstQuote) : loc;
  const headWords = head.toLowerCase().match(/[a-z]+/g) || [];
  for (let i = headWords.length - 1; i >= 0; i--) {
    if (ROLE_VOCAB.has(headWords[i])) return headWords[i];
  }
  const allWords = loc.toLowerCase().match(/[a-z]+/g) || [];
  for (let i = allWords.length - 1; i >= 0; i--) {
    if (ROLE_VOCAB.has(allWords[i])) return allWords[i];
  }
  return null;
}

// Build a per-page index for annotation: names under <main>, interactive
// control names that recur (≥2×, so duplicate claims can be confirmed), and
// the page title.
function buildAnnotationIndex(tree) {
  const names = new Set();
  const namesInMain = new Set();
  const interactiveNameCounts = new Map();
  const pageTitle =
    tree && typeof tree.name === "string" ? tree.name.trim().toLowerCase() : "";
  const walk = (node, inMain) => {
    if (!node) return;
    const role = (node.role || "").toLowerCase();
    const isMain = inMain || role === "main";
    const name = typeof node.name === "string" ? node.name.trim() : "";
    if (name) {
      const low = name.toLowerCase();
      names.add(low);
      if (isMain) namesInMain.add(low);
      if (INTERACTIVE_ROLES.has(role)) {
        interactiveNameCounts.set(
          low,
          (interactiveNameCounts.get(low) || 0) + 1
        );
      }
    }
    (node.children || []).forEach((child) => walk(child, isMain));
  };
  walk(tree, false);
  const duplicateInteractiveNames = new Set(
    [...interactiveNameCounts]
      .filter(([, count]) => count >= 2)
      .map(([name]) => name)
  );
  return { names, namesInMain, duplicateInteractiveNames, pageTitle };
}

// Flags that indicate a likely-unreliable finding (lower confidence).
const LOW_CONFIDENCE_FLAGS = new Set([
  "contradiction",
  "criterion-role",
  "unverified-duplicate",
  "outside-main",
]);

// Score one context finding: returns { confidence, flags } and never drops.
function scoreContextFinding(finding, index) {
  const text = `${finding.location || ""} ${finding.issue || ""}`;
  const quotedRealNames = quotedTokens(text)
    .map((q) => q.trim().toLowerCase())
    .filter((q) => index.names.has(q));
  const targetRole = citedTargetRole(finding);
  const flags = [];

  // Duplicate/ambiguity is the one claim we can positively confirm.
  if (assertsDuplicateName(text)) {
    const confirmed = quotedRealNames.some((n) =>
      index.duplicateInteractiveNames.has(n)
    );
    if (confirmed) return { confidence: "high", flags: ["verified-duplicate"] };
    flags.push("unverified-duplicate");
  }
  // Claims a missing/empty name while quoting a real, non-empty name.
  if (assertsMissingName(text) && quotedRealNames.length > 0) {
    flags.push("contradiction");
  }
  // Cited element exists only outside <main> (likely dev/browser tooling).
  if (
    quotedRealNames.length > 0 &&
    quotedRealNames.every((n) => !index.namesInMain.has(n))
  ) {
    flags.push("outside-main");
  }
  // Cited WCAG criterion cannot apply to the cited role.
  if (!criterionAllowsRole(finding.wcag, targetRole)) {
    flags.push("criterion-role");
  }
  // Heading/landmark whose name is already the page title.
  const titleRedundant =
    index.pageTitle &&
    quotedRealNames.some((n) => n.length > 1 && index.pageTitle.includes(n));
  if (
    (targetRole === "heading" || targetRole === "sectionheader") &&
    isSubjectiveStyle(text) &&
    titleRedundant
  ) {
    flags.push("title-redundant");
  }
  // Subjective single-element rewrite with no verifiable anchor.
  if (isSubjectiveStyle(text) && !hasVerifiableAnchor(text)) {
    flags.push("subjective");
  }

  let confidence = "medium";
  if (flags.some((f) => LOW_CONFIDENCE_FLAGS.has(f))) confidence = "low";
  else if (flags.length === 0 && hasVerifiableAnchor(text)) confidence = "high";
  return { confidence, flags };
}

// Attach { confidence, flags } to every context finding (no dropping).
function annotateContextFindings(findings, tree) {
  const index = buildAnnotationIndex(tree);
  return findings.map((finding) => {
    const { confidence, flags } = scoreContextFinding(finding, index);
    return { ...finding, confidence, flags };
  });
}

// Render a finding's confidence as a colourised console annotation line, or ""
// for non-context findings (axe/keyboard are deterministic, not annotated).
function confidenceConsoleLine(finding) {
  if (finding.source !== "ai" || !finding.confidence) return "";
  const color =
    finding.confidence === "high"
      ? pc.green
      : finding.confidence === "low"
        ? pc.red
        : pc.yellow;
  const flagStr =
    finding.flags && finding.flags.length
      ? pc.dim(` — ${finding.flags.join(", ")}`)
      : "";
  return `\n    ${pc.dim("confidence:")} ${color(finding.confidence)}${flagStr}`;
}

// Plain-text confidence suffix appended to a context finding's report cell.
function confidenceMarkdownSuffix(finding) {
  if (finding.source !== "ai" || !finding.confidence) return "";
  const flagStr =
    finding.flags && finding.flags.length
      ? `; flags: ${finding.flags.join(", ")}`
      : "";
  return ` _(confidence: ${finding.confidence}${flagStr})_`;
}

// Compact, deterministic one-finding-per-block rendering for the console.
function formatFindingsForConsole(audit) {
  if (audit.findings.length === 0) {
    return pc.green("✓ No findings.");
  }
  return audit.findings
    .map((f) => {
      const tag =
        f.source === "axe"
          ? pc.dim("[axe]")
          : f.source === "keyboard"
            ? pc.blue("[keyboard]")
            : pc.magenta("[ai·context]");
      const count = f.count > 1 ? pc.dim(` ×${f.count}`) : "";
      return (
        `${colorSeverity(f.severity)} ${tag} ${pc.dim(
          `(WCAG ${f.wcag || "—"})`
        )} ${pc.bold(f.id)}\n` +
        `    ${pc.dim("where:")} ${f.location || pc.dim("n/a")}${count}\n` +
        `    ${pc.dim("issue:")} ${f.issue}\n` +
        `    ${pc.dim("fix:  ")} ${pc.italic(f.fix)}` +
        (f.helpUrl ? `\n    ${pc.dim(f.helpUrl)}` : "") +
        confidenceConsoleLine(f)
      );
    })
    .join("\n\n");
}

// Markdown table — structured so a downstream fix-implementing model can
// parse locations and remediations directly.
function formatFindingsForMarkdown(audit) {
  if (audit.findings.length === 0) {
    return ["_No findings._"];
  }
  // Make arbitrary text safe inside a Markdown table cell: escape pipes (the
  // column separator), collapse newlines (cells are single-line), and
  // neutralise raw angle brackets so selector chains and HTML-like text such
  // as "<ul>/<ol>/<li>" or "<script>" aren't interpreted as HTML (which
  // corrupts the row/table). Backslashes are escaped first to avoid
  // double-processing the escapes we add.
  const cell = (s) =>
    String(s ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, " ")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const rows = audit.findings.map((f) => {
    const ref = f.helpUrl ? `[ref](${f.helpUrl})` : "";
    return `| ${cell(f.severity)} | ${cell(f.source)} | ${cell(
      f.wcag
    )} | ${cell(f.id)} | ${cell(f.count)} | ${cell(
      f.location || "n/a"
    )} | ${cell(f.issue) + confidenceMarkdownSuffix(f)} | ${cell(f.fix)} | ${ref} |`;
  });
  return [
    "| Severity | Source | WCAG | ID | Count | Location | Issue | Fix | Ref |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ];
}

/* -------------------------------------------------------------------- */
/* Main                                                                  */
/* -------------------------------------------------------------------- */

async function main() {
  new URL(startUrl); // throws if invalid - fail fast with a clear message

  const origin = new URL(startUrl).origin;
  // The SPA is mounted at <basename><ui-base> (e.g. /MAAS/r). Build the
  // in-app base so we crawl inside the app rather than the bare origin.
  const appBase = `${opts.basename}${opts.uiBase}`.replace(/\/+$/, "");
  const appRoot = `${origin}${appBase}/`;

  console.log(
    pc.bold(pc.magenta(`\n♿ a11y-audit`)) + pc.dim(` — ${startUrl}`)
  );

  // Overall wall-clock guard: forcibly abort a run that exceeds the budget
  // (e.g. a huge site or a hung Ollama). Unref'd so it never keeps the
  // process alive once the audit finishes normally.
  let auditTimeoutHandle = null;
  if (opts.auditTimeout > 0) {
    auditTimeoutHandle = setTimeout(() => {
      console.error(
        pc.red(`\nAudit timeout of ${opts.auditTimeout}ms exceeded — aborting.`)
      );
      process.exit(1);
    }, opts.auditTimeout);
    if (typeof auditTimeoutHandle.unref === "function") {
      auditTimeoutHandle.unref();
    }
  }

  // Resolve the context window automatically from the model (via Ollama's
  // /api/show) so the user doesn't have to know it. --num-ctx overrides it;
  // a conservative fallback is used only if the model can't be queried.
  const FALLBACK_NUM_CTX = 4096;
  const modelMaxContext = await getModelMaxContext(
    opts.ollamaUrl,
    opts.model,
    opts.ollamaTimeout
  );
  const numCtxSource = opts.numCtx
    ? "override"
    : modelMaxContext
      ? "model"
      : "fallback";
  const numCtx = opts.numCtx ?? modelMaxContext ?? FALLBACK_NUM_CTX;
  console.log(
    pc.dim(
      `  model ${opts.model} · context ${numCtx} tokens (${numCtxSource})` +
        (modelMaxContext ? ` · model max ${modelMaxContext}` : "")
    )
  );
  if (opts.numCtx && modelMaxContext && opts.numCtx > modelMaxContext) {
    console.log(
      pc.yellow(
        `  ! --num-ctx ${opts.numCtx} exceeds model max ${modelMaxContext}; it will be capped.`
      )
    );
  }

  let tokens;
  try {
    tokens = await withSpinner(
      `Authenticating as ${pc.cyan(opts.username)}`,
      () =>
        retry(
          () =>
            authenticate(
              origin,
              opts.basename,
              opts.username,
              opts.password,
              opts.timeout
            ),
          { attempts: opts.retries + 1, delayMs: 750 }
        )
    );
  } catch {
    process.exit(1);
  }

  const browser = await withSpinner("Launching browser", () =>
    chromium.launch({ headless: !opts.headed })
  );
  // bypassCSP so axe-core can be injected on pages with a strict CSP.
  const context = await browser.newContext({ bypassCSP: true });

  // Load axe-core's source once for injection into each audited page.
  let axeSource = "";
  try {
    const axeMain = require.resolve("axe-core");
    const axeMin = axeMain.replace(/axe\.js$/, "axe.min.js");
    axeSource = await fs.readFile(axeMin, "utf-8").catch(() => null);
    if (!axeSource) axeSource = await fs.readFile(axeMain, "utf-8");
  } catch (err) {
    console.error(pc.red(`Could not load axe-core: ${errorMessage(err)}`));
    process.exit(1);
  }

  // Inject the authenticated session cookies and skip the first-run wizard.
  await context.addCookies(buildAuthCookies(origin, tokens));
  // Expand the main navigation so its links render and are discoverable.
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("appSideNavIsCollapsed", "false");
    } catch {
      // ignore storage access errors
    }
  });

  const page = await context.newPage();

  // 1. Identify the major routes from the live main navigation.
  const majorRoutes = await withSpinner(
    "Detecting major navigation routes",
    () =>
      detectMajorRoutes(
        page,
        origin,
        appBase,
        appRoot,
        opts.timeout,
        opts.settle
      )
  );

  // 2. Let the user pick which major sections to audit (base path only).
  const { selectedSections } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "selectedSections",
      message: "Select the navigation sections you want to audit:",
      choices: majorRoutes.map((route) => ({
        name: route.path,
        value: route,
      })),
      validate: (ans) => (ans.length > 0 ? true : "Pick at least one section."),
    },
  ]);

  // 3. Crawl each chosen section separately. Each crawl may roam anywhere in
  //    the app except into *other* detected major routes, so it reaches its
  //    own detail pages without contaminating sibling sections.
  const allMajorPrefixes = majorRoutes.map(
    (route) => `${appBase}${sectionPrefix(route.path)}`
  );
  // Per-section de-duplication: collapse near-identical views *within* a
  // section (e.g. the detail pages of different records) without leaking
  // across sections. Cross-section navigation is already prevented during the
  // crawl, and isSameView treats a differing non-final segment as an id — so a
  // shared filter would wrongly collapse e.g. /machine/<id>/network against
  // /device/<id>/network. A fresh filter per section avoids that.
  let totalSkippedPaths = 0;
  const auditTargets = [];
  for (const route of selectedSections) {
    const ownPrefix = `${appBase}${sectionPrefix(route.path)}`;
    const otherMajorPrefixes = allMajorPrefixes.filter((p) => p !== ownPrefix);
    const sectionRootUrl = `${origin}${appBase}${route.path}`;
    const similarityFilter = createSimilarityFilter(opts.samplesPerPattern);
    const paths = await withSpinner(
      `Crawling ${pc.cyan(route.path)}`,
      (setText) =>
        discoverSectionPaths(
          page,
          sectionRootUrl,
          appBase,
          otherMajorPrefixes,
          opts.maxPages,
          opts.maxDepth,
          opts.timeout,
          opts.settle,
          similarityFilter
        ).then((found) => {
          const skipped = similarityFilter.skipped;
          totalSkippedPaths += skipped;
          setText(
            `Crawled ${pc.cyan(route.path)} ${pc.dim(
              `— ${found.length} path(s)${
                skipped ? `, ${skipped} similar skipped` : ""
              }`
            )}`
          );
          return found;
        })
    );
    for (const path of paths) {
      auditTargets.push({ section: route.label, path });
    }
  }

  if (auditTargets.length === 0) {
    console.log(pc.yellow("No paths discovered. Exiting."));
    await browser.close();
    if (auditTimeoutHandle) clearTimeout(auditTimeoutHandle);
    return;
  }

  // 4. Audit every discovered page, keeping results grouped by section.
  const results = [];
  // Cross-page state: findings already reported — so repeated site furniture
  // isn't re-flagged on every page.
  const reportedFindingKeys = new Set();
  let totalRepeatsFiltered = 0;
  let totalHallucinationsDropped = 0;
  const findingKey = (f) => `${f.source}|${f.id}|${f.location}`;

  // Phase 1 (parallel): capture each page's tree + run axe-core, using a pool
  // of pages so browser work overlaps. `page` is reused as the first worker.
  const pages = [page];
  for (let k = 1; k < Math.min(opts.concurrency, auditTargets.length); k++) {
    pages.push(await context.newPage());
  }
  let capturedCount = 0;
  const captures = await withSpinner(
    `Capturing ${auditTargets.length} page(s) with axe-core (×${pages.length})`,
    (setText) =>
      mapWithPages(auditTargets, pages, async (target, i, workerPage) => {
        const fullUrl = origin + target.path;
        try {
          await retry(
            () =>
              workerPage.goto(fullUrl, {
                waitUntil: "domcontentloaded",
                timeout: opts.timeout,
              }),
            { attempts: opts.retries + 1, delayMs: 500 }
          );
          await settlePage(workerPage, opts.timeout, opts.settle);
          const tree = await extractAccessibilityTree(workerPage);
          const violations = await runAxe(
            workerPage,
            axeSource,
            opts.axeTags
          ).catch(() => []);
          const keyboardFindings = opts.keyboardChecks
            ? await runKeyboardChecks(workerPage).catch(() => [])
            : [];
          capturedCount += 1;
          setText(`Captured ${capturedCount}/${auditTargets.length}`);
          return {
            ok: true,
            tree,
            summary: summarizeA11yTree(tree),
            treeJson: JSON.stringify(tree, null, 2),
            axeFindings: axeViolationsToFindings(violations),
            keyboardFindings,
          };
        } catch (err) {
          capturedCount += 1;
          setText(`Captured ${capturedCount}/${auditTargets.length}`);
          return { ok: false, error: errorMessage(err) };
        }
      })
  );

  // Determine chrome ownership deterministically (first page, in audit order,
  // that contains each region owns it) so parallel context reviews can prune
  // shared chrome consistently.
  const chromeOwner = new Map();
  if (opts.contextChecks) {
    for (let i = 0; i < captures.length; i++) {
      if (!captures[i].ok) continue;
      for (const sig of chromeSignatures(captures[i].tree)) {
        if (!chromeOwner.has(sig)) chromeOwner.set(sig, i);
      }
    }
  }

  // Phase 2 (parallel) with ordered streaming output: run the LLM context
  // review for each page concurrently, but print each page's block in audit
  // order as soon as it AND all earlier pages are ready. The flush is fully
  // synchronous, so concurrent workers can never interleave console output.
  const contextSlots = new Array(auditTargets.length);
  let nextToPrint = 0;

  const printPageBlock = (i) => {
    const { section, path: p } = auditTargets[i];
    const counter = pc.dim(`[${i + 1}/${auditTargets.length}]`);
    const cap = captures[i];
    if (!cap.ok) {
      console.error(pc.red(`  ! Failed to audit ${origin + p}: ${cap.error}`));
      results.push({
        section,
        path: p,
        audit: { page: p, error: cap.error, findings: [] },
      });
      return;
    }

    const { summary, treeJson, axeFindings, keyboardFindings = [] } = cap;
    const cr = contextSlots[i] || { findings: [], usage: null };

    printCapturedContents(p, summary, treeJson, opts.showTree);
    const keyboardNote = opts.keyboardChecks
      ? `, keyboard: ${keyboardFindings.length} issue(s)`
      : "";
    if (opts.contextChecks) {
      console.log(
        pc.dim(
          `  ${counter} axe: ${axeFindings.length} issue(s)${keyboardNote}; ` +
            `context outline: ${cr.outlineLines} lines (~${cr.outlineTokens} tokens)` +
            (cr.truncated ? pc.yellow(" — truncated to fit context") : "") +
            (cr.dropped ? `, ${cr.dropped} ungrounded dropped` : "")
        )
      );
    } else {
      console.log(
        pc.dim(
          `  ${counter} axe: ${axeFindings.length} issue(s)${keyboardNote}`
        )
      );
    }
    totalHallucinationsDropped += cr.dropped || 0;
    if (cr.error) {
      console.log(pc.yellow(`  ${counter} context review failed: ${cr.error}`));
    }

    // Filter out findings already reported on an earlier page (repeated
    // chrome that axe re-detects on every view).
    const merged = [...axeFindings, ...keyboardFindings, ...cr.findings];
    const findings = merged
      .filter((f) => !reportedFindingKeys.has(findingKey(f)))
      .sort(sortFindings);
    for (const f of findings) reportedFindingKeys.add(findingKey(f));
    const repeats = merged.length - findings.length;
    totalRepeatsFiltered += repeats;
    const audit = {
      page: p,
      findings,
      usage: cr.usage,
      axeCount: findings.filter((f) => f.source === "axe").length,
      keyboardCount: findings.filter((f) => f.source === "keyboard").length,
      contextCount: findings.filter((f) => f.source === "ai").length,
      ...(cr.error ? { contextError: cr.error } : {}),
    };

    results.push({ section, path: p, audit, summary, treeJson });
    console.log(
      pc.bold(
        `\n${pc.green("●")} Findings for ${pc.cyan(p)} ` +
          pc.dim(
            `(${audit.findings.length}: ${audit.axeCount} axe + ` +
              `${audit.keyboardCount} keyboard + ${audit.contextCount} context` +
              (repeats ? `, ${repeats} repeated filtered` : "") +
              `)`
          )
      )
    );
    console.log(formatFindingsForConsole(audit));
    if (audit.usage) {
      console.log(formatUsage(audit.usage));
      console.log(formatContextWindow(audit.usage, numCtx) + "\n");
    } else {
      console.log("");
    }
  };

  // Print every page whose turn has come (its slot and all earlier slots are
  // filled). Synchronous — safe to call from any worker on completion.
  const flushReady = () => {
    while (
      nextToPrint < auditTargets.length &&
      contextSlots[nextToPrint] !== undefined
    ) {
      printPageBlock(nextToPrint);
      nextToPrint += 1;
    }
  };

  if (opts.contextChecks) {
    console.log(
      pc.bold(
        `\nReviewing ${auditTargets.length} page(s) with ${pc.cyan(
          opts.model
        )} (×${opts.concurrency}):\n`
      )
    );
  }

  await mapPool(captures, opts.concurrency, async (cap, i) => {
    if (!cap.ok || !opts.contextChecks) {
      contextSlots[i] = { findings: [], usage: null };
      flushReady();
      return;
    }
    const uniqueTree = pruneChromeByOwner(cap.tree, chromeOwner, i);
    const sentTree = opts.prune
      ? preprocessTree(uniqueTree, opts.treeSamples)
      : uniqueTree;
    const { text: treeOutline, truncated } = capOutlineToContext(
      treeToOutline(sentTree),
      numCtx
    );
    const knownRuleIds = [...new Set(cap.axeFindings.map((f) => f.id))];
    let findings = [];
    let usage = null;
    try {
      ({ findings, usage } = await retry(
        () =>
          runContextChecks(
            opts.ollamaUrl,
            opts.model,
            auditTargets[i].path,
            treeOutline,
            knownRuleIds,
            numCtx,
            opts.ollamaTimeout
          ),
        { attempts: opts.retries + 1, delayMs: 750 }
      ));
    } catch (err) {
      // The LLM layer is optional: a failure here must not lose the
      // deterministic axe/keyboard findings or abort the whole run.
      contextSlots[i] = {
        findings: [],
        usage: null,
        error: errorMessage(err),
        outlineLines: treeOutline.split("\n").length,
        outlineTokens: Math.round(treeOutline.length / 4),
        truncated,
      };
      flushReady();
      return;
    }
    // Anti-hallucination guard: drop findings that cite elements not present
    // in the captured tree. Surviving findings are kept and annotated with a
    // confidence level (never dropped) so unreliable ones are flagged, not
    // silently removed.
    const { names, roles } = collectTreeText(cap.tree);
    const grounded = findings.filter((f) => isGroundedFinding(f, names, roles));
    const annotated = annotateContextFindings(grounded, cap.tree);
    contextSlots[i] = {
      findings: annotated,
      dropped: findings.length - grounded.length,
      usage,
      outlineLines: treeOutline.split("\n").length,
      outlineTokens: Math.round(treeOutline.length / 4),
      truncated,
    };
    flushReady();
  });
  flushReady();

  await browser.close();

  // The run completed within budget; cancel the wall-clock guard.
  if (auditTimeoutHandle) clearTimeout(auditTimeoutHandle);

  // Run summary: total findings (by severity) and aggregate token usage.
  const totalFindings = results.reduce(
    (n, r) => n + (r.audit?.findings?.length ?? 0),
    0
  );
  const severityTally = results
    .flatMap((r) => r.audit?.findings ?? [])
    .reduce((acc, f) => {
      acc[f.severity] = (acc[f.severity] || 0) + 1;
      return acc;
    }, {});
  // Tally findings by source (axe / keyboard / ai context) for the summary.
  const sourceTally = results
    .flatMap((r) => r.audit?.findings ?? [])
    .reduce((acc, f) => {
      acc[f.source] = (acc[f.source] || 0) + 1;
      return acc;
    }, {});
  // Keyboard-specific roll-up: total keyboard findings and how many audited
  // pages had at least one keyboard issue.
  const totalKeyboardFindings = sourceTally.keyboard || 0;
  const pagesWithKeyboardIssues = results.filter((r) =>
    (r.audit?.findings ?? []).some((f) => f.source === "keyboard")
  ).length;
  const totalTokens = results.reduce(
    (n, r) =>
      n +
      (r.audit?.usage?.prompt_eval_count ?? 0) +
      (r.audit?.usage?.eval_count ?? 0),
    0
  );
  const tallyStr =
    ["critical", "serious", "moderate", "minor"]
      .filter((s) => severityTally[s])
      .map((s) => `${colorSeverity(s)} ${severityTally[s]}`)
      .join(pc.dim(" · ")) || pc.green("none");
  // Findings grouped by source, e.g. "axe 4 · keyboard 2 · context 1".
  const SOURCE_LABELS = { axe: "axe", keyboard: "keyboard", ai: "context" };
  const sourceStr =
    ["axe", "keyboard", "ai"]
      .filter((src) => sourceTally[src])
      .map((src) => `${SOURCE_LABELS[src]} ${pc.cyan(sourceTally[src])}`)
      .join(pc.dim(" · ")) || pc.green("none");
  // Peak context-window fullness across all calls.
  const peakUsage = results.reduce(
    (max, r) => {
      const used =
        (r.audit?.usage?.prompt_eval_count ?? 0) +
        (r.audit?.usage?.eval_count ?? 0);
      return used > max.used ? { used, usage: r.audit.usage } : max;
    },
    { used: 0, usage: null }
  );
  console.log(pc.bold(`\n━━ Summary ━━`));
  console.log(
    `  pages audited: ${pc.cyan(results.length)}  ·  findings: ${pc.cyan(
      totalFindings
    )}  ·  tokens: ${pc.cyan(totalTokens)}`
  );
  console.log(`  by severity: ${tallyStr}`);
  console.log(`  by source: ${sourceStr}`);
  if (opts.keyboardChecks) {
    console.log(
      `  keyboard checks: ${
        totalKeyboardFindings > 0
          ? `${pc.cyan(totalKeyboardFindings)} issue(s) across ${pc.cyan(
              pagesWithKeyboardIssues
            )} page(s)`
          : pc.green("no issues")
      }`
    );
  }
  console.log(`  peak ${formatContextWindow(peakUsage.usage, numCtx)}`);
  if (totalHallucinationsDropped > 0) {
    console.log(
      pc.dim(
        `  dropped ${totalHallucinationsDropped} ungrounded context finding(s)`
      )
    );
  }
  if (totalRepeatsFiltered > 0) {
    console.log(
      pc.dim(
        `  filtered ${totalRepeatsFiltered} repeated finding(s) from shared chrome`
      )
    );
  }
  if (totalSkippedPaths > 0) {
    console.log(
      pc.dim(
        `  de-duplicated ${totalSkippedPaths} near-identical path(s) ` +
          `(--samples-per-pattern ${opts.samplesPerPattern})`
      )
    );
  }
  console.log("");

  if (opts.report) {
    const sections = [...new Set(results.map((r) => r.section))];
    const md = [
      `# Accessibility Audit Report`,
      `Site: ${startUrl}`,
      `Model: ${opts.model}`,
      `Generated: ${new Date().toISOString()}`,
      "",
      ...sections.flatMap((section) => [
        `# Section: ${section}`,
        "",
        ...results
          .filter((r) => r.section === section)
          .flatMap((r) => [
            `## ${r.path}`,
            "",
            ...(r.audit?.error
              ? [`> ⚠️ Audit failed: ${r.audit.error}`, ""]
              : []),
            ...(r.audit?.contextError
              ? [`> ⚠️ Context review failed: ${r.audit.contextError}`, ""]
              : []),
            ...(r.summary
              ? [
                  "<details><summary>Captured contents</summary>",
                  "",
                  "```",
                  formatTreeSummary(r.summary),
                  "```",
                  "",
                  ...(opts.showTree && r.treeJson
                    ? ["```json", r.treeJson, "```", ""]
                    : []),
                  "</details>",
                  "",
                ]
              : []),
            ...formatFindingsForMarkdown(r.audit),
            "",
          ]),
      ]),
    ].join("\n");
    await fs.writeFile(opts.report, md, "utf-8");
    console.log(pc.green(`✔ Report written to ${pc.bold(opts.report)}`));

    // Also emit a machine-consumable JSON artifact (deterministic, schema'd)
    // that can be fed directly into a fix-implementing model.
    const jsonReport = {
      site: startUrl,
      model: opts.model,
      generated: new Date().toISOString(),
      pages: results.map((r) => ({
        section: r.section,
        path: r.path,
        findings: r.audit?.findings ?? [],
        ...(r.audit?.error ? { error: r.audit.error } : {}),
        ...(r.audit?.contextError
          ? { contextError: r.audit.contextError }
          : {}),
      })),
    };
    const jsonPath = opts.report.replace(/\.md$/i, "") + ".json";
    await fs.writeFile(jsonPath, JSON.stringify(jsonReport, null, 2), "utf-8");
    console.log(
      pc.green(`✔ Structured findings written to ${pc.bold(jsonPath)}`)
    );
  }
}

main().catch((err) => {
  console.error(pc.red("Fatal error:"), err);
  process.exit(1);
});
