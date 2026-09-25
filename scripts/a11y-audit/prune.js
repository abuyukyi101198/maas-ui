/* Tree preprocessing, outline serialisation, context budgeting, chrome. */

import {
  FALLBACK_NUM_CTX,
  FOCUSABLE_ROLES,
  INTERACTIVE_ROLES,
  MAX_TEXT_LEN,
  STATE_KEYS,
} from "./constants.js";
import { truncateText } from "./util.js";

// Roles that carry no audit value and only bloat the tree. InlineTextBox is a
// verbatim duplicate of its StaticText parent's name; LineBreak is layout-only.
const NOISE_ROLES = new Set(["InlineTextBox", "LineBreak"]);

// Structural wrappers with no semantics — flattened (replaced by their
// children) when they carry no accessible name or state.
const FLATTEN_ROLES = new Set(["generic", "none", "GenericContainer"]);

// Siblings that are never collapsed, however similar: each heading and form
// field carries its own label/state, which is exactly what the review checks.
const NEVER_COLLAPSE_ROLES = new Set([
  "heading",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "spinbutton",
  "slider",
  "listbox",
  "group",
  "radiogroup",
  "form",
]);

// A shallow structural signature used to detect repeated sibling subtrees
// (e.g. many identical table rows / list items). Names are intentionally
// excluded so rows that differ only by their data collapse together.
function siblingSignature(node) {
  const childRoles = (node.children || []).map((c) => c.role).join(",");
  return `${node.role}|${childRoles}`;
}

// Keep the first `keep` of each group of structurally-identical siblings and
// replace the rest with one "omitted" marker per group, placed where the
// first omitted sibling was (so the outline keeps the page's order).
function collapseRepeatedSiblings(children, keep) {
  const counts = new Map();
  const markers = new Map();
  const result = [];
  for (const child of children) {
    if (child.role === "__omitted__" || NEVER_COLLAPSE_ROLES.has(child.role)) {
      result.push(child);
      continue;
    }
    const sig = siblingSignature(child);
    const seen = (counts.get(sig) || 0) + 1;
    counts.set(sig, seen);
    if (seen <= keep) {
      result.push(child);
      continue;
    }
    let marker = markers.get(sig);
    if (!marker) {
      marker = { role: "__omitted__", omittedRole: child.role, count: 0 };
      markers.set(sig, marker);
      result.push(marker);
    }
    marker.count += 1;
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
  const hasState = STATE_KEYS.some((k) => out[k] !== undefined);
  if (FLATTEN_ROLES.has(node.role) && !hasName && !hasState) {
    return children; // bubble children up, drop the empty wrapper
  }
  if (children.length) out.children = children;
  return [out];
}

export function preprocessTree(tree, keepSamples) {
  const roots = preprocessNode(tree, keepSamples);
  return roots.length === 1
    ? roots[0]
    : { role: "RootWebArea", children: roots };
}

// Rough characters-per-token ratio used for budgeting. Deliberately a little
// pessimistic (outlines are dense with quotes/brackets) so estimates err on
// the side of fitting in the context window.
const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(text) {
  return Math.ceil((text || "").length / CHARS_PER_TOKEN);
}

// Render a link destination compactly: same-origin URLs become site-relative
// paths (what the model needs to compare destinations) and other URLs drop
// their scheme, so the outline never carries full web addresses.
function formatHref(url, origin) {
  if (typeof url !== "string" || !url) return null;
  let href = url;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return truncateText(url, MAX_TEXT_LEN);
    href =
      origin && u.origin === origin
        ? u.pathname + u.search + u.hash
        : `//${u.host}${u.pathname}${u.search}`;
  } catch {
    // not an absolute URL; keep as-is
  }
  return truncateText(href, MAX_TEXT_LEN);
}

// Format a state value for the outline, quoting strings that contain spaces
// or outline syntax so each `key=value` pair stays unambiguous.
function formatStateValue(value) {
  if (typeof value === "string" && /[\s"=[\]]/.test(value)) {
    return JSON.stringify(truncateText(value, MAX_TEXT_LEN));
  }
  return value;
}

// Whitespace/case-insensitive text equality (used to hide relationship
// labels that merely repeat the computed name/description).
function sameText(a, b) {
  const norm = (s) =>
    String(s ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  return norm(a) === norm(b);
}

// Serialise the tree as a compact indented outline. This is dramatically
// cheaper in tokens than pretty-printed JSON while preserving role/name/state.
// Interactive controls with no accessible name are rendered with an explicit
// empty name (`button ""`) so the model can see them.
function serializeOutline(node, depth, lines, origin) {
  if (!node) return lines;
  const indent = "  ".repeat(depth);
  if (node.role === "__omitted__") {
    lines.push(`${indent}… (${node.count} more similar ${node.omittedRole})`);
    return lines;
  }
  const role = node.role || "node";
  const parts = [role];
  if (node.name) parts.push(JSON.stringify(node.name));
  else if (INTERACTIVE_ROLES.has(role)) parts.push('""');
  const states = [];
  // Only links have a destination; other roles with a CDP `url` (images'
  // src, the document URL) are omitted so "href" always means a link target.
  if (role === "link") {
    const href = formatHref(node.url, origin);
    if (href) states.push(`href=${JSON.stringify(href)}`);
  }
  for (const key of STATE_KEYS) {
    const value = node[key];
    if (value === undefined) continue;
    // Being focusable is expected for controls; only call it out where it's
    // unusual (e.g. a focusable generic container).
    if (
      key === "focusable" &&
      (FOCUSABLE_ROLES.has(role) || role === "RootWebArea")
    ) {
      continue;
    }
    // labelledby/describedby usually just restate the computed name and
    // description; show them only when they add information.
    if (key === "labelledby" && sameText(value, node.name)) continue;
    if (key === "describedby" && sameText(value, node.description)) continue;
    states.push(`${key}=${formatStateValue(value)}`);
  }
  if (node.value) states.push(`value=${JSON.stringify(node.value)}`);
  if (node.description) states.push(`desc=${JSON.stringify(node.description)}`);
  if (states.length) parts.push(`[${states.join(" ")}]`);
  lines.push(indent + parts.join(" "));
  for (const child of node.children || []) {
    serializeOutline(child, depth + 1, lines, origin);
  }
  return lines;
}

export function treeToOutline(tree, origin) {
  return serializeOutline(tree, 0, [], origin).join("\n");
}

/* ---- Fitting the outline into the context window --------------------- */

// Tokens reserved for the model's JSON response (up to MAX_CONTEXT_FINDINGS
// findings of a few short fields each, plus slack).
const RESPONSE_RESERVE_TOKENS = 800;
// Below this many characters a section is dropped rather than cut further.
const MIN_SECTION_CHARS = 60;

// Parse the indented outline back into a line tree ({ line, depth, children }).
function parseOutline(outline) {
  const root = { line: null, depth: -1, children: [] };
  const stack = [root];
  for (const line of outline.split("\n")) {
    const depth = Math.floor(line.match(/^ */)[0].length / 2);
    const node = { line, depth, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return root;
}

const ownSize = (node) => (node.line === null ? 0 : node.line.length + 1);

function subtreeSize(node) {
  if (node.size === undefined) {
    node.size =
      ownSize(node) + node.children.reduce((n, c) => n + subtreeSize(c), 0);
  }
  return node.size;
}

function subtreeLines(node, out = []) {
  if (node.line !== null) out.push(node.line);
  for (const child of node.children) subtreeLines(child, out);
  return out;
}

const countLines = (node) => subtreeLines(node).length;

// Split `budget` fairly: small sections get all they need, and what's left is
// shared equally among the larger ones (water-filling).
function fairShares(sizes, budget) {
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[a] - sizes[b]);
  const alloc = new Array(sizes.length).fill(0);
  let remaining = Math.max(0, budget);
  let left = sizes.length;
  for (const i of order) {
    alloc[i] = Math.min(sizes[i], Math.floor(remaining / left));
    remaining -= alloc[i];
    left -= 1;
  }
  return alloc;
}

// Emit `node` within roughly `budget` characters, cutting each child section
// evenly (recursively) instead of dropping the end of the page. Cut parts are
// replaced by a marker line where they were.
function fitNode(node, budget, out) {
  if (node.line !== null) out.push(node.line);
  const childBudget = budget - ownSize(node);
  if (subtreeSize(node) - ownSize(node) <= childBudget) {
    for (const child of node.children) subtreeLines(child, out);
    return;
  }
  const indent = "  ".repeat(node.depth + 1);
  const marker = (n) =>
    `${indent}… (${n} line(s) cut to fit the context window)`;
  const alloc = fairShares(
    node.children.map(subtreeSize),
    childBudget - marker(99999).length - 1
  );
  const parts = [];
  let cutLines = 0;
  let markerAt = -1;
  node.children.forEach((child, k) => {
    if (alloc[k] >= subtreeSize(child)) {
      subtreeLines(child, parts);
    } else if (alloc[k] >= ownSize(child) + MIN_SECTION_CHARS) {
      fitNode(child, alloc[k], parts);
    } else {
      cutLines += countLines(child);
      if (markerAt < 0) markerAt = parts.length;
    }
  });
  if (cutLines > 0) parts.splice(markerAt, 0, marker(cutLines));
  out.push(...parts);
}

// Fit the outline into the model's context window, reserving room for the
// prompt around it (`promptOverheadTokens`, measured from the actual prompt)
// and the model's JSON response.
export function capOutlineToContext(outline, numCtx, promptOverheadTokens) {
  const budgetTokens = Math.max(
    (numCtx || FALLBACK_NUM_CTX) -
      promptOverheadTokens -
      RESPONSE_RESERVE_TOKENS,
    400
  );
  const budgetChars = Math.floor(budgetTokens * CHARS_PER_TOKEN);
  if (outline.length <= budgetChars) return { text: outline, truncated: false };
  const lines = [];
  fitNode(parseOutline(outline), budgetChars, lines);
  return { text: lines.join("\n"), truncated: true };
}

/* ---- Shared site chrome --------------------------------------------- */

// Shared "site chrome" — navigation, banner, footer, status bar — is
// identical across every view, so it produces the same findings on every
// page. It is detected deterministically and reviewed only once.

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
// into them), to decide which page "owns" each region.
export function chromeSignatures(tree) {
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

// Prune chrome regions not owned by this entry index (owner = first entry, in
// audit order, that contains the region).
export function pruneChromeByOwner(node, ownerBySig, index) {
  if (!node) return null;
  if (CHROME_ROLES.has(node.role)) {
    return ownerBySig.get(subtreeSignature(node)) === index ? node : null;
  }
  const children = (node.children || [])
    .map((c) => pruneChromeByOwner(c, ownerBySig, index))
    .filter(Boolean);
  return { ...node, children };
}
