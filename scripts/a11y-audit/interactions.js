/* UI that opens without a URL change: menus, side panels, dialogs. */

import fs from "node:fs/promises";

import { settlePage } from "./crawl.js";
import { runDialogChecks } from "./keyboard.js";
import { errorMessage, throwIfAborted } from "./util.js";

// Which buttons --interactions activates. A button inside the main landmark is
// activated when it declares a popup (menu/listbox/dialog) or its name matches
// `include`, unless its name matches `exclude`. Only the trigger itself is
// clicked: nothing inside the opened menu/panel/dialog is ever clicked, and
// forms are never submitted, so the audit doesn't change MAAS state.
export const DEFAULT_INTERACTION_CONFIG = {
  include: ["^add\\b", "^take action$", "^filters?$", "^columns$", "^actions$"],
  exclude: [
    "delete|remove|destroy|erase|release|abort|deploy|commission|power|lock|reset",
    "disconnect|log ?out|sign ?out|submit|save|apply|confirm",
  ],
  haspopup: true,
  maxPerPage: 5,
};

function compilePatterns(patterns, field) {
  if (!Array.isArray(patterns)) {
    throw new Error(`Interactions config: "${field}" must be an array.`);
  }
  return patterns.map((p) => {
    try {
      return new RegExp(p, "i");
    } catch (err) {
      throw new Error(
        `Interactions config: invalid "${field}" pattern ${JSON.stringify(p)} ` +
          `(${errorMessage(err)})`
      );
    }
  });
}

// Load --interactions-config (merged over the defaults) and compile it.
export async function loadInteractionConfig(file) {
  let config = DEFAULT_INTERACTION_CONFIG;
  if (file) {
    const raw = JSON.parse(await fs.readFile(file, "utf-8"));
    config = { ...DEFAULT_INTERACTION_CONFIG, ...raw };
  }
  const maxPerPage = parseInt(config.maxPerPage, 10);
  return {
    include: compilePatterns(config.include, "include"),
    exclude: compilePatterns(config.exclude, "exclude"),
    haspopup: Boolean(config.haspopup),
    maxPerPage: Number.isNaN(maxPerPage) ? 5 : Math.max(0, maxPerPage),
  };
}

// Pick the triggers to activate from the captured tree: enabled, named,
// collapsed buttons inside <main>, one per distinct name, in document order.
export function findTriggers(tree, config) {
  const triggers = [];
  const names = new Set();
  const walk = (node, inMain) => {
    if (!node || triggers.length >= config.maxPerPage) return;
    const role = node.role || "";
    const isMain = inMain || role === "main";
    const name = typeof node.name === "string" ? node.name.trim() : "";
    if (
      isMain &&
      role === "button" &&
      name &&
      !node.disabled &&
      node.expanded !== true &&
      !names.has(name.toLowerCase()) &&
      ((config.haspopup && node.haspopup) ||
        config.include.some((re) => re.test(name))) &&
      !config.exclude.some((re) => re.test(name))
    ) {
      names.add(name.toLowerCase());
      triggers.push({ role, name });
    }
    (node.children || []).forEach((child) => walk(child, isMain));
  };
  walk(tree, false);
  return triggers;
}

// Activate each trigger on a freshly loaded copy of the page, let the opened
// state settle, and capture it (tree + axe via `snapshot`, plus dialog/menu
// focus checks with --keyboard-checks). Triggers that navigate to another
// route are skipped (the crawl covers routes).
export async function runInteractions(
  page,
  { url, tree, config, opts, snapshot }
) {
  const results = [];
  const triggers = findTriggers(tree, config);
  const basePath = new URL(url).pathname;
  for (const [k, trigger] of triggers.entries()) {
    throwIfAborted();
    try {
      // Keyboard checks (and earlier triggers) leave the page in a changed
      // state, so start each trigger from a fresh load.
      if (k > 0 || opts.keyboardChecks) {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: opts.timeout,
        });
        await settlePage(page, opts.timeout, opts.settle);
      }
      const locator = page
        .getByRole("main")
        .getByRole(trigger.role, { name: trigger.name, exact: true })
        .first();
      await locator.evaluate((el) => {
        window.__a11yAuditTrigger = el;
      });
      await locator.click({ timeout: 5000 });
      const settled = await settlePage(page, opts.timeout, opts.settle);
      const landedPath = new URL(page.url()).pathname;
      if (landedPath !== basePath) {
        results.push({ trigger, skipped: `navigated to ${landedPath}` });
        continue;
      }
      const snap = await snapshot(settled);
      // The dialog checks close the opened UI with Escape themselves.
      const keyboardFindings = opts.keyboardChecks
        ? await runDialogChecks(page).catch(() => [])
        : [];
      if (!opts.keyboardChecks) {
        await page.keyboard.press("Escape").catch(() => {});
      }
      results.push({ trigger, ...snap, keyboardFindings });
    } catch (err) {
      throwIfAborted();
      results.push({ trigger, error: errorMessage(err) });
    }
  }
  return results;
}
