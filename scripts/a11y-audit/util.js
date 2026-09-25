/* General helpers: errors, retries, timeouts, run-wide abort, concurrency. */

// Safely turn any thrown value into a readable string. Not everything thrown
// is an Error (code can throw strings, objects, etc.), so reading `.message`
// blindly can itself produce confusing output.
export function errorMessage(err) {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// Build an Error for a failed HTTP response. Only rate limiting (429) and
// server errors (5xx) are worth retrying; other 4xx responses (bad
// credentials, unknown model, malformed request) will fail the same way again.
export function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  err.retryable = status === 429 || status >= 500;
  return err;
}

// Run-wide abort signal, fired by --audit-timeout. Long-running loops check it
// between units of work and in-flight fetches are cancelled through it.
export const runAbort = new AbortController();

export function throwIfAborted() {
  if (runAbort.signal.aborted) throw runAbort.signal.reason;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retry an async operation a few times with linear backoff. Used for
// transient failures (slow navigation, late websocket data, a briefly busy
// Ollama server or backend). `attempts` is the TOTAL number of tries. Errors
// flagged `retryable: false` (and a run abort) are rethrown immediately.
// `onError(err, attempt)` observes every failed attempt (e.g. for counters).
export async function retry(fn, { attempts = 3, delayMs = 500, onError } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    throwIfAborted();
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      onError?.(err, attempt);
      if (err?.retryable === false || runAbort.signal.aborted) throw err;
      if (attempt < attempts) await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}

// fetch() with an AbortController-based timeout so a hung Ollama/MAAS request
// can't stall the whole run indefinitely. A non-positive timeout disables the
// per-request timeout; the run-wide abort signal always applies. Timeouts are
// tagged `timedOut: true`.
export async function fetchWithTimeout(url, options = {}, timeoutMs) {
  throwIfAborted();
  const controller = new AbortController();
  const onRunAbort = () => controller.abort();
  runAbort.signal.addEventListener("abort", onRunAbort, { once: true });
  const timer =
    timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (runAbort.signal.aborted) throw runAbort.signal.reason;
    if (controller.signal.aborted) {
      const timeoutErr = new Error(
        `Request timed out after ${timeoutMs}ms: ${url}`
      );
      timeoutErr.timedOut = true;
      throw timeoutErr;
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    runAbort.signal.removeEventListener("abort", onRunAbort);
  }
}

// Run `fn` over items with a fixed pool of workers, preserving result order.
// Workers stop picking up new items once the run is aborted. `fn` receives
// (item, index, workerIndex).
export async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async (workerIndex) => {
    for (let i = next++; i < items.length; i = next++) {
      throwIfAborted();
      results[i] = await fn(items[i], i, workerIndex);
    }
  };
  const count = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: count }, (_, w) => worker(w)));
  return results;
}

// A concurrency limiter whose limit can be lowered while running. Used for
// Ollama requests: the client can't see the server's OLLAMA_NUM_PARALLEL, so
// it starts at --llm-concurrency and drops to 1 if requests time out while
// others are in flight (a sign the server is queueing them).
export function createLimiter(initialLimit) {
  let active = 0;
  const waiting = [];
  const limiter = {
    limit: Math.max(1, initialLimit),
    get active() {
      return active;
    },
    reduceTo(limit) {
      limiter.limit = Math.max(1, limit);
    },
    async run(fn) {
      await new Promise((resolve) => {
        waiting.push(resolve);
        drain();
      });
      try {
        return await fn();
      } finally {
        active -= 1;
        drain();
      }
    },
  };
  const drain = () => {
    while (active < limiter.limit && waiting.length) {
      active += 1;
      waiting.shift()();
    }
  };
  return limiter;
}

export function kebab(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function truncateText(str, max) {
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}
