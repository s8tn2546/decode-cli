# DeCode — Architecture

## Overview
DeCode (`decode-cli`) is a Node.js CLI that gives developers core capabilities from the terminal: auto-detected API health checking, GitHub activity analysis, documentation generation, and a composite audit that summarizes all of them. Any file writes are gated by human approval; an AI-assisted code editing flow (PRD story 5) is planned but not yet implemented.

## Stack
- **Runtime:** Node.js (>=18)
- **Build:** esbuild bundles `src/` → `dist/index.js` (ESM, JSX→JS, all runtime deps external). The published `bin/decode.js` imports the compiled bundle; `tsx` is dev-only and used only by `npm run dev` for local iteration.
- **CLI framework:** `commander` (argument parsing + `.showSuggestionAfterError()` for near-miss subcommands)
- **Terminal output:** `chalk` (color), `cli-table3` (tables), `ora` (spinners), `boxen` (summary panels), `inquirer` (interactive prompts)
- **Rendering engine (`src/ui/`):** a composable screen-rendering layer (renderer → components → theme) used by the `audit` command and the custom landing screen. See [`src/ui/README.md`](src/ui/README.md), [`src/ui/ENGINE.md`](src/ui/ENGINE.md), and the full build report [`src/ui/RENDERING_ENGINE_COMPLETE.md`](src/ui/RENDERING_ENGINE_COMPLETE.md).
- **GitHub integration:** `octokit` (REST/GraphQL)
- **LLM integration:** runtime calls go through the provider configured in the merged config (anthropic / openai / groq / other), via `src/services/llmClient.js`
- **Testing:** `vitest` (unit), `execa`-driven CLI integration tests
- **Linting:** ESLint
- **Config:** a two-tier JSON config store — see [Data Model](#data-model)

## High-Level Design

```
CLI Entry (bin/decode.js)
        │
        ▼
  Command Router (commander)
        │
   ┌────┴─────────────────────────┐
   │                               │
Matched command             Unmatched input (planned —
   │                         not yet implemented)
   ▼                               │
Command Modules                    ▼
(api, github, doc,           AI Agent Fallback
 audit, config, etc.)         (natural-language
   │                            instruction handler)
   │
   ▼
Shared Services
┌───────────┼────────────┐
▼           ▼            ▼
Config      LLM         GitHub
Store       Client      Client
▼
Rendering Engine (src/ui/) — used by audit + landing screen
```

## Data Model
- **Two-tier config store** — DeCode resolves configuration from two scopes and merges them **field-by-field** (never all-or-nothing):
  - **Global** (`~/.decode/config.json`): machine-wide, set once and applies to every project by default. Its secrets live in `~/.decode/.env`.
  - **Local** (`<project-root>/decode.config.json`, optional): only the fields explicitly set locally override the global value; anything not set falls back to global, then to defaults. Secrets live in `<project-root>/.env`.
  - The project root is found by walking upward from the working directory to the nearest `decode.config.json` (mirrors how git finds `.git`), so commands run from a subdirectory still resolve the project-local config.
  - `decode init` picks the scope (defaults to global on a first-ever run, local once a global setup exists); `decode config set/list/reset` take `--global` / `--local`; `decode status` labels each credential with the scope it came from.
- **Config shape** — the merged config stores the LLM provider + key reference, the GitHub token reference, user state (`updatedAt`, last audit summary), and the **cached route-scan result** (routes are always auto-detected from source, never hand-entered). The committed template is `decode.config.example.json`; local `decode.config.json` is gitignored runtime state.
- **Credentials:** never stored in plaintext in the repo; read from `.env` (local or global tier) or OS keychain where feasible. `.env.example` documents required variables.
- **No database** — DeCode is stateless between runs beyond the config files; each command reads fresh data (API responses, GitHub API data, filesystem) at call time.

## Command Modules
- `api` — auto-detected route discovery (`list`, cached in the project config with `--refresh`) and health checking (`check`) against a live backend. Routes come from scanning the project's Express source (`src/services/routeDetector.js`); dynamic-segment routes are flagged in `list` and skipped in `check` rather than guessed. Base URL resolution: `--base-url` → `PORT` in `.env` → reachable common dev port. The manual `add`/`remove` flow no longer exists.
- `github` — account + activity analysis via GitHub API (`connect`/`profile`/`analyze`). `analyze` reports commit health heuristics (docs-only, vague messages, size outliers, bursts) that ground the AI summary; `profile` shows recent commit history across the user's repos plus an AI activity narrative.
- `doc` — documentation generation (`doc [message]`, `doc --explain`) and staleness checking (`doc check`).
- `audit` — composes the API, docs, and repo-health checks into one summary (`--json` / `--ci`); the reference implementation for the rendering engine's Verdict → Evidence → Action pattern.
- `init` / `connect` / `disconnect` / `status` / `config` — account and settings lifecycle, with global/local config scoping.
- **Planned (not yet implemented):** AI Agent Fallback (natural-language code edits, PRD story 5).

## Folder Structure

```
decode-cli/
├── .github/workflows/ci.yml         # CI: install → build → lint → test (Node 22)
├── bin/decode.js                    # CLI entry point — thin wrapper that imports dist/
├── dist/                            # esbuild output (gitignored, built before publish)
│   └── index.js                     # single bundled ESM file — all src/ inlined
├── src/
│   ├── index.js                    # app bootstrap: registers commands; no-arg → startSession()
│   ├── constants.js                # CLI identity, timeouts, exit codes
│   ├── commands/                   # thin layer per command group (parse → service → render)
│   │   ├── init.js  connect.js  disconnect.js  status.js
│   │   ├── api.js                  # api list/check (auto-detection)
│   │   ├── github.js               # github connect/profile/analyze
│   │   ├── doc.js                  # doc, doc --explain, doc check
│   │   ├── config.js               # config list/set/reset (--global | --local)
│   │   ├── audit.js                # composite audit (rendering-engine reference impl)
│   │   └── help.js                 # custom landing screen
│   ├── session/
│   │   └── session.js              # interactive REPL — startSession(), parseSlashInput()
│   ├── services/                   # reused logic, unit-testable without the CLI
│   │   ├── apiChecker.js, auditRunner.js, configStore.js, docGenerator.js,
│   │   ├── docStaleness.js, githubClient.js, llmClient.js, projectScanner.js,
│   │   ├── projectContext.js, assistantPrompt.js, repoAnalyst.js, repoHealth.js, routeDetector.js
│   ├── ui/                         # composable terminal rendering engine
│   │   ├── renderer.js  motion.js  screen.js  progress.js
│   │   ├── divider.js  icons.js  layout.js  panel.js  prompt.js  status.js
│   │   ├── table.js  terminal.js  theme.js  typography.js  health-pulse.js
│   │   ├── index.js
│   │   └── ENGINE.md  README.md  RENDERING_ENGINE_COMPLETE.md
│   └── utils/output.js             # shared chalk/table/boxen helpers
├── test/
│   ├── unit/                       # hits services + session parser directly (vitest)
│   └── integration/                # runs the real CLI binary via execa
├── docs/                           # generated output (docs/architecture.md) —
│   └── architecture.md             # written by `decode doc`, separate from hand-written docs
├── examples/                       # UI showcase / usage examples (examples/ui-showcase.js)
├── .env.example  .eslintrc.json  .gitignore  decode.config.example.json
├── decode.config.json → gitignored local runtime state (not committed)
├── AGENTS.md  AGENTS_AND_SKILLS.md  PRD.md  README.md
├── CHANGELOG.md  TASKS.md  COMMAND_STANDARD.md  LICENSE  package.json
```

**Design rationale for the split:**
- `commands/` vs `services/` keeps command handlers thin and testable, and keeps the API/GitHub/doc/repo logic independently unit-testable without spinning up the CLI parser.
- `session/` is a separate module so the interactive REPL can import directly from `commands/` without the commander layer — each command exports a named `execute*` function that both the commander `.action()` wrapper and the session dispatch table call.
- `docs/` (generated output) is kept separate from the hand-written project docs at repo root, so DeCode's own generated architecture doc never collides with this one.
- The `src/ui/` rendering engine is isolated so presentation can evolve without touching command logic — the audit command is written against it as the reference implementation.

## Interactive Session Design

Running `decode` with no arguments calls `startSession()` in `src/session/session.js`. The session uses Node's built-in `readline` — no inquirer — to avoid TTY assumptions in tests.

Key design decisions:
- **Dispatch table** (`DISPATCH`): maps command strings like `'api list'` to `{ handler, description }`. Single source of truth for `/help` generation.
- **`parseSlashInput(raw)`**: exported pure function; strips leading `/`, splits tokens, detects known subcommand keywords, and produces `{ command, args, opts }`. Tested independently in `test/unit/session.test.js`.
- **Config loaded once** at session start via `readConfig()`. Commands share the result without re-reading disk on each invocation.
- **Error isolation**: each dispatch call is wrapped in `try/catch`; a failing command prints to stderr via `output.error()` and returns control to the prompt without killing the loop.
- **AI agent seam**: non-slash input falls into an intentionally empty branch — the hook for a future streaming AI agent.

## Security & Safety Boundaries
- Any AI-proposed file write (planned assistant, PRD story 5) is restricted to the current working project directory — no arbitrary filesystem or shell access.
- No proposed change is ever written without explicit human approval.
- API keys/tokens are read from environment/config, never hardcoded or committed. Local runtime config is gitignored.

## Testing Strategy
- **Unit tests** cover command parsing, API check logic, route detection, GitHub data transforms, commit-health heuristics, and config read/write / two-tier merge.
- **Integration tests** run the real CLI binary as a subprocess (via `execa`) and assert on stdout/exit codes per command, using hermetic local servers (fake GitHub/LLM/backend) so CI never needs network access.
- **No browser → no Playwright.** DeCode is a CLI, not a web app, so a browser-automation harness would test nothing that exists. Unit (`vitest`) plus execa-driven CLI integration tests fill the equivalent role: they exercise the actual shipped executable end-to-end and gate CI, which is the purpose a browser test would otherwise serve.
- **Hermetic, worktree-safe runs.** `test/setup.js` points `DECODE_GLOBAL_CONFIG_DIR` at a temp dir so tests never touch the real `~/.decode`. `vitest.config.js` excludes the two parallel git worktrees nested in this repo (`.claude/worktrees/`, `.worktrees/`) so the suite runs the main repo only — a bare `npx vitest run` is a clean single command (25 files / 217 tests, no filtering needed).

## CI/CD
GitHub Actions workflow runs on every push: install → lint → unit tests → integration tests. Must be green on the latest commit at submission time.

## Deferred / Roadmap
- Visual trace of agent actions (currently happens via step-by-step terminal output) — a companion visual/GUI trace is a future iteration.
- Region-select visual code editing (currently `--file`/`--lines` targeting) — a true visual selector requires a GUI companion app.

## Doc Index
The top-level, authoritative docs are:
- [`PRD.md`](./PRD.md) — product requirements and acceptance criteria.
- [`AGENTS.md`](./AGENTS.md) — agent rules/constitution for coding agents working on this repo.
- [`AGENTS_AND_SKILLS.md`](./AGENTS_AND_SKILLS.md) — the custom Repo Analyst agent and the API Contract Verifier skill.
- **`COMMAND_STANDARD.md`** — engineering standard for authoring new commands (the style guide that keeps future commands consistent with the reference implementation). This doc is intentionally kept separate; it is a how-to-write-commands guide, not the system architecture.
- [`CHANGELOG.md`](./CHANGELOG.md) and [`TASKS.md`](./TASKS.md) — change history and the agent task log.