# Accessibility audit (`yarn a11y-audit`)

`scripts/a11y-audit/` is a command-line accessibility audit for a running
MAAS. It signs in, crawls the sections you choose, and for every page:

1. captures Chromium's accessibility tree (including iframe content);
2. runs [axe-core](https://github.com/dequelabs/axe-core) (WCAG A/AA rules);
3. optionally runs keyboard checks (`--keyboard-checks`);
4. optionally opens known menus and "Add …" panels and audits them too
   (`--interactions`);
5. sends a compact outline of the page to a local
   [Ollama](https://ollama.com) model, which looks for problems that depend on
   context (ambiguous or misleading names, heading structure). A rule engine
   can't check these.

Findings are de-duplicated across pages and printed to the console. They are
also written to a JSON file and, optionally, a Markdown report.

## Prerequisites

- A running MAAS you can sign in to. See [RUNNING_MAAS.md](RUNNING_MAAS.md).
- Node dependencies installed (`yarn install`).
- Chromium for Playwright: `npx playwright install chromium`.
- For the context review (on by default):
  1. Install Ollama: <https://ollama.com/download>.
  2. Start the server: `ollama serve`.
  3. Pull a model: `ollama pull llama3` (the default; choose another with
     `-m`).

  Skip this with `--no-context-checks` to run only axe-core and keyboard
  checks.

## Usage

```sh
export MAAS_PASSWORD=...   # or omit it to be prompted
yarn a11y-audit http://localhost:5240 -u admin
```

With no section options, the script reads the sections from the main
navigation and asks you to choose. Other examples:

```sh
# Only the Machines section (start URL under the UI base)
yarn a11y-audit http://localhost:5240/MAAS/r/machines -u admin

# Chosen sections, with keyboard and interaction checks and a Markdown report
yarn a11y-audit http://localhost:5240 -u admin \
  --sections /machines,Devices --keyboard-checks --interactions \
  --report a11y-audit.md

# CI: no prompts, rule engine only, fail on serious or critical findings
MAAS_PASSWORD=... yarn a11y-audit http://maas:5240 -u admin \
  --yes --no-context-checks --keyboard-checks --fail-on serious
```

The URL is either the MAAS origin (any path above the UI base, e.g.
`http://host:5240/MAAS`) or a page under the UI base
(`http://host:5240/MAAS/r/…`). A page URL becomes the section to audit. Any
other path is an error.

Run `yarn a11y-audit --help` for every option. The main ones are:

| Option | Default | Purpose |
| --- | --- | --- |
| `--sections <list>` / `--all` | prompt | Choose sections by label or path (a path under a section starts the crawl there), or audit all of them |
| `-y, --yes` | off | Never prompt: audit every section unless `--sections` is given, and fail instead of asking for a password |
| `--max-pages <n>` / `--max-depth <n>` | 25 / 2 | Crawl limits per section |
| `--samples-per-pattern <n>` | 1 | Pages kept per group of similar paths (e.g. the detail pages of different machines) |
| `--concurrency <n>` | 3 | Browser tabs loading and capturing pages in parallel |
| `--keyboard-checks` | off | Tab order and Shift+Tab, visible focus indicator (2.4.7), focus hidden under sticky content (2.4.11), traps, and dialog focus with `--interactions` |
| `--interactions` | off | Open known triggers on each page and audit what they open (see below) |
| `-m, --model <name>` | `llama3` | Ollama model |
| `--num-ctx <n>` | model max, capped at 8192 | Context window |
| `--llm-concurrency <n>` | 1 | Parallel Ollama requests; needs `OLLAMA_NUM_PARALLEL` on the server |
| `--verify` | off | Second model pass that confirms each context finding against the outline |
| `--allow-labels <file>` | bundled MAAS list | Labels the model must not flag as unclear |
| `--json <path>` / `--no-json` | `a11y-audit.json` | Structured findings |
| `--report <path>` | off | Markdown report |
| `--fail-on <severity>` | off | Exit with code 2 when a finding at or above this severity exists |
| `--audit-timeout <ms>` | off | Wall-clock limit for the whole run |

## Output

- **Console:** one block per page (or opened state), listing what was captured
  and the findings. Each finding has a severity, a source (`axe`, `keyboard` or
  `ai·context`), a WCAG criterion, the element and a suggested fix. A summary
  follows. It counts findings by severity and source, plus pages that didn't
  finish loading, outlines cut to fit the context window, model responses that
  weren't valid JSON, ungrounded findings that were dropped, and repeated
  findings.
- **JSON** (`--json`, on by default): `{ site, model, generated, summary,
  pages[] }`. Each page lists its `route` and `routePattern` (record ids
  replaced with `:id`, e.g. `/machine/:id/summary`), so findings can be traced
  to route definitions. axe findings include each flagged element's selector
  and HTML. Keyboard findings include a CSS selector.
- **Markdown** (`--report`): the same findings as tables, grouped by section.

A finding that appears on several pages is reported once, with "also on"
listing the other pages.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Audit finished (and no findings at or above `--fail-on`, if set) |
| 1 | Setup failed (bad URL, Ollama unreachable, sign-in failed, nothing captured), fatal error, or `--audit-timeout` exceeded |
| 2 | Findings at or above `--fail-on`. Low-confidence context findings don't count |

## Context review and confidence

The model gets the page's accessibility tree as an indented outline, with the
following removed:

- the shared navigation, banner and footer, which are reviewed only once;
- repeated rows beyond `--tree-samples`.

Headings and form fields are never collapsed. A long outline is cut evenly
across the page to fit the context window, and a marker shows where lines
were removed.

Each context finding names the element it's about (`role`, `name`,
`landmark`). A finding is **dropped** if that element, or any name quoted in
the issue, isn't in the outline the model received. Findings that are kept are
labelled with a **confidence** level, based on these checks:

- `verified-duplicate`: an "ambiguous name" finding where the name really is
  used by several controls with different destinations. Gives high
  confidence.
- `unverified-duplicate`, `same-target`: the duplicate claim doesn't hold up.
  Gives low confidence.
- `outside-main`, `criterion-role`, `kind-role`, `allowlisted-label`: the
  finding is about something outside `main`, or cites a WCAG criterion that
  doesn't apply to the role, or targets a conventional label. Gives low
  confidence.
- `model-confirmed` / `model-unconfirmed`: the result of the `--verify` pass.

Low-confidence findings are still reported, but don't count for `--fail-on`.
Treat every context finding as a lead for a human to check, not a verdict.

### Allowed labels

`scripts/a11y-audit/allow-labels.maas.txt` lists conventional MAAS labels
("Delete", "Take action", tab names, and so on). The model is told not to flag
them, and findings about them are marked low confidence. The file takes one
label per line, and `#` starts a comment. Pass your own list with
`--allow-labels <file>`, or disable it with `--no-allow-labels`.

## Interactions

`--interactions` opens UI that doesn't change the URL. On each page, it finds
enabled, collapsed buttons inside `main` that either open a popup
(`aria-haspopup`) or match an include pattern ("Add …", "Take action",
"Filters", "Columns", "Actions"). It skips anything matching an exclude pattern
(delete, deploy, power, release, save, submit, and similar). For each trigger,
it:

1. reloads the page;
2. clicks the trigger and waits for the page to settle;
3. captures the tree, runs axe (and dialog focus checks with
   `--keyboard-checks`);
4. closes what opened with Escape.

It only clicks the trigger itself: it never clicks anything inside the opened
menu or panel, and never submits a form. Triggers that navigate to another
page are skipped. The limit is 5 triggers per page by default.

Override the defaults with `--interactions-config <file>`:

```json
{
  "include": ["^add\\b", "^take action$"],
  "exclude": ["delete|remove|deploy|power|release"],
  "haspopup": true,
  "maxPerPage": 3
}
```

Patterns are case-insensitive regular expressions matched against the
button's accessible name. Fields you leave out keep their defaults. Use the
flag against a test MAAS, not production: opening panels is safe, but
MAAS's UI can change.

## Limitations

- The context review uses a small local model. It misses issues and
  sometimes reports ones that aren't there. The grounding and confidence checks
  reduce this but can't remove it.
- Checks that need to see the page, such as whether the visible label matches
  the accessible name (WCAG 2.5.3), aren't performed. The model only reads the
  accessibility tree.
- Keyboard checks are heuristic. A missing focus indicator is detected by
  comparing outline, box-shadow, border and background before and after focus.
- Pages are captured after the DOM has been quiet for `--settle` ms. Slow
  websocket data can still render later. Such pages are flagged in the output.
