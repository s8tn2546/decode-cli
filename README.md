# DeCode

AI-powered developer productivity CLI — check your API health, understand your GitHub activity, generate documentation, and run a composite health audit, all from the terminal. (AI-assisted code edits are on the roadmap.)

Built for **Deploy or Die: HowToAlgo x GDGoC KIIT Hackathon** (Track B — Developer Productivity Tools).

## Install

```bash
git clone https://github.com/s8tn2546/decode-cli/
cd decode-cli
npm install
npm run build    # compile src/ → dist/ (required before linking)
sudo npm link   # makes the `decode` command available globally
```

## Quick Start

```bash
decode init      # interactive setup — connect your LLM provider and GitHub
decode status    # confirm everything's connected
decode audit     # run a full check: API health + doc freshness + repo health
```

Prefer to stay in one place? Run `decode` with no arguments and use `/init`, `/status`, `/audit` inside the session instead — see [Interactive Session](#interactive-session) below.

## Interactive Session

Run `decode` with no arguments to drop into a persistent session — no need to type `decode` before every command:

```
╭──────────────────────────────────────────────────────────────╮
│    ██╗██╗    ██╗          |  Tips for getting started         │
│   ██╔╝╚██╗  ██╔╝          |  /help   list all commands        │
│  ██╔╝  ╚██╗██╔╝           |  /exit   quit the session         │
│ ██╔╝   ██╔╝╚██╗           |                                   │
│██╔╝   ██╔╝  ╚██╗          |  What's new                       │
│╚═╝    ╚═╝    ╚═╝          |  • Interactive session UI         │
│                           |                                   │
│DeCode                     |                                   │
│Your Project, Decoded.     |                                   │
│                           |                                   │
│Welcome back!              |                                   │
│~/your-project             |                                   │
│Provider: groq             |                                   │
╰──────────────────────────────────────────────────────────────╯
decode>
 ● session   ? for shortcuts   your-project
```

Inside the session, every command drops the `decode` prefix and starts with `/` instead — `/audit`, `/api list`, `/github profile`, and so on. See the [Commands](#commands) table below for the full slash-command reference. The same commands are also available as `decode <command>` from your regular shell (outside the session) for scripting and CI — both forms run identically.

Type `/help` for the full command list, `/exit` to quit. Non-slash input is reserved for the upcoming AI agent feature.

**Non-TTY / CI fallback:** when stdout isn't a TTY (piped output, CI runners), `decode` automatically falls back to a plain readline session — no figlet banner, no terminal graphics. Scripted and CI usage is unaffected either way.

## Commands

Shown here in slash-command form (used inside the interactive session). Drop the `/` and add `decode` in front to run the same command as a one-shot from your regular shell — e.g. `/audit` inside the session is `decode audit` outside it. Flags and behavior are identical either way.

| Command | Description |
|---|---|
| `decode init` | Interactive setup wizard |
| `decode connect <api-key>` | Store an LLM/API provider key |
| `decode disconnect` | Remove stored credentials |
| `decode status` | Show connection state, which config scope each credential came from, and config paths |
| `decode config list [--json] / set <key> <value> [--global\|--local] / reset [--yes] [--global\|--local]` | View or update configuration (no secrets; `reset` keeps `.env` credentials). Global config at `~/.decode`, local overrides it per-field |
| `decode audit [--ci] [--json]` | Run all core checks together |
| `decode api list [--refresh] [--json]` | Auto-detect backend routes from the project source (Express today); dynamic-segment routes are flagged |
| `decode api check [paths...] [--base-url <url>] [--spec <path\|url>] [--json] [--ci]` | Check detected routes against a live backend (base from `--base-url` / `PORT` / common dev ports); dynamic routes are skipped, not requested |
| `decode github connect` | Authenticate with GitHub (verifies your stored token) |
| `decode github profile` | Show your profile, recently active repos, recent commit history (message · date · files changed), and an AI activity narrative |
| `decode github analyze [repo] [--json]` | Analyze repo activity — commits, contributors, and an AI summary (defaults to current repo) |
| `decode doc [message] [--yes] [--dry-run] [--out <path>]` | Generate project documentation (previewed and approval-gated before writing) |
| `decode doc --explain [instruction]` | Explain the project or a specific part (read-only) |
| `decode doc check [--json]` | Check if docs are stale (exit 1 when stale) |

Run `/help` inside the session, or `decode help` from your shell, for the full list at any time.

## Roadmap

- Natural-language AI code edits — describe a change in plain English, review a proposed diff, approve with `y` before anything is written
- `decode ask` — read-only Q&A about your project

Neither is implemented yet.

## Architecture

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full system design.

## Agents & Skills

See [`AGENTS_AND_SKILLS.md`](./AGENTS_AND_SKILLS.md) for the custom agent and skill built for this project.

## Development

```bash
npm install
npm run dev      # run the CLI against source via tsx (fast local iteration)
npm test         # run the test suite
npm run lint     # lint the codebase
npm run build    # compile src/ → dist/ via esbuild (run before npm link or publish)
```

**Build vs. dev:** `npm run dev` runs the CLI directly from TypeScript source using `tsx` — this is fast and doesn't require a build step. The published/linked `decode` command (`npm link` or `npm install -g`) runs the compiled bundle in `dist/` instead, so `npm run build` must be run once before linking or publishing. The `prepublishOnly` script handles this automatically for `npm publish`.

DeCode is a CLI, not a web app, so it ships no Playwright browser tests. Unit tests (`vitest`) plus execa-driven CLI integration tests exercise the real shipped binary end-to-end instead — the same gate a browser harness would provide, minus the browser. See [`ARCHITECTURE.md`](./ARCHITECTURE.md#testing-strategy).

Tests run hermetically: `test/setup.js` isolates them from your real `~/.decode` config, and `vitest.config.js` excludes the nested git worktrees, so a plain `npm test` covers the main repo only (25 files, 217 tests) — no extra flags needed.

## Contributing

Issues and pull requests are welcome. If you're adding a new framework adapter (FastAPI, Django, NestJS, etc.) for `decode api`, or a new provider for the LLM client, open an issue first so we can align on the interface before you build against it.

## License

MIT
