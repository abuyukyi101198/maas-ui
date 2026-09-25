/* Session, page readiness, route detection, path similarity and crawling. */

import {
  errorMessage,
  fetchWithTimeout,
  httpError,
  retry,
  runAbort,
  sleep,
  throwIfAborted,
} from "./util.js";

/* -------------------------------------------------------------------- */
/* Authentication                                                        */
/* -------------------------------------------------------------------- */

// Mirrors the e2e `cy.login()` command: POST credentials to the MAAS auth
// endpoint, then inject the returned JWT/refresh tokens as cookies so the
// crawler is treated as an authenticated session. Without this every
// protected route just redirects to /login.
export async function authenticate(
  origin,
  basename,
  username,
  password,
  timeoutMs
) {
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
    throw httpError(
      `Login failed (${res.status} ${res.statusText}) at ${loginUrl}: ${body}`,
      res.status
    );
  }
  const data = await res.json();
  if (!data.access_token || !data.refresh_token) {
    const err = new Error(
      "Login response did not include access_token / refresh_token."
    );
    err.retryable = false;
    throw err;
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
export function buildAuthCookies(origin, { accessToken, refreshToken }) {
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

/* -------------------------------------------------------------------- */
/* Page readiness                                                        */
/* -------------------------------------------------------------------- */

// In-page readiness probe (serialised into the page by Playwright). Resolves
// true once the page has rendered real content and no loading indicator
// remains, or false when `timeout` passes first.
//
// WebSocket-heavy views (notably the Machines list) render a real heading
// plus skeleton rows *before* the data arrives over the socket, set no
// aria-busy, and animate the skeletons purely in CSS — so MAAS's concrete
// loading markers are detected directly.
//
// Rather than polling every element's computed style on a timer, readiness is
// re-evaluated when the DOM mutates (throttled), plus a slow interval for
// CSS-only visibility changes. Each check only touches candidates: elements
// matching the loading selectors, and text nodes starting with "loading".
function appReadyProbe({ timeout }) {
  return new Promise((resolve) => {
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
    ].join(",");
    // Only text that reads as a loading message counts, not any text that
    // merely starts with the word (e.g. a machine named "Loading dock"):
    //   - "Loading", "Loading...", "Loading…" on their own
    //   - "Loading <something>…" ending in an ellipsis
    //   - "Loading <something>" inside a status/live/busy region
    const EXACT_LOADING = /^loading\s*(\.{3}|…)?$/i;
    const LOADING_WITH_ELLIPSIS = /^loading\b.*(\.{3}|…)$/i;
    const STARTS_WITH_LOADING = /^\s*loading\b/i;
    const STATUS_REGION =
      "[role='status'], [role='alert'], [aria-live], [aria-busy='true']";

    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none";
    };
    const isLoadingMessage = (el, text) =>
      EXACT_LOADING.test(text) ||
      LOADING_WITH_ELLIPSIS.test(text) ||
      (STARTS_WITH_LOADING.test(text) && Boolean(el.closest(STATUS_REGION)));
    const hasLoadingText = () => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!STARTS_WITH_LOADING.test(node.data)) continue;
        const el = node.parentElement;
        if (!el) continue;
        // Use the whole element's text so "Loading <b>machines</b>…" counts.
        const text = (el.textContent || "").trim();
        if (isLoadingMessage(el, text) && isVisible(el)) return true;
      }
      return false;
    };
    const isReady = () => {
      if (!document.body) return false;
      // 1. Real content: a heading, or a main landmark with text.
      const hasHeading = document.querySelector("h1, h2, h3, [role='heading']");
      const main = document.querySelector("main, [role='main']");
      if (!hasHeading && !main?.textContent?.trim()) return false;
      // 2. No visible loading message.
      if (hasLoadingText()) return false;
      // 3. No visible loading indicator.
      return !Array.from(document.querySelectorAll(LOADING_SELECTORS)).some(
        isVisible
      );
    };

    let done = false;
    let scheduled = false;
    let observer = null;
    let interval = null;
    let hardCap = null;
    const finish = (value) => {
      if (done) return;
      done = true;
      observer?.disconnect();
      clearInterval(interval);
      clearTimeout(hardCap);
      resolve(value);
    };
    const check = () => {
      scheduled = false;
      if (!done && isReady()) finish(true);
    };
    const schedule = () => {
      if (scheduled || done) return;
      scheduled = true;
      setTimeout(check, 50);
    };
    if (isReady()) {
      finish(true);
      return;
    }
    hardCap = setTimeout(() => finish(false), timeout);
    interval = setInterval(check, 500);
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  });
}

// Wait until the SPA has rendered and no loading state remains. Returns
// true when ready, false on timeout (the caller flags the capture as possibly
// partial rather than failing). A full navigation mid-wait destroys the
// execution context, so the probe is re-armed until the deadline.
export async function waitForAppReady(page, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    throwIfAborted();
    try {
      return await page.evaluate(appReadyProbe, {
        timeout: Math.max(0, deadline - Date.now()),
      });
    } catch {
      if (page.isClosed()) return false;
      await sleep(100);
    }
  }
  return false;
}

// Wait until the DOM has been free of mutations for `quietMs` (capped by
// `timeout`). MAAS hydrates many views from WebSocket responses that arrive
// *after* the first paint — e.g. a device detail page first renders a
// transient "Device not found" state, then swaps in the real content once
// `device.get` resolves over the socket. (DOM mutations are used rather than
// network activity because the socket emits periodic pings that would never
// let a network-idle wait resolve.) Resolves true if the DOM went quiet,
// false if the hard cap was hit.
export async function waitForDomQuiet(page, quietMs, timeout) {
  try {
    return await page.evaluate(
      ({ quietMs, timeout }) =>
        new Promise((resolve) => {
          const target = document.body || document.documentElement;
          if (!target) {
            resolve(true);
            return;
          }
          let quietTimer;
          const finish = (quiet) => {
            clearTimeout(quietTimer);
            clearTimeout(hardCap);
            observer.disconnect();
            resolve(quiet);
          };
          const observer = new MutationObserver(() => {
            clearTimeout(quietTimer);
            quietTimer = setTimeout(() => finish(true), quietMs);
          });
          observer.observe(target, {
            attributes: true,
            characterData: true,
            childList: true,
            subtree: true,
          });
          quietTimer = setTimeout(() => finish(true), quietMs);
          const hardCap = setTimeout(() => finish(false), timeout);
        }),
      { quietMs, timeout }
    );
  } catch {
    return false;
  }
}

// Settle a page before snapshotting or reading its links: wait until it's
// ready, let async (websocket) content stop mutating the DOM, then re-check
// readiness in case data only just started loading, and let the newly
// rendered content settle. Returns true only if the final readiness check
// passed and the DOM went quiet.
export async function settlePage(page, timeout, settleMs) {
  await waitForAppReady(page, timeout);
  await waitForDomQuiet(page, settleMs, timeout);
  const ready = await waitForAppReady(page, timeout);
  const quiet = await waitForDomQuiet(page, settleMs, timeout);
  return ready && quiet;
}

// Classify what a navigation actually landed on, so redirects (e.g. to the
// login page when the session expired) and error views aren't crawled or
// audited as if they were the requested page. Returns
// { ok, finalPath, reason? }.
export async function inspectLoadedPage(page, appBase) {
  let finalPath;
  try {
    const u = new URL(page.url());
    finalPath = u.pathname + u.search;
  } catch {
    return { ok: false, finalPath: null, reason: "invalid final URL" };
  }
  const route = finalPath.startsWith(appBase)
    ? finalPath.slice(appBase.length)
    : finalPath;
  if (/^\/(login|intro)(\/|\?|$)/.test(route)) {
    return {
      ok: false,
      finalPath,
      reason: `redirected to ${route} (session expired or setup incomplete?)`,
    };
  }
  const errorHeading = await page
    .evaluate(() => {
      const heading = document.querySelector(
        "main h1, main h2, h1, [role='main'] [role='heading']"
      );
      const text = (heading?.textContent || "").trim();
      // NotFound view: "Error: Page not found"; ModelNotFound: "<Model> not found".
      return /^error\b|\bnot found$/i.test(text) ? text : null;
    })
    .catch(() => null);
  if (errorHeading) {
    return { ok: false, finalPath, reason: `error page: "${errorHeading}"` };
  }
  return { ok: true, finalPath };
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
export function sectionPrefix(route) {
  const [first] = route.replace(/^\/+/, "").split(/[/?]/);
  return `/${first}`;
}

// Read the major routes straight from the live main navigation so the list
// reflects what the user actually sees. Falls back to FALLBACK_MAJOR_ROUTES.
export async function detectMajorRoutes(
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
      // Group by section so two links to the same top-level section don't
      // crawl the same area twice.
      const key = sectionPrefix(route);
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push({ label, path: route });
    }
    if (routes.length > 0) return routes;
  } catch (err) {
    throwIfAborted();
    console.warn(`  ! Could not read main navigation: ${errorMessage(err)}`);
  }
  return FALLBACK_MAJOR_ROUTES;
}

/* -------------------------------------------------------------------- */
/* Path similarity / de-duplication                                      */
/* -------------------------------------------------------------------- */

// A path segment is treated as a dynamic identifier (record id) when it looks
// like one: a numeric id, a UUID, or a mixed alphanumeric token (e.g. a MAAS
// system_id like "w8aqpg"). Not all ids contain digits (e.g. "rwrqae"), so
// isIdLikeSegment also uses the parent segment for context.
function isDynamicSegment(seg) {
  if (!seg) return false;
  if (/^\d+$/.test(seg)) return true; // pure numeric id
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) return true; // uuid
  if (/\d/.test(seg) && /[a-z]/i.test(seg)) return true; // mixed alphanumeric
  return false;
}

// MAAS detail routes put a record id directly after a singular resource noun
// (e.g. /machine/<system_id>, /subnet/<id>, /kvm/lxd/<id>). Many ids are
// all-letters (e.g. "aspfkw"), so isDynamicSegment can't recognise them on its
// own; the preceding segment is a reliable signal. Derived from the app's
// route definitions.
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
  "switches", // /switches/<id>
  "license-keys", // /settings/license-keys/<osystem>/<distro_series>
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
// differ only in record-id positions (see isIdLikeSegment), whatever the
// position in the path. This collapses the detail pages of different records
// (/device/A/summary == /device/B/summary) while keeping genuinely different
// pages distinct (…/summary vs …/network, /kvm/lxd/<id>/x vs /kvm/virsh/<id>/x).
export function isSameView(a, b) {
  const sa = pathSegments(a);
  const sb = pathSegments(b);
  if (sa.length !== sb.length) return false;
  for (let i = 0; i < sa.length; i++) {
    if (sa[i].toLowerCase() === sb[i].toLowerCase()) continue;
    if (!isIdLikeSegment(sa, i) && !isIdLikeSegment(sb, i)) return false;
  }
  return true;
}

// The route pattern of an app path, with record ids replaced by ":id"
// (e.g. /machine/abc123/summary -> /machine/:id/summary), so findings can be
// mapped to the route definitions in the source.
export function routePattern(route) {
  const segments = pathSegments(route);
  const out = segments.map((s, i) =>
    isIdLikeSegment(segments, i) ? ":id" : s
  );
  return `/${out.join("/")}`;
}

// Decide which discovered paths to keep, suppressing later paths that render
// the same view as one already accepted (same structure, different record).
// Up to `samplesPerPattern` examples are kept per view so some
// conditional-rendering variation across records is still covered.
export function createSimilarityFilter(samplesPerPattern) {
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
/* Browser tab pool                                                      */
/* -------------------------------------------------------------------- */

// A fixed set of browser tabs, one per worker. A tab that crashes (or is
// closed) is replaced so the worker can continue with its remaining pages.
export function createPagePool(context, pages) {
  const crashed = new WeakSet();
  const watch = (p) => p.on("crash", () => crashed.add(p));
  pages.forEach(watch);
  const isBroken = (w) => pages[w].isClosed() || crashed.has(pages[w]);
  const renew = async (w) => {
    await pages[w].close().catch(() => {});
    const fresh = await context.newPage();
    watch(fresh);
    pages[w] = fresh;
    return fresh;
  };
  return {
    get size() {
      return pages.length;
    },
    // Run `fn(page)` on worker `w`'s tab; if the tab crashed during it,
    // replace the tab and try once more.
    async use(w, fn) {
      if (isBroken(w)) await renew(w);
      try {
        return await fn(pages[w]);
      } catch (err) {
        if (runAbort.signal.aborted || !isBroken(w)) throw err;
        console.warn(
          `  ! Browser tab crashed (${errorMessage(err)}); opening a new one.`
        );
        return fn(await renew(w));
      }
    },
  };
}

/* -------------------------------------------------------------------- */
/* Crawling (with capture)                                               */
/* -------------------------------------------------------------------- */

// Crawl one section breadth-first, capturing every page while it is loaded
// (each page is loaded once for both link discovery and auditing). Levels are
// processed in parallel across the tab pool, and new links are accepted in a
// fixed order after each level so results don't depend on timing.
//
// Links are followed anywhere in the app EXCEPT into other detected major
// routes (`otherMajorPrefixes`), so a section reaches its own detail pages
// (e.g. /devices -> /device/<id>/summary) without bleeding into siblings.
//
// `claimed` (shared across sections) maps a final path to
// { section, path, links } for pages already captured; such pages aren't
// captured again, but their links are still followed.
//
// Returns entries in discovery order:
//   { path, capture, redirectedFrom? }       captured page
//   { path, skipped }                        redirect / error view
//   { path, error }                          failed to load or capture
//   { path, duplicateOf, crossSection }      already captured elsewhere
export async function crawlSection({
  pool,
  origin,
  appBase,
  sectionRoute,
  otherMajorPrefixes,
  similarityFilter,
  claimed,
  sectionLabel,
  opts,
  capture,
  onProgress,
}) {
  const underPrefix = (pathname, prefix) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`);
  const inSection = (pathname) =>
    underPrefix(pathname, appBase) &&
    !otherMajorPrefixes.some((prefix) => underPrefix(pathname, prefix));

  const rootPath = `${appBase}${sectionRoute}`;
  const seen = new Set([rootPath]);
  similarityFilter.accept(rootPath.split("?")[0]);

  const entries = [];
  let level = [rootPath];
  let loaded = 0;
  let captured = 0;

  for (let depth = 0; level.length && depth <= opts.maxDepth; depth++) {
    throwIfAborted();
    const batch = level.slice(0, Math.max(0, opts.maxPages - loaded));
    if (batch.length === 0) break;
    loaded += batch.length;
    const followLinks = depth < opts.maxDepth;

    const visit = async (path, page) => {
      const known = claimed.get(path);
      if (known) return { path, known };
      try {
        await retry(
          () =>
            page.goto(origin + path, {
              waitUntil: "domcontentloaded",
              timeout: opts.timeout,
            }),
          { attempts: opts.retries + 1, delayMs: 500 }
        );
      } catch (err) {
        throwIfAborted();
        return { path, error: `failed to load: ${errorMessage(err)}` };
      }
      const settled = await settlePage(page, opts.timeout, opts.settle);
      const landed = await inspectLoadedPage(page, appBase);
      if (!landed.ok) return { path, skipped: landed.reason };
      const finalPath = landed.finalPath;
      if (finalPath !== path && !inSection(finalPath.split("?")[0])) {
        return {
          path,
          skipped: `redirected outside this section to ${finalPath}`,
        };
      }
      // Read links before capturing: keyboard checks and interactions change
      // the page state.
      const links = followLinks
        ? await page
            .$$eval("a[href]", (as) => as.map((a) => a.href))
            .catch(() => [])
        : [];
      if (claimed.has(finalPath)) return { path, finalPath, links };
      try {
        const result = await capture(page, { path: finalPath, settled });
        return { path, finalPath, links, capture: result };
      } catch (err) {
        throwIfAborted();
        return { path, finalPath, links, error: errorMessage(err) };
      }
    };

    const results = new Array(batch.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(pool.size, batch.length) }, (_, w) =>
        (async () => {
          for (let i = next++; i < batch.length; i = next++) {
            throwIfAborted();
            results[i] = await pool.use(w, (page) => visit(batch[i], page));
            if (results[i].capture) {
              captured += 1;
              onProgress?.(captured, loaded);
            }
          }
        })()
      )
    );

    // Resolve claims and queue the next level in batch order.
    const nextLevel = [];
    for (const r of results) {
      let links = r.links || [];
      if (r.known) {
        entries.push({
          path: r.path,
          duplicateOf: r.known.path,
          crossSection: r.known.section !== sectionLabel,
        });
        links = r.known.links || [];
      } else if (r.skipped || (r.error && !r.finalPath)) {
        entries.push(
          r.skipped
            ? { path: r.path, skipped: r.skipped }
            : { path: r.path, error: r.error }
        );
      } else {
        const owner = claimed.get(r.finalPath);
        if (owner) {
          const sameSectionRedirect =
            r.path !== r.finalPath && owner.section === sectionLabel;
          entries.push(
            sameSectionRedirect
              ? {
                  path: r.path,
                  skipped: `redirects to ${r.finalPath}, already audited via ${owner.path}`,
                }
              : {
                  path: r.path,
                  duplicateOf: owner.path,
                  crossSection: owner.section !== sectionLabel,
                }
          );
        } else {
          claimed.set(r.finalPath, {
            section: sectionLabel,
            path: r.finalPath,
            links,
          });
          if (r.path !== r.finalPath)
            claimed.set(r.path, claimed.get(r.finalPath));
          seen.add(r.finalPath);
          entries.push(
            r.capture
              ? {
                  path: r.finalPath,
                  capture: r.capture,
                  ...(r.finalPath !== r.path ? { redirectedFrom: r.path } : {}),
                }
              : { path: r.finalPath, error: r.error }
          );
        }
      }
      if (!followLinks) continue;
      for (const href of links) {
        let u;
        try {
          u = new URL(href);
        } catch {
          continue; // malformed hrefs (mailto:, javascript:, etc.)
        }
        if (u.origin !== origin || !inSection(u.pathname)) continue;
        const clean = u.pathname + u.search; // drop hash fragments
        if (
          !seen.has(clean) &&
          loaded + nextLevel.length < opts.maxPages &&
          // Skip near-duplicates of accepted paths (e.g. the detail page of
          // a different record).
          similarityFilter.accept(u.pathname)
        ) {
          seen.add(clean);
          nextLevel.push(clean);
        }
      }
    }
    level = nextLevel;
  }

  return entries;
}
