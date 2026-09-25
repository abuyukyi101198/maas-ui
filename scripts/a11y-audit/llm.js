/* Context-aware layer: the local Ollama model (what axe can't judge). */

import fs from "node:fs/promises";
import pc from "picocolors";

import {
  DEFAULT_MAX_NUM_CTX,
  FALLBACK_NUM_CTX,
  MAX_CONTEXT_FINDINGS,
  SEVERITIES,
  SEVERITY_RANK,
} from "./constants.js";
import { errorMessage, fetchWithTimeout, httpError, kebab } from "./util.js";

// Pre-flight check that Ollama is reachable and the model is pulled, so the
// run fails fast with a clear message instead of failing on every page later.
// Returns the model's maximum trained context length (or null if unreported).
export async function checkOllama(ollamaUrl, model, timeoutMs) {
  let res;
  try {
    res = await fetchWithTimeout(
      `${ollamaUrl}/api/show`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      },
      timeoutMs
    );
  } catch (err) {
    throw new Error(
      `Cannot reach Ollama at ${ollamaUrl} (${errorMessage(err)}). ` +
        "Start it with `ollama serve`, or pass --no-context-checks."
    );
  }
  if (res.status === 404) {
    throw new Error(
      `Model "${model}" is not available in Ollama. ` +
        `Pull it with \`ollama pull ${model}\`.`
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Ollama /api/show failed (${res.status} ${res.statusText}): ${body}`
    );
  }
  const data = await res.json().catch(() => ({}));
  const info = data.model_info || {};
  const key = Object.keys(info).find((k) => k.endsWith(".context_length"));
  return key ? info[key] : null;
}

// Pick the context window: --num-ctx (never above the model max), otherwise
// the model's own length capped at DEFAULT_MAX_NUM_CTX, otherwise a fallback.
export function resolveNumCtx(requested, modelMaxContext) {
  if (requested) {
    if (modelMaxContext && requested > modelMaxContext) {
      return { numCtx: modelMaxContext, source: "override, capped" };
    }
    return { numCtx: requested, source: "override" };
  }
  if (modelMaxContext) {
    return modelMaxContext > DEFAULT_MAX_NUM_CTX
      ? { numCtx: DEFAULT_MAX_NUM_CTX, source: "default cap" }
      : { numCtx: modelMaxContext, source: "model" };
  }
  return { numCtx: FALLBACK_NUM_CTX, source: "fallback" };
}

// Conventional labels the model must not flag as unclear: one per line, with
// blank lines and # comments ignored.
export async function loadAllowLabels(file) {
  if (!file) return [];
  const text = await fs.readFile(file, "utf-8");
  return text
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);
}

/* ---- Output contract ------------------------------------------------- */

// Every WCAG 2.2 success criterion, as "principle.guideline.criterion".
// 4.1.1 Parsing is excluded: it was removed from WCAG 2.2 (obsolete in 2.1).
const WCAG_CRITERIA = (() => {
  // [guideline, number of success criteria]
  const guidelines = [
    ["1.1", 1],
    ["1.2", 9],
    ["1.3", 6],
    ["1.4", 13],
    ["2.1", 4],
    ["2.2", 6],
    ["2.3", 3],
    ["2.4", 13],
    ["2.5", 8],
    ["3.1", 6],
    ["3.2", 6],
    ["3.3", 9],
    ["4.1", 3],
  ];
  const list = [];
  for (const [guideline, count] of guidelines) {
    for (let i = 1; i <= count; i++) list.push(`${guideline}.${i}`);
  }
  return list.filter((sc) => sc !== "4.1.1");
})();
const WCAG_CRITERIA_SET = new Set(WCAG_CRITERIA);

// The kind of claim a finding makes. Structured so it can be checked in code
// (see grounding.js) instead of parsing the finding's wording.
export const FINDING_KINDS = [
  "ambiguous-name",
  "misleading-name",
  "heading-structure",
  "other",
];

// JSON Schema for Ollama structured outputs: constrains the response shape
// and restricts enums (kind, severity, wcag) at generation time.
const CONTEXT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      maxItems: MAX_CONTEXT_FINDINGS,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: FINDING_KINDS },
          severity: { type: "string", enum: SEVERITIES },
          wcag: { type: "string", enum: WCAG_CRITERIA },
          role: { type: "string" },
          name: { type: "string" },
          landmark: { type: "string" },
          issue: { type: "string" },
          fix: { type: "string" },
        },
        required: [
          "kind",
          "severity",
          "wcag",
          "role",
          "name",
          "landmark",
          "issue",
          "fix",
        ],
      },
    },
  },
  required: ["findings"],
};

const VERIFY_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    confirmed: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["confirmed", "reason"],
};

const OUTLINE_FORMAT = `The accessibility tree is given as an indented outline. Each line is: role "accessible name" [href="/path" state=value ...]. Deeper indentation means a descendant. A control shown with "" has no accessible name. A line like '… (12 more similar listitem)' means structurally identical siblings were omitted; '… (N line(s) cut to fit the context window)' means part of the tree was cut. Shared site chrome (main navigation, banner, footer) has been removed; it is reviewed once elsewhere.`;

// Rules for the context review. Sent as the system message: smaller local
// models follow system instructions more reliably than a long user prompt.
export function buildSystemPrompt(allowLabels = []) {
  const allowed = allowLabels.length
    ? `, and these labels: ${allowLabels.map((l) => JSON.stringify(l)).join(", ")}`
    : "";
  return `You are a senior accessibility (WCAG 2.2 AA) expert. You review one view of a web application at a time, given its accessibility tree.

${OUTLINE_FORMAT}

Report ONLY genuine issues that need human judgement of CONTEXT, which an automated rule engine cannot detect, where a screen-reader user would be confused or misled. Classify each finding with "kind":
- "ambiguous-name": two or more links/controls in the outline with the SAME accessible name but DIFFERENT href values or actions, with nothing to tell them apart
- "misleading-name": an accessible name that clearly contradicts or misrepresents the control's purpose
- "heading-structure": heading text or order that misrepresents the content hierarchy
- "other": another context-dependent issue with a clear WCAG success criterion

Rules — follow ALL of them:
- Be conservative: when in doubt, do not report. Zero findings is a good answer.
- "wcag" must be a real WCAG 2.2 success criterion number (e.g. "2.4.4").
- "role" and "name" must identify ONE element exactly as written in the outline: copy the role and the name verbatim (including any trailing "…"). Use "" as the name only for an element shown with "".
- "landmark": the nearest enclosing landmark or heading from the outline, verbatim (e.g. main "Machines"), or "" if there is none.
- Only claim that names are the same when every element you rely on is visible in the outline. Never infer from '… (N more similar …)' lines.
- Links with the same name AND the same href go to the same place: that is NOT an issue.
- Do NOT flag concise, conventional labels that are clear in context, e.g. "Delete", "Save", "Edit", tab names, a logo or home link, usernames, product and brand names${allowed}.
- Do NOT report what a rule engine checks: missing names, missing alt text, contrast, ARIA validity, list structure.
- Do NOT suggest making labels longer purely for verbosity.
- NEVER include a full web address (http:// or https://). Site-relative href paths from the outline are fine as evidence.
- Report at most ${MAX_CONTEXT_FINDINGS} findings, the most certain first.

Fields of each finding: "kind", "severity" ("critical" | "serious" | "moderate" | "minor"), "wcag", "role", "name", "landmark", "issue" (one factual sentence of at most 22 words citing the evidence), "fix" (one imperative sentence of at most 22 words).

Return ONLY JSON: {"findings":[{"kind":string,"severity":string,"wcag":string,"role":string,"name":string,"landmark":string,"issue":string,"fix":string}]}`;
}

// The page-specific part of the review, sent as the user message.
export function buildUserMessage({ page, knownRuleIds, outline }) {
  return `View: ${page}
Rule ids already reported by axe-core on this view (do not repeat them): ${
    knownRuleIds.join(", ") || "(none)"
  }

Accessibility outline:
${outline}`;
}

/* ---- Ollama chat ---------------------------------------------------- */

// Older Ollama versions only accept `format: "json"`. Flipped (once, for the
// whole run) if the server rejects a JSON-schema format.
let schemaFormatSupported = true;

// One non-streaming /api/chat call with deterministic sampling. Older Ollama
// versions reject a JSON-schema `format` with a 400; rather than guessing from
// the error text, the request is retried once with `format: "json"`: if that
// succeeds the fallback is kept for the rest of the run, and if it also fails
// the 400 is a genuine request error.
async function ollamaChat({
  ollamaUrl,
  model,
  messages,
  schema,
  numCtx,
  timeoutMs,
  seed,
}) {
  const request = (format) =>
    fetchWithTimeout(
      `${ollamaUrl}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          format,
          options: {
            temperature: 0,
            top_p: 1,
            top_k: 1,
            seed,
            repeat_penalty: 1,
            ...(numCtx ? { num_ctx: numCtx } : {}),
          },
        }),
      },
      timeoutMs
    );

  let res = await request(schemaFormatSupported ? schema : "json");
  if (res.status === 400 && schemaFormatSupported) {
    const schemaBody = await res.text().catch(() => "");
    res = await request("json");
    if (res.ok) {
      // Concurrent requests may all hit this; warn only once.
      if (schemaFormatSupported) {
        schemaFormatSupported = false;
        console.warn(
          pc.yellow(
            "  ! Ollama rejected the JSON-schema format (upgrade Ollama for " +
              'structured outputs); falling back to format: "json".'
          )
        );
      }
    } else {
      const jsonBody = await res.text().catch(() => "");
      throw httpError(
        `Ollama request failed (${res.status} ${res.statusText}): ` +
          `${jsonBody || schemaBody}`,
        res.status
      );
    }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw httpError(
      `Ollama request failed (${res.status} ${res.statusText}): ${body}`,
      res.status
    );
  }
  const data = await res.json();
  return {
    content: data.message?.content ?? "",
    usage: {
      prompt_eval_count: data.prompt_eval_count,
      eval_count: data.eval_count,
      eval_duration: data.eval_duration,
      total_duration: data.total_duration,
    },
  };
}

// Parse a model response as JSON. Failures are tagged `parseError` so the
// caller retries them (a malformed response must not look like "no findings")
// and counts them.
function parseModelJson(content) {
  try {
    return JSON.parse(String(content).trim());
  } catch (err) {
    const parseErr = new Error(
      `Model returned invalid JSON (${errorMessage(err)}): ` +
        `${String(content).slice(0, 120)}`
    );
    parseErr.parseError = true;
    throw parseErr;
  }
}

// The context model must never emit full URLs; strip any that slip through.
const stripUrls = (s) =>
  String(s ?? "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

// Review one view. `attempt` (1-based) varies the sampling seed so a retry
// after a malformed response doesn't reproduce the same output.
export async function runContextChecks({
  ollamaUrl,
  model,
  numCtx,
  timeoutMs,
  attempt = 1,
  systemPrompt,
  userMessage,
}) {
  const { content, usage } = await ollamaChat({
    ollamaUrl,
    model,
    numCtx,
    timeoutMs,
    seed: 42 + (attempt - 1),
    schema: CONTEXT_RESPONSE_SCHEMA,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });
  const parsed = parseModelJson(content);
  if (!parsed || !Array.isArray(parsed.findings)) {
    const err = new Error('Model response is missing a "findings" array.');
    err.parseError = true;
    throw err;
  }

  const candidates = [];
  let invalidWcag = 0;
  for (const f of parsed.findings) {
    const issue = stripUrls(f?.issue);
    if (!issue) continue;
    const wcag = String(f?.wcag ?? "").trim();
    // Precision filter: require a real WCAG success criterion.
    if (!WCAG_CRITERIA_SET.has(wcag)) {
      invalidWcag += 1;
      continue;
    }
    const role = String(f?.role ?? "").trim();
    const name = stripUrls(f?.name);
    const landmark = stripUrls(f?.landmark);
    candidates.push({
      source: "ai",
      kind: FINDING_KINDS.includes(f?.kind) ? f.kind : "other",
      severity: SEVERITIES.includes(f?.severity) ? f.severity : "moderate",
      wcag,
      count: 1,
      role,
      name,
      landmark,
      location: `${role || "element"} ${JSON.stringify(name)}${
        landmark ? ` in ${landmark}` : ""
      }`,
      issue,
      fix: stripUrls(f?.fix),
    });
  }

  // Enforce the per-view cap in code (the prompt alone doesn't guarantee it),
  // keeping the most severe findings.
  candidates.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  );
  const kept = candidates.slice(0, MAX_CONTEXT_FINDINGS);
  const capped = candidates.length - kept.length;

  const used = new Set();
  const findings = kept.map((f) => {
    const base =
      kebab(`${f.kind} ${f.name || f.issue}`.slice(0, 48)) || "context-issue";
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    return { ...f, id };
  });
  return { findings, usage, capped, invalidWcag };
}

// Second pass: ask the model whether the outline really shows one finding.
// Returns { confirmed, reason, usage }.
export async function verifyContextFinding({
  ollamaUrl,
  model,
  numCtx,
  timeoutMs,
  attempt = 1,
  page,
  outline,
  finding,
}) {
  const system = `You check one reported accessibility finding against a view's accessibility tree and answer whether the tree clearly shows the problem as described.

${OUTLINE_FORMAT}

Answer "confirmed": true only if the element exists in the outline exactly as cited AND the outline itself shows the problem. Answer false if the element is missing, the evidence is inferred or speculative, the finding concerns a conventional label that is clear in context, or links with the same name also share the same href. Give a one-sentence "reason". Return ONLY JSON: {"confirmed":boolean,"reason":string}`;
  const user = `View: ${page}

Finding:
- kind: ${finding.kind}
- WCAG: ${finding.wcag}
- element: ${finding.role} ${JSON.stringify(finding.name)}${
    finding.landmark ? ` in ${finding.landmark}` : ""
  }
- issue: ${finding.issue}

Accessibility outline:
${outline}`;
  const { content, usage } = await ollamaChat({
    ollamaUrl,
    model,
    numCtx,
    timeoutMs,
    seed: 7 + (attempt - 1),
    schema: VERIFY_RESPONSE_SCHEMA,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const parsed = parseModelJson(content);
  if (typeof parsed?.confirmed !== "boolean") {
    const err = new Error('Verification response is missing "confirmed".');
    err.parseError = true;
    throw err;
  }
  return {
    confirmed: parsed.confirmed,
    reason: stripUrls(parsed.reason),
    usage,
  };
}
