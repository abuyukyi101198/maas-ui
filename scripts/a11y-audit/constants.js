/* Vocabulary shared across modules (roles, tree keys, severities). */

export const SEVERITIES = ["critical", "serious", "moderate", "minor"];
export const SEVERITY_RANK = { critical: 0, serious: 1, moderate: 2, minor: 3 };

// Deterministic-first ordering across finding sources: axe (rule engine),
// then keyboard (heuristic interaction checks), then ai (context review).
export const SOURCE_RANK = { axe: 0, keyboard: 1, ai: 2 };

// Findings are ordered by severity, then deterministic before heuristic, then
// id — so output is stable across runs.
export function sortFindings(a, b) {
  const rank = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (rank !== 0) return rank;
  const sourceRank =
    (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9);
  if (sourceRank !== 0) return sourceRank;
  return a.id.localeCompare(b.id);
}

// Default ceiling for the context window when --num-ctx isn't given. Models
// often advertise 128k+ tokens; allocating that per request (×parallel
// requests) exhausts memory on typical local hardware.
export const DEFAULT_MAX_NUM_CTX = 8192;
// Used only when the model's context length can't be read from Ollama.
export const FALLBACK_NUM_CTX = 4096;

// Upper bound on context findings kept per page (highest severity first).
export const MAX_CONTEXT_FINDINGS = 3;

// Accessible names/values longer than this are truncated (with "…") in the
// outline sent to the model.
export const MAX_TEXT_LEN = 80;

// Interactive roles that legitimately carry an accessible name a user acts on.
export const INTERACTIVE_ROLES = new Set([
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
export const FOCUSABLE_ROLES = new Set([
  ...INTERACTIVE_ROLES,
  "treegrid",
  "grid",
  "gridcell",
  "row",
  "tablist",
]);

export const LANDMARK_ROLES = new Set([
  "banner",
  "navigation",
  "main",
  "complementary",
  "contentinfo",
  "region",
  "search",
  "form",
]);

// Relationship properties; resolved to the related nodes' accessible names
// when the tree is captured.
export const RELATION_KEYS = [
  "labelledby",
  "describedby",
  "controls",
  "errormessage",
  "details",
  "activedescendant",
];

// Node states worth keeping for an audit (everything except role/name/value,
// which are handled separately).
export const STATE_KEYS = [
  "disabled",
  "expanded",
  "focused",
  "focusable",
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
  "live",
  "busy",
  ...RELATION_KEYS,
];

// States whose `false` value is meaningful to assistive technology (e.g. a
// collapsed disclosure announces "collapsed"), so they are kept when false.
// Other states are only interesting when set.
export const MEANINGFUL_FALSE_KEYS = new Set([
  "expanded",
  "pressed",
  "selected",
  "checked",
]);

// Keys kept from each accessibility-tree node: role/name/state info and link
// destinations, as opposed to layout, styling, or full DOM markup.
export const A11Y_KEYS = [
  "role",
  "name",
  "value",
  "description",
  "roledescription",
  "valuetext",
  "url",
  ...STATE_KEYS,
];
