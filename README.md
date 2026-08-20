# DeCode

**Your Project, Decoded.**

DeCode is an AI-powered developer productivity CLI that understands your codebase, inspects files and Git state, executes a tightly controlled set of development commands, proposes code changes for human approval, verifies those changes, and can optionally perform a bounded auto-fix loop — all from the terminal.

Built for **Deploy or Die: HowToAlgo x GDGoC KIIT Hackathon** (Track B — Developer Productivity Tools).

---

## ✨ Features

### AI-Powered Agent
- **Natural-language goals** — describe what you want in plain English
- **Multi-tool orchestration** — read files, inspect Git state, run allowlisted commands, propose changes
- **Read-only investigation** — the agent never writes without explicit approval
- **Human approval gate** — proposed diffs are shown and must be confirmed before any disk write
- **Conflict detection** — refuses to overwrite files that changed since the proposal was generated
- **Bounded auto-fix (`--fix`)** — if verification fails, the agent can investigate and propose fixes up to 3 attempts
- **Verification (`--verify`)** — run `npm test` (or any allowlisted command) after applying changes
- **Custom verification timeout (`--verify-timeout`)** — tune how long verification can run
- **Persistent sessions (`--session`, `--resume`)** — save and resume agent conversations
- **Session management (`--list-sessions`, `--delete-session`)** — inspect and clean up saved sessions
- **Structured JSON output (`--json`)** — machine-readable results for scripting and CI
- **Progress & workflow display** — see exactly which tools the agent ran and their status
- **Sanitized errors** — no API keys, tokens, or secrets exposed in output

### Read-Only Assistant (`decode ask`)
- **Project Q&A** — ask questions about your codebase in natural language
- **File-scoped context (`--file`)** — limit the assistant's context to a specific file
- **JSON output (`--json`)** — machine-readable answers

### Project Intelligence
- **Auto-detected API routes (`decode api list`)** — scans Express source to discover routes; dynamic segments are flagged
- **API health checks (`decode api check`)** — tests routes against a live backend with smart base-URL resolution
- **GitHub activity analysis (`decode github`)** — profile, commit history, and AI-generated activity narratives
- **Documentation generation (`decode doc`)** — preview and approve generated docs before writing
- **Documentation staleness checking (`decode doc check`)** — exits non-zero when docs are out of date
- **Composite audit (`decode audit`)** — API health + doc freshness + repo health in one command

### Safety & Security
- **Project-root confinement** — all file operations stay within the project
- **Symlink protection** — prevents escaping the project via symlinks
- **Command allowlisting** — only safe commands can be executed
- **Shell injection protection** — `shell: false` on all subprocess calls
- **Dangerous-pattern rejection** — blocks risky command patterns
- **Explicit write approval** — no silent disk writes
- **Secret hygiene** — API keys and tokens are never logged or persisted in plaintext

### Developer Experience
- **Interactive session** — run `decode` with no arguments for a persistent REPL with slash commands
- **Custom landing screen** — premium terminal UI with grouped command cards
- **Non-TTY fallback** — plain readline session when stdout isn't a TTY (CI-safe)
- **Comprehensive tests** — 406 tests across 39 files (unit + integration via execa)
- **Hermetic CI** — tests never touch your real `~/.decode` config

---

## 🚀 Quick Start

```bash
git clone https://github.com/s8tn2546/decode-cli/
cd decode-cli
npm install
npm run build    # compile src/ → dist/ (required before linking)
npm link         # makes the `decode` command available globally
```

Then configure your LLM provider and (optionally) GitHub:

```bash
decode init      # interactive setup
decode status    # confirm everything's connected
```

---

## Commands

| Command | Description |
|---|---|
| `decode init` | Interactive setup wizard — connect your LLM provider and GitHub |
| `decode connect <api-key>` | Store an LLM/API provider key |
| `decode disconnect` | Remove stored credentials |
| `decode status` | Show connection state and config paths |
| `decode config list [--json]` | View merged configuration (no secrets shown) |
| `decode config set <key> <value> [--global \| --local]` | Update a config value |
| `decode config reset [--yes] [--global \| --local]` | Reset config metadata (keeps `.env` credentials) |
| `decode audit [--ci] [--json]` | Run all core checks: API health + doc freshness + repo health |
| `decode api list [--refresh] [--json]` | Auto-detect backend routes from project source |
| `decode api check [paths...] [--base-url <url>] [--spec <path\|url>] [--json] [--ci]` | Check routes against a live backend |
| `decode github connect` | Authenticate with GitHub |
| `decode github profile` | Show profile, recent repos, commit history, and AI activity narrative |
| `decode github analyze [repo] [--json]` | Analyze repo activity with commit-health heuristics and AI summary |
| `decode doc [message] [--yes] [--dry-run] [--out <path>]` | Generate project documentation (approval-gated) |
| `decode doc --explain [instruction]` | Explain the project or a specific part (read-only) |
| `decode doc check [--json]` | Check if documentation is stale |
| `decode ask [question] [--file <path>] [--json]` | Ask the AI assistant a question about your project (read-only) |
| `decode agent <goal> [--json] [--verbose] [--verify [command]] [--verify-timeout <ms>] [--fix] [--session <id>] [--resume <id>] [--list-sessions] [--delete-session <id>]` | Run the AI agent to accomplish a goal |
| `decode help` | Show the landing screen and command list |

---

## Interactive Session

Run `decode` with no arguments to drop into a persistent session. Every command drops the `decode` prefix and starts with `/` instead — `/audit`, `/api list`, `/github profile`, `/ask`, `/agent`, and so on.

```
decode> /help
decode> /agent "add a health endpoint"
decode> /ask "how does auth work?"
decode> /exit
```

The same commands are also available as `decode <command>` from your regular shell for scripting and CI — both forms run identically.

---

## AI Agent

The `decode agent` command is a multi-turn AI agent that can investigate your project, propose code changes, and optionally verify and auto-fix them.

### Agent Flags

| Flag | Description |
|---|---|
| `--json` | Output machine-readable JSON to stdout |
| `--verbose` | Log the exact outgoing LLM request URL and model |
| `--verify [command]` | Run verification after applying changes (default: `npm test`) |
| `--verify-timeout <ms>` | Verification timeout in milliseconds (default: 120000) |
| `--fix` | Enable bounded auto-fix loop after verification failure |
| `--session <id>` | Create or resume a named agent session |
| `--resume <id>` | Resume a previously saved agent session |
| `--list-sessions` | List saved agent sessions |
| `--delete-session <id>` | Delete a saved agent session |

### How It Works

1. **Investigate** — the agent reads files, inspects Git state, and runs allowlisted commands to understand the project
2. **Propose** — it generates a unified diff for each file change and presents it to you
3. **Approve** — you review the diff and confirm with `y` before anything is written
4. **Apply** — changes are written atomically; conflicts are detected and refused
5. **Verify** — runs `npm test` (or your custom command) to validate the changes
6. **Auto-fix** — with `--fix`, if verification fails, the agent investigates the error and proposes fixes (up to 3 attempts)

### Safety Model

- The agent has **no write tools** exposed to the LLM
- All writes go through the `propose_change` → human approval → `applyProposals` path
- Commands are executed with `shell: false` and validated against an allowlist
- Dangerous patterns are rejected before execution
- All file operations are confined to the project root
- Symlinks that escape the project are blocked

### Example

```bash
# One-shot agent run with verification and auto-fix
decode agent "add a GET /health endpoint" --verify --fix

# Resume a previous session
decode agent "finish the health endpoint" --resume session_123

# List saved sessions
decode agent --list-sessions

# JSON output for scripting
decode agent "add error handling" --json
```

---

## Read-Only Assistant

`decode ask` is a lightweight, read-only AI assistant. It assembles project context (file tree, key source files, dependencies) and answers your question without modifying anything.

```bash
decode ask "how does authentication work?"
decode ask "explain the API layer" --file src/api/routes.js
decode ask "what's missing from the README?" --json
```

---

## Architecture

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full system design.

## Agents & Skills

See [`AGENTS_AND_SKILLS.md`](./AGENTS_AND_SKILLS.md) for the custom Repo Analyst agent and API Contract Verifier / Doc Generator skills.

## Development

```bash
npm install
npm run dev      # run the CLI against source via tsx (fast local iteration)
npm test         # run the test suite (406 tests)
npm run lint     # lint the codebase
npm run build    # compile src/ → dist/ via esbuild
```

**Build vs. dev:** `npm run dev` runs the CLI directly from source using `tsx` — fast iteration without a build step. The published/linked `decode` command (`npm link` or `npm install -g`) runs the compiled bundle in `dist/`, so `npm run build` must be run once before linking or publishing.

## Testing

DeCode is a CLI, not a web app, so it ships no Playwright browser tests. Instead, it uses:

- **Unit tests** (`vitest`) covering services, tools, sessions, and command logic
- **CLI integration tests** (`execa`) that run the real binary and assert on stdout/exit codes
- **Hermetic test isolation** — `test/setup.js` redirects config to temp directories so tests never touch your real `~/.decode`

```bash
npm test         # run all tests
npm run test:watch  # watch mode
```

---

## Contributing

Issues and pull requests are welcome. If you're adding a new framework adapter (FastAPI, Django, NestJS, etc.) for `decode api`, or a new provider for the LLM client, open an issue first so we can align on the interface.

## License

MIT
