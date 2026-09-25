/* Grounding and confidence scoring for context (ai) findings. */

import { FOCUSABLE_ROLES, INTERACTIVE_ROLES } from "./constants.js";

/* ---- Anti-hallucination guard --------------------------------------- */

// Collect every quoted text (accessible names, href paths, values,
// descriptions) and role that appears in the outline actually SENT to the
// model — after chrome pruning, preprocessing and truncation — so findings are
// verified against exactly what the model saw. `unnamedRoles` holds the roles
// of controls rendered with an explicit empty name (`button ""`).
export function collectOutlineText(outline) {
  const names = new Set();
  const roles = new Set();
  const unnamedRoles = new Set();
  const literal = /"(?:[^"\\]|\\.)*"/g;
  for (const line of outline.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("…")) continue;
    const [role] = trimmed.split(" ", 1);
    if (role) roles.add(role.toLowerCase());
    if (/^\S+ ""/.test(trimmed)) unnamedRoles.add(role.toLowerCase());
    for (const match of trimmed.match(literal) || []) {
      try {
        const text = JSON.parse(match).trim().toLowerCase();
        if (text) names.add(text);
      } catch {
        // ignore malformed literals
      }
    }
  }
  return { names, roles, unnamedRoles };
}

// Match a quoted string from a finding against known names, tolerating the
// outline's truncation of long names (a trailing "…"): the model may quote
// the truncated form, the visible prefix, or (from general knowledge) the
// full name. Returns the matching known name, or null.
const TRUNCATION_SUFFIX = /\s*(…|\.\.\.)$/;
const MIN_TRUNCATED_MATCH = 8;

function resolveName(quote, names) {
  const norm = quote.trim().toLowerCase();
  if (names.has(norm)) return norm;
  const stem = norm.replace(TRUNCATION_SUFFIX, "");
  if (stem.length < MIN_TRUNCATED_MATCH) return null;
  const quoteTruncated = stem !== norm;
  for (const name of names) {
    const nameStem = name.replace(TRUNCATION_SUFFIX, "");
    const nameTruncated = nameStem !== name;
    if (quoteTruncated && name.startsWith(stem)) return name;
    if (nameTruncated && (stem.startsWith(nameStem) || name.startsWith(stem))) {
      return name;
    }
  }
  return null;
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

// Extract quoted strings ("…", '…', “…”, ‘…’). Apostrophes inside words
// ("button's", "doesn't", "machine’s") are not treated as quote marks: a
// single quote only opens/closes a quotation at a word boundary.
const QUOTE_PATTERN = new RegExp(
  [
    '"([^"]+)"',
    "“([^”]+)”",
    "(?<![\\p{L}\\p{N}])'((?:[^']|(?<=[\\p{L}\\p{N}])'(?=[\\p{L}\\p{N}]))+)'(?![\\p{L}\\p{N}])",
    "‘((?:[^’]|(?<=[\\p{L}\\p{N}])’(?=[\\p{L}\\p{N}]))+)’",
  ].join("|"),
  "gu"
);

function quotedTokens(text) {
  const tokens = [];
  for (const match of String(text || "").matchAll(QUOTE_PATTERN)) {
    const token = match.slice(1).find((group) => group !== undefined);
    if (token) tokens.push(token.trim());
  }
  return tokens;
}

// A finding is "grounded" only if the element it cites (the structured `role`
// + `name` fields) exists in the sent outline, and every other quoted text in
// its issue is a real name, a role, or a state word.
export function isGroundedFinding(finding, outlineText) {
  const { names, roles, unnamedRoles } = outlineText;
  const role = (finding.role || "").toLowerCase();
  if (role && !roles.has(role)) return false;
  if (!finding.name) {
    // An empty name cites an unnamed control, which must exist as such.
    if (!role || !unnamedRoles.has(role)) return false;
  } else if (!resolveName(finding.name, names)) {
    return false;
  }
  for (const ref of quotedTokens(finding.issue)) {
    if (ref.length < 2 || !/\p{L}/u.test(ref)) continue;
    if (resolveName(ref, names)) continue;
    const norm = ref.toLowerCase();
    if (roles.has(norm) || NON_NAME_WORDS.has(norm)) continue;
    return false; // references something that isn't a real name/role/state
  }
  return true;
}

/* ---- Context confidence annotation (tags, never drops) -------------- */

// Confidence scoring tags each context finding with a reliability level and
// the data-driven signals behind it, so a human engineer is warned about
// shaky findings WITHOUT any finding being silently removed. Signals come from
// the finding's structured fields (kind/role/name/wcag) and the captured tree —
// never from parsing its English wording.

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
    case "2.4.6": // Headings and Labels
      return role === "heading" || INTERACTIVE_ROLES.has(role);
    default:
      return true;
  }
}

// Build a per-page index for annotation: names under <main>, interactive
// control names that recur (≥2×, so duplicate claims can be confirmed), and
// the destinations of links sharing a name. Built from the FULL captured tree
// so counts aren't skewed by sibling collapsing.
export function buildAnnotationIndex(tree) {
  const namesInMain = new Set();
  const interactiveNameCounts = new Map();
  const linkNameCounts = new Map();
  const linkHrefsByName = new Map();
  const walk = (node, inMain) => {
    if (!node) return;
    const role = (node.role || "").toLowerCase();
    const isMain = inMain || role === "main";
    const name = typeof node.name === "string" ? node.name.trim() : "";
    if (name) {
      const low = name.toLowerCase();
      if (isMain) namesInMain.add(low);
      if (INTERACTIVE_ROLES.has(role)) {
        interactiveNameCounts.set(
          low,
          (interactiveNameCounts.get(low) || 0) + 1
        );
      }
      if (role === "link") {
        linkNameCounts.set(low, (linkNameCounts.get(low) || 0) + 1);
        if (!linkHrefsByName.has(low)) linkHrefsByName.set(low, new Set());
        linkHrefsByName.get(low).add(node.url || "");
      }
    }
    (node.children || []).forEach((child) => walk(child, isMain));
  };
  walk(tree, false);
  return {
    namesInMain,
    interactiveNameCounts,
    linkNameCounts,
    linkHrefsByName,
  };
}

// Whether every control sharing `name` is a link to one and the same
// destination — same name + same target is not an ambiguity (WCAG 2.4.4).
function sharesSingleTarget(name, index) {
  const interactive = index.interactiveNameCounts.get(name) || 0;
  const links = index.linkNameCounts.get(name) || 0;
  const hrefs = index.linkHrefsByName.get(name);
  return interactive > 0 && links === interactive && hrefs?.size === 1;
}

// Flags that indicate a likely-unreliable finding (lower confidence).
export const LOW_CONFIDENCE_FLAGS = new Set([
  "criterion-role",
  "unverified-duplicate",
  "same-target",
  "outside-main",
  "kind-role",
  "allowlisted-label",
  "model-unconfirmed",
]);

// Truncated names ("Long name…") are matched on their visible prefix.
const nameKey = (name) =>
  String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s*(…|\.\.\.)$/, "");

// `keys` is a Map or Set keyed by lowercased names.
function lookupName(keys, name) {
  const key = nameKey(name);
  if (keys.has(key)) return key;
  for (const candidate of keys.keys()) {
    if (key.length >= 8 && candidate.startsWith(key)) return candidate;
  }
  return null;
}

// Score one context finding: returns { confidence, flags } and never drops.
function scoreContextFinding(finding, index, allowLabels) {
  const role = (finding.role || "").toLowerCase();
  const name = nameKey(finding.name);
  const flags = [];

  if (finding.kind === "ambiguous-name") {
    // Duplicate/ambiguity is the one claim that can be positively confirmed:
    // the name must recur on real controls, and not merely be several links
    // to the same destination.
    const key = lookupName(index.interactiveNameCounts, finding.name);
    if (!key || index.interactiveNameCounts.get(key) < 2) {
      flags.push("unverified-duplicate");
    } else if (sharesSingleTarget(key, index)) {
      flags.push("same-target");
    } else {
      flags.push("verified-duplicate");
    }
  }
  if (finding.kind === "heading-structure" && role && role !== "heading") {
    flags.push("kind-role");
  }
  // Cited element exists only outside <main> (likely dev/browser tooling or
  // chrome the model shouldn't have seen).
  if (name && !lookupName(index.namesInMain, name)) flags.push("outside-main");
  if (!criterionAllowsRole(finding.wcag, role)) flags.push("criterion-role");
  if (name && allowLabels.has(name)) flags.push("allowlisted-label");

  let confidence = "medium";
  if (flags.some((f) => LOW_CONFIDENCE_FLAGS.has(f))) confidence = "low";
  else if (flags.includes("verified-duplicate")) confidence = "high";
  return { confidence, flags };
}

// Attach { confidence, flags } to every context finding (no dropping).
// `allowLabels` is the list of conventional labels from --allow-labels.
export function annotateContextFindings(findings, tree, allowLabels = []) {
  const index = buildAnnotationIndex(tree);
  const allowSet = new Set(allowLabels.map(nameKey));
  return findings.map((finding) => ({
    ...finding,
    ...scoreContextFinding(finding, index, allowSet),
  }));
}

// Fold a --verify answer into a finding's confidence: an unconfirmed finding
// drops to low; a confirmed one keeps its level (or rises from medium to high
// when nothing else flagged it).
export function applyVerification(finding, { confirmed, reason }) {
  const flags = [
    ...finding.flags,
    confirmed ? "model-confirmed" : "model-unconfirmed",
  ];
  let confidence = finding.confidence;
  if (!confirmed) confidence = "low";
  else if (
    confidence === "medium" &&
    !flags.some((f) => LOW_CONFIDENCE_FLAGS.has(f))
  ) {
    confidence = "high";
  }
  return { ...finding, flags, confidence, verifyReason: reason };
}
