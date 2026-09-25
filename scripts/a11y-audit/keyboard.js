/* Keyboard checks: tab order, focus visibility, traps, overlays. */

import { sleep } from "./util.js";

// In-page helpers, installed once per document as window.__a11yKb. Kept in a
// single function because Playwright serialises it into the page.
function keyboardProbe() {
  if (window.__a11yKb) return;
  const TABBABLE = [
    "a[href]",
    "area[href]",
    "button",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "iframe",
    "summary",
    "[tabindex]",
    "[contenteditable]:not([contenteditable='false'])",
  ].join(",");
  const OVERLAY =
    "[role='dialog'], [role='alertdialog'], dialog[open], [aria-modal='true'], [role='menu']";

  const isRendered = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(el);
    return (
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity) !== 0
    );
  };
  // Visually hidden native inputs (custom checkboxes/radios) are drawn by
  // their label, so a visible label counts as the element being visible.
  const isVisible = (el) =>
    isRendered(el) || Array.from(el.labels || []).some(isRendered);
  const isTabbable = (el) =>
    !el.disabled && el.tabIndex >= 0 && !el.closest("[inert]") && isVisible(el);
  const tabbables = (root) =>
    Array.from(root.querySelectorAll(TABBABLE)).filter(isTabbable);

  // Styles that typically carry a focus indicator, for the element and its
  // ::before/::after pseudo-elements.
  const styleSig = (el) => {
    if (!el || el.nodeType !== 1) return "";
    return [null, "::before", "::after"]
      .map((pseudo) => {
        const s = window.getComputedStyle(el, pseudo);
        return [
          s.outlineStyle,
          s.outlineWidth,
          s.outlineColor,
          s.boxShadow,
          s.borderTopColor,
          s.borderBottomColor,
          s.borderBottomWidth,
          s.backgroundColor,
          s.color,
          s.textDecorationLine,
        ].join("|");
      })
      .join("/");
  };
  // The indicator may be drawn on the element, its parent (:focus-within),
  // its first child, its label or the label's pseudo-elements.
  const indicatorSig = (el) =>
    [el, el.parentElement, el.firstElementChild, el.labels?.[0]]
      .map(styleSig)
      .join("#");

  const isVolatileId = (id) => /[:«»]|^_r_/.test(id);
  const cssPath = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      const id = node.id;
      if (
        id &&
        !isVolatileId(id) &&
        document.querySelectorAll(`#${CSS.escape(id)}`).length === 1
      ) {
        parts.unshift(`#${CSS.escape(id)}`);
        break;
      }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(
          (c) => c.tagName === node.tagName
        );
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (part === "body") break;
      node = parent;
    }
    return parts.join(" > ");
  };
  const nameOf = (el) => {
    const labelledBy = (el.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ");
    return (
      el.getAttribute("aria-label") ||
      labelledBy ||
      el.labels?.[0]?.textContent ||
      el.getAttribute("title") ||
      el.textContent ||
      el.value ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
  };
  const roleOf = (el) => el.getAttribute("role") || el.tagName.toLowerCase();

  // WCAG 2.4.11: the focused element is entirely hidden by fixed/sticky
  // content (e.g. a sticky header). Returns the obscuring element's selector.
  const obscuredByFixed = (el, r) => {
    const points = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 2, r.top + 2],
      [r.right - 2, r.top + 2],
      [r.left + 2, r.bottom - 2],
      [r.right - 2, r.bottom - 2],
    ].filter(
      ([x, y]) =>
        x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight
    );
    if (points.length === 0) return null;
    let obscurer = null;
    for (const [x, y] of points) {
      const top = document.elementFromPoint(x, y);
      if (!top || el.contains(top) || top.contains(el)) return null;
      let n = top;
      let fixed = null;
      while (n && n !== document.body) {
        const position = window.getComputedStyle(n).position;
        if (position === "fixed" || position === "sticky") {
          fixed = n;
          break;
        }
        n = n.parentElement;
      }
      if (!fixed || fixed.contains(el)) return null;
      obscurer = fixed;
    }
    return obscurer ? cssPath(obscurer) : null;
  };

  const kb = {
    base: new WeakMap(),
    stops: [],
    sentinel: null,
    overlay: null,
  };
  // Record every tabbable element's unfocused styles, then start from a
  // known point: a temporary, non-tabbable sentinel at the start of the body,
  // so the first Tab lands on the first tabbable element.
  kb.prepare = () => {
    document.activeElement?.blur?.();
    kb.stops = [];
    const list = tabbables(document.body);
    for (const el of list) kb.base.set(el, indicatorSig(el));
    const s = document.createElement("span");
    s.tabIndex = -1;
    s.style.cssText =
      "position:absolute;left:0;top:0;width:1px;height:1px;overflow:hidden";
    document.body.prepend(s);
    s.focus({ preventScroll: true });
    kb.sentinel = s;
    return list.length;
  };
  kb.cleanup = () => {
    kb.sentinel?.remove();
    kb.sentinel = null;
  };
  kb.describe = () => {
    const el = document.activeElement;
    if (
      !el ||
      el === document.body ||
      el === document.documentElement ||
      el === kb.sentinel
    ) {
      return null;
    }
    let index = kb.stops.indexOf(el);
    const isNew = index < 0;
    if (isNew) {
      kb.stops.push(el);
      index = kb.stops.length - 1;
    }
    const r = el.getBoundingClientRect();
    const visible = isVisible(el);
    const inViewport =
      r.bottom > 0 &&
      r.right > 0 &&
      r.top < window.innerHeight &&
      r.left < window.innerWidth;
    const base = kb.base.get(el);
    return {
      index,
      isNew,
      role: roleOf(el),
      name: nameOf(el),
      selector: cssPath(el),
      visible,
      inViewport,
      indicator: base === undefined ? null : indicatorSig(el) !== base,
      obscuredBy: visible && inViewport ? obscuredByFixed(el, r) : null,
    };
  };
  kb.focusStop = (i) => {
    const el = kb.stops[i];
    if (!el?.isConnected) return false;
    el.focus();
    return document.activeElement === el;
  };
  kb.findOverlay = () => {
    const open = Array.from(document.querySelectorAll(OVERLAY)).filter(
      isRendered
    );
    const el = open[open.length - 1];
    if (!el) return null;
    kb.overlay = el;
    let modal = el.getAttribute("aria-modal") === "true";
    try {
      modal ||= el.matches(":modal");
    } catch {
      // :modal unsupported
    }
    return {
      role: el.getAttribute("role") || "dialog",
      modal,
      name: nameOf(el),
      selector: cssPath(el),
      containsFocus: el.contains(document.activeElement),
      tabbables: tabbables(el).length,
    };
  };
  kb.focusInOverlay = () =>
    Boolean(kb.overlay && kb.overlay.contains(document.activeElement));
  kb.afterClose = () => {
    const trigger = window.__a11yAuditTrigger;
    const active = document.activeElement;
    return {
      open: Boolean(
        kb.overlay && kb.overlay.isConnected && isRendered(kb.overlay)
      ),
      hasTrigger: Boolean(trigger?.isConnected),
      onTrigger: Boolean(
        trigger && active && (trigger === active || trigger.contains(active))
      ),
    };
  };
  window.__a11yKb = kb;
}

const where = (info) => `${info.role}${info.name ? ` "${info.name}"` : ""}`;

function keyboardFinding(id, severity, wcag, info, issue, fix) {
  return {
    source: "keyboard",
    id,
    severity,
    wcag,
    count: 1,
    location: info ? where(info) : "document",
    ...(info?.selector ? { selector: info.selector } : {}),
    issue,
    fix,
  };
}

const describe = (page) => page.evaluate(() => window.__a11yKb.describe());

// Tab through the page from a known starting point and flag keyboard barriers
// a static tree/axe scan can't see. The number of Tab presses scales with the
// number of tabbable elements (capped by `maxTabs`); the pass stops early once
// focus wraps back to the first stop. Best-effort heuristics, not an
// exhaustive keyboard audit.
export async function runKeyboardChecks(page, { maxTabs = 150 } = {}) {
  await page.evaluate(keyboardProbe);
  const tabbableCount = await page.evaluate(() => window.__a11yKb.prepare());
  const findings = [];
  const seen = new Set();
  const push = (finding) => {
    const key = `${finding.id}|${finding.selector || finding.location}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };

  try {
    if (tabbableCount === 0) return findings;
    const limit = Math.min(maxTabs, tabbableCount + 5);
    const stops = [];
    let last = -1;
    let stuck = 0;
    let moved = false;

    for (let i = 0; i < limit; i++) {
      try {
        await page.keyboard.press("Tab");
      } catch {
        break;
      }
      const info = await describe(page).catch(() => null);
      // Focus left the document (browser UI); the next Tab re-enters it.
      if (!info) continue;
      moved = true;
      // Wrapped around to the first stop: the whole tab cycle was covered.
      if (!info.isNew && info.index === 0 && stops.length > 1) break;
      stuck = info.index === last ? stuck + 1 : 0;
      last = info.index;
      if (info.isNew) stops[info.index] = info;

      if (!info.visible) {
        push(
          keyboardFinding(
            "keyboard-hidden-focus",
            "serious",
            "2.4.7",
            info,
            "A focusable element receives keyboard focus while not visible.",
            "Remove hidden elements from the tab order, or reveal them when focused."
          )
        );
      } else if (!info.inViewport) {
        push(
          keyboardFinding(
            "keyboard-offscreen-focus",
            "moderate",
            "2.4.7",
            info,
            "Keyboard focus moves to an element rendered outside the viewport.",
            "Ensure focused elements scroll into view, or are not focusable while offscreen."
          )
        );
      } else {
        if (info.indicator === false) {
          push(
            keyboardFinding(
              "keyboard-no-focus-indicator",
              "serious",
              "2.4.7",
              info,
              "No visible change (outline, shadow, border or colour) when the element receives keyboard focus.",
              "Give the element a clearly visible :focus-visible style, e.g. an outline."
            )
          );
        }
        if (info.obscuredBy) {
          push(
            keyboardFinding(
              "keyboard-focus-obscured",
              "moderate",
              "2.4.11",
              info,
              `The focused element is entirely hidden behind fixed or sticky content (${info.obscuredBy}).`,
              "Add scroll-padding for sticky content, or scroll the focused element clear of it."
            )
          );
        }
      }

      if (stuck >= 5) {
        push(
          keyboardFinding(
            "keyboard-focus-trap",
            "critical",
            "2.1.2",
            info,
            "Keyboard focus appears trapped on a single element while tabbing.",
            "Allow focus to move away with Tab/Shift+Tab; only trap focus inside open modals."
          )
        );
        return findings;
      }
    }

    if (!moved) {
      push(
        keyboardFinding(
          "keyboard-no-focus-move",
          "serious",
          "2.1.1",
          null,
          "Pressing Tab did not move focus to any interactive element.",
          "Provide focusable, keyboard-operable controls with a logical tab order."
        )
      );
      return findings;
    }

    // Shift+Tab must retrace the forward order.
    if (stops.length >= 3) {
      const from = Math.min(stops.length - 1, 15);
      const focused = await page.evaluate(
        (i) => window.__a11yKb.focusStop(i),
        from
      );
      if (focused) {
        for (let j = 1; j <= Math.min(10, from); j++) {
          await page.keyboard.press("Shift+Tab");
          const info = await describe(page).catch(() => null);
          const expected = from - j;
          if (info?.index === expected) continue;
          const origin = stops[expected + 1];
          push(
            keyboardFinding(
              "keyboard-reverse-order",
              "moderate",
              "2.4.3",
              info || origin,
              `Shift+Tab from ${where(origin)} moved focus to ${
                info ? where(info) : "outside the page"
              } instead of ${where(stops[expected])}.`,
              "Keep the backward tab order the reverse of the forward order (avoid focus redirection on blur)."
            )
          );
          break;
        }
      }
    }
    return findings;
  } finally {
    await page.evaluate(() => window.__a11yKb?.cleanup()).catch(() => {});
  }
}

// After a trigger opened a dialog or menu (window.__a11yAuditTrigger is the
// trigger): focus should move into it, stay inside a modal while tabbing, and
// return to the trigger when Escape closes it.
export async function runDialogChecks(page, { maxTabs = 30 } = {}) {
  await page.evaluate(keyboardProbe);
  const overlay = await page.evaluate(() => window.__a11yKb.findOverlay());
  if (!overlay) return [];
  const info = {
    role: overlay.role,
    name: overlay.name,
    selector: overlay.selector,
  };
  const kind = overlay.role === "menu" ? "menu" : "dialog";
  const findings = [];

  if (!overlay.containsFocus && (overlay.modal || kind === "menu")) {
    findings.push(
      keyboardFinding(
        `keyboard-${kind}-initial-focus`,
        overlay.modal ? "moderate" : "minor",
        "2.4.3",
        info,
        `Opening the ${kind} did not move keyboard focus into it.`,
        `Move focus into the ${kind} when it opens (e.g. to its first focusable element).`
      )
    );
  }

  if (overlay.modal && overlay.tabbables > 0) {
    const presses = Math.min(maxTabs, overlay.tabbables + 2);
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() =>
        window.__a11yKb.focusInOverlay()
      );
      if (!inside) {
        findings.push(
          keyboardFinding(
            "keyboard-modal-focus-escapes",
            "serious",
            "2.4.3",
            info,
            "Tab moves keyboard focus out of an open modal dialog into the page behind it.",
            "Keep focus within the modal dialog while it is open."
          )
        );
        break;
      }
    }
  }

  await page.keyboard.press("Escape");
  await sleep(300);
  const after = await page.evaluate(() => window.__a11yKb.afterClose());
  if (!after.open && after.hasTrigger && !after.onTrigger) {
    findings.push(
      keyboardFinding(
        `keyboard-${kind}-focus-not-returned`,
        "moderate",
        "2.4.3",
        info,
        `After closing the ${kind} with Escape, keyboard focus did not return to the control that opened it.`,
        `Return focus to the triggering control when the ${kind} closes.`
      )
    );
  }
  return findings;
}
