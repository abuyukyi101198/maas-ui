/* Output: console, Markdown report, JSON report, run summary. */

import fs from "node:fs/promises";
import ora from "ora";
import pc from "picocolors";

import {
  MAX_CONTEXT_FINDINGS,
  SEVERITIES,
  SEVERITY_RANK,
} from "./constants.js";
import { LOW_CONFIDENCE_FLAGS } from "./grounding.js";
import { errorMessage } from "./util.js";

/* ---- Console helpers ------------------------------------------------ */

// Run an async task behind an animated spinner. Falls back to plain logging
// when stdout isn't a TTY (e.g. piped to a file or in CI).
export async function withSpinner(text, task) {
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
export function formatUsage(usage) {
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
export function formatContextWindow(usage, numCtx) {
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

const severityColor = {
  critical: (s) => pc.red(s.toUpperCase()),
  serious: (s) => pc.redBright(s.toUpperCase()),
  moderate: (s) => pc.yellow(s.toUpperCase()),
  minor: (s) => pc.cyan(s.toUpperCase()),
};

export function colorSeverity(severity) {
  const fn = severityColor[severity] ?? ((s) => s.toUpperCase());
  return fn(severity);
}

// Captured-contents panel for the console.
export function printCapturedContents(label, summary, treeJson) {
  const bar = pc.dim("─".repeat(64));
  console.log(pc.bold(pc.blue(`\n▼ Captured contents`)) + pc.dim(` ${label}`));
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
  if (treeJson) {
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

// Render the captured-tree summary as plain text for the Markdown report.
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

/* ---- Findings ------------------------------------------------------- */

// Render a finding's confidence as a colourised console line, or "" for
// non-context findings (axe/keyboard are deterministic, not annotated).
function confidenceConsoleLine(finding) {
  if (finding.source !== "ai" || !finding.confidence) return "";
  const color =
    finding.confidence === "high"
      ? pc.green
      : finding.confidence === "low"
        ? pc.red
        : pc.yellow;
  const flagStr = finding.flags?.length
    ? pc.dim(` — ${finding.flags.join(", ")}`)
    : "";
  const reason = finding.verifyReason
    ? `\n    ${pc.dim("verify:")} ${pc.dim(finding.verifyReason)}`
    : "";
  return `\n    ${pc.dim("confidence:")} ${color(finding.confidence)}${flagStr}${reason}`;
}

function confidenceMarkdownSuffix(finding) {
  if (finding.source !== "ai" || !finding.confidence) return "";
  const flagStr = finding.flags?.length
    ? `; flags: ${finding.flags.join(", ")}`
    : "";
  const reason = finding.verifyReason
    ? `; verify: ${finding.verifyReason}`
    : "";
  return ` _(confidence: ${finding.confidence}${flagStr}${reason})_`;
}

const SOURCE_TAGS = {
  axe: () => pc.dim("[axe]"),
  keyboard: () => pc.blue("[keyboard]"),
  ai: () => pc.magenta("[ai·context]"),
};

export function formatFindingsForConsole(findings) {
  if (findings.length === 0) return pc.green("✓ No findings.");
  return findings
    .map((f) => {
      const tag = (SOURCE_TAGS[f.source] ?? SOURCE_TAGS.ai)();
      const count = f.count > 1 ? pc.dim(` ×${f.count}`) : "";
      const kind = f.kind ? pc.dim(` ${f.kind}`) : "";
      return (
        `${colorSeverity(f.severity)} ${tag}${kind} ${pc.dim(
          `(WCAG ${f.wcag || "—"})`
        )} ${pc.bold(f.id)}\n` +
        `    ${pc.dim("where:")} ${f.location || pc.dim("n/a")}${count}\n` +
        (f.selector ? `    ${pc.dim("css:  ")} ${f.selector}\n` : "") +
        `    ${pc.dim("issue:")} ${f.issue}\n` +
        `    ${pc.dim("fix:  ")} ${pc.italic(f.fix)}` +
        (f.helpUrl ? `\n    ${pc.dim(f.helpUrl)}` : "") +
        confidenceConsoleLine(f)
      );
    })
    .join("\n\n");
}

// Make arbitrary text safe inside a Markdown table cell: escape pipes (the
// column separator), collapse newlines, and neutralise raw angle brackets so
// selector chains and HTML-like text aren't interpreted as HTML. Backslashes
// are escaped first to avoid double-processing the escapes added here.
const cell = (s) =>
  String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// Markdown table — structured so a downstream fix-implementing model can
// parse locations and remediations directly.
function formatFindingsForMarkdown(findings) {
  if (findings.length === 0) return ["_No findings._"];
  const rows = findings.map((f) => {
    const ref = f.helpUrl ? `[ref](${f.helpUrl})` : "";
    const selector = f.selector ? ` (css: ${f.selector})` : "";
    const alsoOn = f.alsoOn?.length
      ? ` (also on ${f.alsoOn.length} page(s): ${f.alsoOn.join(", ")})`
      : "";
    return `| ${cell(f.severity)} | ${cell(f.source)} | ${cell(
      f.wcag
    )} | ${cell(f.id)} | ${cell(f.count)} | ${cell(
      (f.location || "n/a") + selector + alsoOn
    )} | ${cell(f.issue) + confidenceMarkdownSuffix(f)} | ${cell(f.fix)} | ${ref} |`;
  });
  return [
    "| Severity | Source | WCAG | ID | Count | Location | Issue | Fix | Ref |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ];
}

// Whether a finding counts towards --fail-on and "actionable" totals: every
// deterministic finding, and context findings not marked low confidence.
export function isActionable(finding) {
  return !(finding.source === "ai" && finding.confidence === "low");
}

export function countAtOrAbove(results, severity) {
  const limit = SEVERITY_RANK[severity];
  return results
    .flatMap((r) => r.findings)
    .filter((f) => isActionable(f) && SEVERITY_RANK[f.severity] <= limit)
    .length;
}

/* ---- Summary -------------------------------------------------------- */

const SOURCE_LABELS = { axe: "axe", keyboard: "keyboard", ai: "context" };

// `results`: one entry per audited view (see index.js); `stats`: run counters.
export function printSummary(results, stats, { opts, numCtx }) {
  const audited = results.filter((r) => !r.skipped && !r.error);
  const findings = results.flatMap((r) => r.findings);
  const tally = (key) =>
    findings.reduce((acc, f) => {
      acc[f[key]] = (acc[f[key]] || 0) + 1;
      return acc;
    }, {});
  const severityTally = tally("severity");
  const sourceTally = tally("source");
  const totalTokens = results.reduce(
    (n, r) =>
      n +
      (r.usage?.prompt_eval_count ?? 0) +
      (r.usage?.eval_count ?? 0) +
      (r.verifyTokens ?? 0),
    0
  );
  const tallyStr =
    SEVERITIES.filter((s) => severityTally[s])
      .map((s) => `${colorSeverity(s)} ${severityTally[s]}`)
      .join(pc.dim(" · ")) || pc.green("none");
  const sourceStr =
    ["axe", "keyboard", "ai"]
      .filter((src) => sourceTally[src])
      .map((src) => `${SOURCE_LABELS[src]} ${pc.cyan(sourceTally[src])}`)
      .join(pc.dim(" · ")) || pc.green("none");
  const peakUsage = results.reduce(
    (max, r) => {
      const used =
        (r.usage?.prompt_eval_count ?? 0) + (r.usage?.eval_count ?? 0);
      return used > max.used ? { used, usage: r.usage } : max;
    },
    { used: 0, usage: null }
  );

  const note = (count, text, color = pc.dim) => {
    if (count > 0) console.log(color(`  ${text}`));
  };

  console.log(pc.bold(`\n━━ Summary ━━`));
  console.log(
    `  views audited: ${pc.cyan(audited.length)}  ·  findings: ${pc.cyan(
      findings.length
    )}  ·  tokens: ${pc.cyan(totalTokens)}`
  );
  console.log(`  by severity: ${tallyStr}`);
  console.log(`  by source: ${sourceStr}`);
  if (opts.keyboardChecks) {
    const kb = sourceTally.keyboard || 0;
    const pages = results.filter((r) =>
      r.findings.some((f) => f.source === "keyboard")
    ).length;
    console.log(
      `  keyboard checks: ${
        kb > 0
          ? `${pc.cyan(kb)} issue(s) across ${pc.cyan(pages)} view(s)`
          : pc.green("no issues")
      }`
    );
  }
  if (opts.contextChecks) {
    const lowConfidence = findings.filter(
      (f) => f.source === "ai" && f.confidence === "low"
    ).length;
    console.log(`  peak ${formatContextWindow(peakUsage.usage, numCtx)}`);
    note(
      lowConfidence,
      `${lowConfidence} context finding(s) are low confidence (flags: ${[
        ...LOW_CONFIDENCE_FLAGS,
      ].join(", ")}); review before acting`
    );
  }
  note(
    stats.contextErrors,
    `context review failed on ${stats.contextErrors} view(s) ` +
      "(axe/keyboard findings for them are still reported)",
    pc.yellow
  );
  note(
    stats.parseFailures,
    `the model returned malformed JSON ${stats.parseFailures} time(s) ` +
      "(each was retried; reviews that never parsed count as failed)",
    pc.yellow
  );
  note(
    stats.unsettled,
    `${stats.unsettled} view(s) did not finish loading; their findings may be partial`,
    pc.yellow
  );
  note(
    stats.truncated,
    `${stats.truncated} outline(s) were cut to fit the context window ` +
      "(raise --num-ctx or lower --tree-samples for fuller coverage)",
    pc.yellow
  );
  note(
    stats.skippedPages,
    `skipped ${stats.skippedPages} page(s) that redirected or showed an error view`,
    pc.yellow
  );
  note(
    stats.failedPages,
    `${stats.failedPages} page(s) failed to load or capture`,
    pc.red
  );
  note(
    stats.interactionErrors,
    `${stats.interactionErrors} interaction(s) could not be activated`,
    pc.yellow
  );
  note(
    stats.dropped,
    `dropped ${stats.dropped} ungrounded context finding(s) (cited elements not in the outline)`
  );
  note(
    stats.invalidWcag,
    `dropped ${stats.invalidWcag} context finding(s) citing an invalid WCAG criterion`
  );
  note(
    stats.capped,
    `dropped ${stats.capped} context finding(s) over the ${MAX_CONTEXT_FINDINGS}-per-view cap`
  );
  note(
    stats.repeats,
    `filtered ${stats.repeats} repeated finding(s) already reported on an ` +
      "earlier view (see “also on” in the reports)"
  );
  note(
    stats.similarSkipped,
    `de-duplicated ${stats.similarSkipped} near-identical path(s) ` +
      `(--samples-per-pattern ${opts.samplesPerPattern})`
  );
  note(
    stats.crossSectionDuplicates,
    `skipped ${stats.crossSectionDuplicates} path(s) already audited under another section`
  );
  console.log("");
}

/* ---- Reports -------------------------------------------------------- */

const quote = (lines) => [...lines.map((l) => `> ${l}`), ""];

function viewNotes(r) {
  return [
    ...(r.error ? quote([`⚠️ Audit failed: ${r.error}`]) : []),
    ...(r.skipped ? quote([`⏭️ Skipped: ${r.skipped}`]) : []),
    ...(r.interaction
      ? quote([
          `🖱️ State after activating ${r.interaction.role} "${r.interaction.name}"`,
        ])
      : []),
    ...(r.redirectedFrom
      ? quote([`↪️ Reached via \`${r.redirectedFrom}\` (redirect)`])
      : []),
    ...(r.settled === false
      ? quote(["⚠️ Page did not finish loading; findings may be partial."])
      : []),
    ...(r.truncated
      ? quote([
          "✂️ The outline was cut to fit the context window; the context review saw only part of this view.",
        ])
      : []),
    ...(r.contextError
      ? quote([`⚠️ Context review failed: ${r.contextError}`])
      : []),
  ];
}

export async function writeMarkdownReport(file, results, meta) {
  const sections = [...new Set(results.map((r) => r.section))];
  const md = [
    `# Accessibility Audit Report`,
    "",
    `- Site: ${meta.site}`,
    `- Model: ${meta.model ?? "(context review disabled)"}`,
    `- Generated: ${meta.generated}`,
    "",
    ...sections.flatMap((section) => [
      `# Section: ${section}`,
      "",
      ...results
        .filter((r) => r.section === section)
        .flatMap((r) => [
          `## ${r.label}`,
          "",
          `Route: \`${r.routePattern}\``,
          "",
          ...viewNotes(r),
          ...(r.summary
            ? [
                "<details><summary>Captured contents</summary>",
                "",
                "```",
                formatTreeSummary(r.summary),
                "```",
                "",
                ...(r.treeJson ? ["```json", r.treeJson, "```", ""] : []),
                "</details>",
                "",
              ]
            : []),
          ...formatFindingsForMarkdown(r.findings),
          "",
        ]),
    ]),
  ].join("\n");
  await fs.writeFile(file, md, "utf-8");
}

// Strip internal bookkeeping (axe fingerprints) from a finding for output.
function publicFinding(f, r) {
  const { elements, ...rest } = f;
  return {
    ...rest,
    ...(elements
      ? { elements: elements.map(({ target, html }) => ({ target, html })) }
      : {}),
    route: r.route,
    routePattern: r.routePattern,
  };
}

// Machine-consumable JSON (stable shape) that can be fed to a fix-implementing
// model or diffed between runs. Each finding carries the route and the route
// pattern (ids replaced by ":id") of the view it was found on, so it can be
// mapped back to the route definitions in the source.
export async function writeJsonReport(file, results, meta, stats) {
  const findings = results.flatMap((r) => r.findings);
  const bySeverity = Object.fromEntries(
    SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length])
  );
  const bySource = Object.fromEntries(
    ["axe", "keyboard", "ai"].map((s) => [
      s,
      findings.filter((f) => f.source === s).length,
    ])
  );
  const report = {
    site: meta.site,
    model: meta.model,
    generated: meta.generated,
    summary: {
      views: results.filter((r) => !r.skipped && !r.error).length,
      findings: findings.length,
      bySeverity,
      bySource,
      lowConfidenceContext: findings.filter((f) => !isActionable(f)).length,
      ...stats,
    },
    pages: results.map((r) => ({
      section: r.section,
      path: r.path,
      route: r.route,
      routePattern: r.routePattern,
      ...(r.interaction ? { interaction: r.interaction } : {}),
      ...(r.redirectedFrom ? { redirectedFrom: r.redirectedFrom } : {}),
      ...(r.settled === false ? { settled: false } : {}),
      ...(r.truncated ? { outlineTruncated: true } : {}),
      ...(r.skipped ? { skipped: r.skipped } : {}),
      ...(r.error ? { error: r.error } : {}),
      ...(r.contextError ? { contextError: r.contextError } : {}),
      findings: r.findings.map((f) => publicFinding(f, r)),
    })),
  };
  await fs.writeFile(file, JSON.stringify(report, null, 2), "utf-8");
}
