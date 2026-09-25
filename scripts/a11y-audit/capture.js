/* Accessibility-tree capture (incl. iframes) and per-page capture. */

import { axeViolationsToFindings, runAxe } from "./axe.js";
import {
  A11Y_KEYS,
  LANDMARK_ROLES,
  MEANINGFUL_FALSE_KEYS,
  RELATION_KEYS,
} from "./constants.js";
import { runInteractions } from "./interactions.js";
import { runKeyboardChecks } from "./keyboard.js";

function trimA11yNode(node) {
  if (!node) return null;
  const trimmed = {};
  for (const key of A11Y_KEYS) {
    const value = node[key];
    if (value === undefined || value === null) continue;
    if (value === false && !MEANINGFUL_FALSE_KEYS.has(key)) continue;
    trimmed[key] = value;
  }
  if (node.children?.length) {
    const kids = node.children.map(trimA11yNode).filter(Boolean);
    if (kids.length) trimmed.children = kids;
  }
  // Drop nodes that carry no useful information at all
  if (Object.keys(trimmed).length === 0) return null;
  return trimmed;
}

// Convert a CDP node's role/name/value/description plus its `properties`
// array into the flat `{ role, name, checked, ... }` shape trimA11yNode reads.
// CDP property names are camelCase (e.g. `hasPopup`) and tristate/token values
// arrive as strings ("true"/"false"/"mixed"), so both are normalised here.
// Relationship properties reference DOM nodes; they are resolved to the
// related nodes' accessible names via `nameByBackendId`.
function cdpNodeProps(node, nameByBackendId) {
  const props = {};
  if (node.role) props.role = node.role.value;
  if (node.name) props.name = node.name.value;
  if (node.value) props.value = node.value.value;
  if (node.description) props.description = node.description.value;
  for (const prop of node.properties || []) {
    const key = prop.name.toLowerCase();
    if (RELATION_KEYS.includes(key)) {
      const labels = (prop.value?.relatedNodes || [])
        .map((related) =>
          (
            related.text ||
            nameByBackendId.get(related.backendDOMNodeId) ||
            (related.idref ? `#${related.idref}` : "")
          ).trim()
        )
        .filter(Boolean);
      if (labels.length) props[key] = labels.join(", ");
      continue;
    }
    let value = prop.value?.value;
    if (value === "true") value = true;
    else if (value === "false") value = false;
    if (key === "live" && value === "off") continue;
    props[key] = value;
  }
  return props;
}

// CDP returns a flat list of nodes referencing children by id. Rebuild the
// hierarchy, skipping "ignored" nodes by bubbling their children up to the
// nearest kept parent. `frameTrees` maps an <iframe>'s backend DOM node id to
// that frame's own CDP node list; frame trees are grafted under their owner
// (and removed from the map, so leftovers can be attached elsewhere).
function cdpTreeToNode(nodes, frameTrees = new Map()) {
  if (!nodes || nodes.length === 0) return null;
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const nameByBackendId = new Map();
  for (const n of nodes) {
    const name = n.name?.value;
    if (n.backendDOMNodeId !== undefined && typeof name === "string" && name) {
      nameByBackendId.set(n.backendDOMNodeId, name);
    }
  }

  const frameChild = (node) => {
    const frameNodes = frameTrees.get(node.backendDOMNodeId);
    if (!frameNodes) return null;
    frameTrees.delete(node.backendDOMNodeId);
    return cdpTreeToNode(frameNodes, frameTrees);
  };

  const buildChildren = (node) => {
    const children = [];
    for (const childId of node.childIds || []) {
      const child = byId.get(childId);
      if (!child) continue;
      if (child.ignored) {
        children.push(...buildChildren(child));
        const framed = frameChild(child);
        if (framed) children.push(framed);
      } else {
        children.push(buildNode(child));
      }
    }
    return children;
  };

  const buildNode = (node) => {
    const built = cdpNodeProps(node, nameByBackendId);
    const children = buildChildren(node);
    const framed = frameChild(node);
    if (framed) children.push(framed);
    if (children.length) built.children = children;
    return built;
  };

  const root = nodes.find((n) => !n.parentId) || nodes[0];
  if (root.ignored) {
    return { role: "RootWebArea", children: buildChildren(root) };
  }
  return buildNode(root);
}

// Collect the accessibility trees of the page's child frames, keyed by the
// backend node id of the owning <iframe>. Same-process frames are read
// through the page's session; out-of-process (cross-site) frames through
// their own session.
async function collectFrameTrees(page, client) {
  const byOwner = new Map();
  let frameTree;
  try {
    ({ frameTree } = await client.send("Page.getFrameTree"));
  } catch {
    return byOwner;
  }
  const childFrames = [];
  const walk = (ft) => {
    for (const child of ft.childFrames || []) {
      childFrames.push(child.frame);
      walk(child);
    }
  };
  walk(frameTree);

  for (const frame of childFrames) {
    let ownerId;
    try {
      ({ backendNodeId: ownerId } = await client.send("DOM.getFrameOwner", {
        frameId: frame.id,
      }));
    } catch {
      continue;
    }
    let nodes = null;
    try {
      ({ nodes } = await client.send("Accessibility.getFullAXTree", {
        frameId: frame.id,
      }));
    } catch {
      nodes = await outOfProcessFrameTree(page, frame.url);
    }
    if (nodes?.length) byOwner.set(ownerId, nodes);
  }
  return byOwner;
}

async function outOfProcessFrameTree(page, url) {
  const frame = page
    .frames()
    .find((f) => f !== page.mainFrame() && f.url() === url);
  if (!frame) return null;
  let session;
  try {
    // Throws for frames that share the page's process (handled above).
    session = await page.context().newCDPSession(frame);
    await session.send("Accessibility.enable");
    const { nodes } = await session.send("Accessibility.getFullAXTree");
    return nodes;
  } catch {
    return null;
  } finally {
    await session?.detach().catch(() => {});
  }
}

// Pull the computed accessibility tree (what assistive technology perceives)
// straight from Chromium via the DevTools Protocol, including iframe content.
export async function extractAccessibilityTree(page) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Accessibility.enable");
    await client.send("DOM.enable").catch(() => {});
    const { nodes } = await client.send("Accessibility.getFullAXTree");
    const frameTrees = await collectFrameTrees(page, client);
    const root = cdpTreeToNode(nodes, frameTrees);
    // Frames whose <iframe> node wasn't found in the tree (e.g. it was
    // ignored along with its whole subtree) are appended to the root.
    for (const frameNodes of [...frameTrees.values()]) {
      const framed = cdpTreeToNode(frameNodes, frameTrees);
      if (framed && root) (root.children ??= []).push(framed);
    }
    return trimA11yNode(root);
  } finally {
    await client.detach().catch(() => {});
  }
}

// Walk the captured tree and produce a quick, human-readable summary so the
// user can sanity-check that landmarks, headings and named controls were
// actually captured before trusting the audit.
export function summarizeA11yTree(tree) {
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
      if (LANDMARK_ROLES.has(node.role)) {
        landmarks.push(`${node.role}${node.name ? `: ${node.name}` : ""}`);
      }
    }
    (node.children || []).forEach(walk);
  };
  walk(tree);

  return { total, named, roleCounts, headings, landmarks };
}

// Snapshot the current state of a settled page: accessibility tree + axe.
async function snapshot(page, { axeSource, opts, settled }) {
  const tree = await extractAccessibilityTree(page);
  const violations = await runAxe(page, axeSource, opts.axeTags).catch(
    () => []
  );
  return {
    tree,
    summary: summarizeA11yTree(tree),
    treeJson: opts.showTree ? JSON.stringify(tree, null, 2) : null,
    axeFindings: axeViolationsToFindings(violations),
    settled,
  };
}

// Capture everything audited for one loaded, settled page: its tree and axe
// results, keyboard checks, and (with --interactions) one sub-capture per
// activated trigger.
export async function capturePage(page, ctx) {
  const { opts, path, origin, interactionConfig } = ctx;
  const base = await snapshot(page, ctx);
  const keyboardFindings = opts.keyboardChecks
    ? await runKeyboardChecks(page, { maxTabs: opts.maxTabs }).catch(() => [])
    : [];
  const interactions = opts.interactions
    ? await runInteractions(page, {
        url: origin + path,
        tree: base.tree,
        config: interactionConfig,
        opts,
        snapshot: (settled) => snapshot(page, { ...ctx, settled }),
      })
    : [];
  return { ...base, keyboardFindings, interactions };
}
