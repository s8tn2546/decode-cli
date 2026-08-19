# DeCode — Product Requirements Document

## Problem Statement
Developers rely on disconnected tools to answer basic questions about their own projects: is the API healthy, what changed recently and why, is the documentation current, and can they get AI help writing code without leaving the terminal. DeCode unifies these into a single CLI, with every AI-driven action requiring explicit human approval.

## Target User
Individual developers and small teams who want fast, scriptable, CI-friendly checks on their own projects, plus lightweight AI-assisted editing without adopting a full IDE-integrated agent tool.

## User Stories & Acceptance Criteria

### 1. API Health Checking
**As a developer**, I want to check whether my API routes are responding correctly, so I can catch breakages before they reach users.

- **AC1:** `decode api list` auto-detects the backend's routes from the project source (Express today) and flags routes with dynamic segments; results are cached and refreshed with `--refresh`. There is no manual `api add` anymore.
- **AC2:** `decode api check` hits the detected routes against a running backend (base from `--base-url`, the `PORT` in `.env`, or common dev ports) and reports status code, response time, and pass/fail per route. Dynamic-param routes are skipped with an explicit note instead of being guessed.
- **AC3:** If an OpenAPI spec is provided, response shape is validated against it and mismatches are reported.
- **AC4:** `decode api check --json` outputs machine-readable JSON.
- **AC5:** Command exits non-zero if any route fails, so it can gate a CI pipeline.

### 2. GitHub Activity Analysis
**As a developer**, I want a readable summary of recent repo activity, so I can understand what's changed without manually reading every commit.

- **AC1:** `decode github analyze` (no argument) analyzes the current working repo.
- **AC2:** `decode github analyze <repo>` analyzes a specified repo.
- **AC3:** Output includes commit frequency, contributor breakdown, and an AI-generated plain-English summary.
- **AC4:** `decode github profile` shows the authenticated user's own activity/commit record — a recent commit history across their repos (message, date, files changed) and an AI activity narrative grounded in real computed metrics. The commit table remains visible if the LLM call fails.

### 3. Documentation Generation & Freshness
**As a developer**, I want to generate or check documentation for my project, so docs don't silently go stale.

- **AC1:** `decode doc` generates a docs folder with architecture/README-style output based on the current codebase.
- **AC2:** `decode doc <message>` generates documentation guided by the given instruction.
- **AC3:** `decode doc --explain [instruction]` explains the whole project or a specific part in plain English, read-only.
- **AC4:** `decode doc check` reports whether documentation appears stale relative to recent source changes.

### 4. Composite Audit
**As a developer**, I want one command that gives me a full health picture, so I don't have to run multiple checks manually.

- **AC1:** `decode audit` runs API check + doc check + repo health check and returns one combined pass/fail summary.
- **AC2:** `decode audit --ci` returns a CI-friendly exit code reflecting overall pass/fail.

### 4b. Read-Only AI Assistant — **Implemented**
**As a developer**, I want to ask questions about my project and get code suggestions without leaving the terminal, so I can understand and improve the codebase faster.

- **AC1:** `decode ask <question>` answers read-only questions about the current project, grounded in real project context (package.json, directory structure, and relevant file contents).
- **AC2:** `/ask <question>` works inside the interactive session and shares the same underlying logic as the one-shot CLI command.
- **AC3:** The assistant never writes, modifies, or deletes files. When a change is requested, it proposes the exact code in a fenced block with the target file path noted for the human to apply manually.
- **AC4:** `--file <path>` scopes the context to a specific file instead of auto-detecting.
- **AC5:** `--json` produces machine-readable output.
- **AC6:** If the LLM call fails, the command produces a clear error through the existing error-rendering pattern and exits non-zero — it never crashes the session or the CLI.

*(Status: implemented; distinct from and not to be confused with Story 5's full edit-with-approval agent, which remains not started.)*

### 5. AI Assistant (Natural-Language Code Edits) — **Planned, not yet implemented**
**As a developer**, I want to describe a code change in plain English and have the AI propose it, so I can move faster without memorizing a command syntax.

- **AC1:** Any input not matching a known command is routed to the AI assistant.
- **AC2:** The assistant proposes a diff and requires explicit `y/n` approval before writing any file.
- **AC3:** `--file`/`--lines` flags scope the edit to a specific location.
- **AC4:** File operations are restricted to the current project directory only.

*(Status: designed but not built Day 1 — see ARCHITECTURE.md "Planned" and README.md "Roadmap".)*

### 6. Setup & Account Management
**As a new user**, I want a guided setup, so I can start using the tool without reading documentation first.

- **AC1:** `decode init` walks through connecting an LLM provider and GitHub, and writes a config file.
- **AC2:** `decode status` shows current connection state, the config scope in use for each credential, and the last audit result.
- **AC3:** `decode connect`/`disconnect` manage credentials without re-running full setup.
- **AC4 (config scoping):** DeCode supports a machine-wide config (`~/.decode/config.json`) and an optional per-project config (`<project-root>/decode.config.json`); local values override global values **field-by-field**, and anything unset locally falls back to global.
- **AC5 (config scoping):** `decode init` asks whether the setup applies globally (all projects) or to the current project only — defaulting to global on a first-ever run, and to local once a global setup exists.
- **AC6 (config scoping):** `decode config set <key> <value> --global|--local` targets a single tier, `decode config list` labels each value's source (`local` / `global` / `default`), and `decode config reset --global` / `--local` clears only that scope.

## Out of Scope (Day 1)
- Visual flowchart/box representation of agent actions (terminal trace only)
- Visual region-select code editing (line-range targeting only)
- Any hosted/multi-user backend — DeCode runs locally per user

## Success Metrics for This Build
- All 5 hackathon non-negotiable gates pass
- Core commands (`api`, `github`, `doc`, `audit`) fully functional and tested
- CI green on submission
