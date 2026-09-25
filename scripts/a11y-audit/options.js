/* Command-line options. */

import { Command, Option } from "commander";
import { fileURLToPath } from "node:url";

import { DEFAULT_MAX_NUM_CTX, SEVERITIES } from "./constants.js";

export const BUNDLED_ALLOW_LABELS = fileURLToPath(
  new URL("./allow-labels.maas.txt", import.meta.url)
);

const int = (min) => (v) => {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Expected a number, got "${v}".`);
  return Math.max(min, n);
};

const list = (v) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function parseOptions(argv) {
  const program = new Command();

  program
    .name("a11y-audit")
    .description(
      "Crawl MAAS, capture accessibility trees, run axe-core and optional " +
        "keyboard checks, and review page context with a local Ollama model"
    )
    .argument(
      "<url>",
      "MAAS origin (e.g. http://localhost:5240), or a page under the UI base " +
        "(e.g. http://localhost:5240/MAAS/r/machines) to audit just that section"
    )
    .requiredOption(
      "-u, --username <username>",
      "MAAS username to authenticate with"
    )
    .option(
      "-p, --password <password>",
      "MAAS password (not recommended: visible in shell history and `ps`). " +
        "Prefer the MAAS_PASSWORD environment variable, or omit both to be " +
        "prompted"
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

    // Section selection / non-interactive use
    .option(
      "--sections <list>",
      "Comma-separated sections to audit, by path or label (e.g. " +
        "/machines,Devices). Skips the interactive picker",
      list
    )
    .option("--all", "Audit every detected section (skips the picker)", false)
    .option(
      "-y, --yes",
      "Never prompt: audit all sections unless --sections is given, and fail " +
        "instead of asking for a password (for CI)",
      false
    )

    // Crawl
    .option(
      "--max-pages <n>",
      "Max pages to load per section while crawling",
      int(1),
      25
    )
    .option(
      "--max-depth <n>",
      "Max link-following depth while crawling",
      int(0),
      2
    )
    .option(
      "--samples-per-pattern <n>",
      "How many example pages to keep per group of similar paths (e.g. the " +
        "detail pages of different records). Raise to cover conditional rendering",
      int(1),
      1
    )
    .option(
      "--concurrency <n>",
      "How many browser tabs load and capture pages in parallel",
      int(1),
      3
    )
    .option(
      "--timeout <ms>",
      "Per-page navigation / readiness timeout in ms",
      int(1000),
      15000
    )
    .option(
      "--settle <ms>",
      "How long the DOM must be mutation-free before a page is considered " +
        "settled (lets async websocket data render before snapshotting)",
      int(0),
      1000
    )
    .option("--headed", "Run the browser with a visible window", false)

    // Checks
    .option(
      "--axe-tags <list>",
      "Comma-separated axe-core rule tags to run",
      list,
      ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]
    )
    .option(
      "--keyboard-checks",
      "Run keyboard checks on each page: tab order and Shift+Tab, visible " +
        "focus indicator, focus hidden under sticky content, focus traps, and " +
        "(with --interactions) dialog focus containment/return",
      false
    )
    .option(
      "--max-tabs <n>",
      "Upper bound on Tab presses per page for --keyboard-checks (the actual " +
        "count scales with the number of focusable elements)",
      int(1),
      150
    )
    .option(
      "--interactions",
      "Also audit UI that opens without a URL change: activate known " +
        "triggers (menus, 'Add …' buttons) on each page, capture and audit " +
        "the opened state, then close it. Never submits forms",
      false
    )
    .option(
      "--interactions-config <file>",
      "JSON file overriding which triggers --interactions activates " +
        '({"include": [regex], "exclude": [regex], "haspopup": bool, ' +
        '"maxPerPage": n})',
      null
    )

    // LLM context review
    .option(
      "--no-context-checks",
      "Skip the LLM context review (run only axe-core and keyboard checks)"
    )
    .option("-m, --model <name>", "Ollama model to use", "llama3")
    .option(
      "-o, --ollama-url <url>",
      "Ollama base URL",
      "http://localhost:11434"
    )
    .option(
      "--num-ctx <n>",
      `Override the context window size (tokens). Defaults to the model's own ` +
        `context length capped at ${DEFAULT_MAX_NUM_CTX} (large windows are ` +
        `slow and memory-hungry on local hardware); never exceeds the model max`,
      int(512)
    )
    .option(
      "--llm-concurrency <n>",
      "How many LLM requests to send to Ollama in parallel. Needs the " +
        "server's OLLAMA_NUM_PARALLEL to be at least this; drops to 1 " +
        "automatically if requests time out while queued",
      int(1),
      1
    )
    .option(
      "--ollama-timeout <ms>",
      "Per-request timeout for Ollama calls in ms (0 = disabled)",
      int(0),
      120000
    )
    .option(
      "--allow-labels <file>",
      "File of conventional labels (one per line, # comments) the model must " +
        "not flag as unclear; findings about them are marked low confidence",
      BUNDLED_ALLOW_LABELS
    )
    .option("--no-allow-labels", "Don't use an allow-labels file")
    .option(
      "--verify",
      "Second model pass: ask the model to confirm each context finding " +
        "against the outline (unconfirmed findings are marked low confidence)",
      false
    )
    .option(
      "--no-prune",
      "Disable accessibility-tree preprocessing (send the full tree to the model)"
    )
    .option(
      "--tree-samples <n>",
      "When preprocessing, how many examples of each repeated sibling subtree " +
        "(e.g. table rows, list items) to keep",
      int(1),
      3
    )

    // Output
    .option(
      "--report <path>",
      "Write the full audit report to a Markdown file",
      null
    )
    .option(
      "--json <path>",
      "Write structured findings to a JSON file",
      "a11y-audit.json"
    )
    .option("--no-json", "Don't write the JSON findings file")
    .option(
      "--show-tree",
      "Print the full captured accessibility tree (JSON) for each page",
      false
    )
    .addOption(
      new Option(
        "--fail-on <severity>",
        "Exit with code 2 when a finding at or above this severity exists " +
          "(low-confidence context findings are ignored)"
      ).choices(SEVERITIES)
    )

    // Reliability
    .option(
      "--retries <n>",
      "Retry attempts for transient navigation/auth/Ollama failures",
      int(0),
      2
    )
    .option(
      "--audit-timeout <ms>",
      "Overall wall-clock timeout for the run in ms, starting after section " +
        "selection (0 = disabled)",
      int(0),
      0
    )
    .parse(argv);

  return { opts: program.opts(), startUrl: program.args[0] };
}
