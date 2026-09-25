/* Deterministic layer: axe-core (the engine Lighthouse uses). */

import fs from "node:fs/promises";
import { createRequire } from "node:module";

import { SEVERITIES } from "./constants.js";

const require = createRequire(import.meta.url);

// Load axe-core's source once for injection into each audited page.
export async function loadAxeSource() {
  const axeMain = require.resolve("axe-core");
  const axeMin = axeMain.replace(/axe\.js$/, "axe.min.js");
  const minified = await fs.readFile(axeMin, "utf-8").catch(() => null);
  return minified || fs.readFile(axeMain, "utf-8");
}

// Inject axe-core into the page (once) and run it for the given WCAG tag set.
// bypassCSP on the browser context ensures the inline script is allowed.
export async function runAxe(page, axeSource, tags) {
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

// Identity of one element flagged by an axe rule: rule + selector + a
// normalised HTML snippet. The snippet disambiguates different elements that
// happen to get the same (e.g. nth-child based) selector on different pages.
// Per-page volatile markup is normalised away so the SAME element (e.g. a nav
// link that is aria-current on one page only, or one carrying a React useId)
// matches across pages.
const REACT_ID = String.raw`(?::r[\da-z]+:|«r[\da-z]+»|_r_[\da-z]+_)`;
const VOLATILE_ATTRS = new RegExp(
  String.raw`\s(?:aria-(?:current|selected|expanded|pressed|checked)|tabindex)(?:="[^"]*")?`,
  "gi"
);
const REACT_ID_ATTR = new RegExp(
  String.raw`\s[\w-]+="[^"]*${REACT_ID}[^"]*"`,
  "g"
);
const STATE_CLASS = /^(?:(?:is|has)-[\w-]+|active|selected)$/;

function normalizeAxeHtml(html) {
  return String(html || "")
    .replace(REACT_ID_ATTR, "")
    .replace(VOLATILE_ATTRS, "")
    .replace(/\sclass="([^"]*)"/g, (_, cls) => {
      const kept = cls
        .split(/\s+/)
        .filter((token) => token && !STATE_CLASS.test(token))
        .join(" ");
      return kept ? ` class="${kept}"` : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

// Axe CSS-escapes the ':' in ':r1:' ids in selectors (#\:r1\:).
const ESCAPED_REACT_ID_SELECTOR = new RegExp(
  String.raw`#(?:\\:r[\da-z]+\\:|«r[\da-z]+»|_r_[\da-z]+_)`,
  "g"
);

function normalizeAxeTarget(target) {
  return String(target || "")
    .replace(ESCAPED_REACT_ID_SELECTOR, "#<id>")
    .replace(new RegExp(REACT_ID, "g"), "<id>");
}

// Stable identity of a flagged element (computed from the FULL html, before
// display truncation, so volatile attributes can't shift the cut point).
function axeElementFingerprint(target, html) {
  return `${normalizeAxeTarget(target)}|${normalizeAxeHtml(html)}`;
}

export function axeElementKey(ruleId, element) {
  return `${ruleId}|${element.fingerprint}`;
}

// Build a finding for a violation from a subset of its flagged elements
// (`elements`: [{ target, html, fingerprint }]). Used both for the initial
// conversion and to rebuild a finding without the elements already reported
// on an earlier page.
export function axeFinding(violation, elements) {
  const v = violation;
  return {
    source: "axe",
    id: v.id,
    severity: SEVERITIES.includes(v.impact) ? v.impact : "moderate",
    wcag: wcagFromTags(v.tags),
    count: elements.length || 1,
    location: elements[0]?.target ?? "",
    examples: elements.slice(0, 3).map((e) => e.target),
    elements,
    issue: v.help,
    fix: v.fix || v.description || `See ${v.helpUrl}`,
    helpUrl: v.helpUrl,
  };
}

// Convert axe violations into findings, keeping the violation fields needed
// to rebuild a finding later (see axeFinding) under `violation`.
export function axeViolationsToFindings(violations) {
  return violations.map((v) => {
    const nodes = v.nodes || [];
    const elements = nodes.map((n) => {
      const target = (n.target || []).join(" ");
      return {
        target,
        html: String(n.html || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 300),
        fingerprint: axeElementFingerprint(target, n.html),
      };
    });
    const violation = {
      id: v.id,
      impact: v.impact,
      tags: v.tags,
      help: v.help,
      helpUrl: v.helpUrl,
      description: v.description,
      fix: summarizeFailure(nodes[0]),
    };
    return { ...axeFinding(violation, elements), violation };
  });
}
