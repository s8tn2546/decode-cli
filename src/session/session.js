/**
 * src/session/session.js
 * Interactive REPL session — `decode` with no arguments.
 */
import readline from 'readline';
import { readConfig } from '../services/configStore.js';
import * as output from '../utils/output.js';

import { executeApiList, executeApiCheck } from '../commands/api.js';
import {
  executeGithubConnect,
  executeGithubProfile,
  executeGithubAnalyze,
} from '../commands/github.js';
import { executeDoc, executeDocCheck } from '../commands/doc.js';
import { executeAudit } from '../commands/audit.js';
import { executeAsk } from '../commands/ask.js';
import { executeInit } from '../commands/init.js';
import { executeConnect } from '../commands/connect.js';
import { executeDisconnect } from '../commands/disconnect.js';
import { executeStatus } from '../commands/status.js';
import {
  executeConfigList,
  executeConfigSet,
  executeConfigReset,
} from '../commands/config.js';
import { executeAgent } from '../commands/agent.js';

// ---------------------------------------------------------------------------
// Dispatch table
// Each entry: { handler: async (args, opts) => void, description: string }
// ---------------------------------------------------------------------------
const DISPATCH = {
  'api list':         { handler: (_args, opts) => executeApiList(opts),                          description: 'List detected API routes' },
  'api check':        { handler: (args, opts)  => executeApiCheck(args, opts),                   description: 'Health-check routes (optional path filters)' },
  'github connect':   { handler: (_args, opts) => executeGithubConnect(opts),                    description: 'Authenticate with GitHub' },
  'github profile':   { handler: (_args, opts) => executeGithubProfile(opts),                    description: 'Show your GitHub profile summary' },
  'github analyze':   { handler: (args, opts)  => executeGithubAnalyze(args[0], opts),           description: 'Analyze a repository (owner/repo)' },
  'doc':              { handler: (args, opts)  => executeDoc(args[0], opts),                     description: 'Generate documentation' },
  'doc check':        { handler: (_args, opts) => executeDocCheck(opts),                         description: 'Check documentation staleness' },
  'audit':            { handler: (_args, opts) => executeAudit(opts),                            description: 'Run a security / quality audit' },
  'ask':              { handler: (args, opts)  => executeAsk(args[0], opts),                     description: 'Ask the AI assistant a question about your project' },
  'agent':            { handler: (args, opts)  => executeAgent(args[0], opts),                     description: 'Run the DeCode Agent to accomplish a goal' },
  'init':             { handler: (_args, opts) => executeInit(opts),                             description: 'Configure DeCode (LLM key, GitHub token)' },
  'connect':          { handler: (args, opts)  => executeConnect(args[0], opts),                 description: 'Store an LLM API key' },
  'disconnect':       { handler: (_args, opts) => executeDisconnect(opts),                       description: 'Remove stored credentials' },
  'status':           { handler: (_args, opts) => executeStatus(opts),                           description: 'Show current configuration and status' },
  'config list':      { handler: (_args, opts) => executeConfigList(opts),                       description: 'List all config values' },
  'config set':       { handler: (args, opts)  => executeConfigSet(args[0], args[1], opts),      description: 'Set a config key (key value)' },
  'config reset':     { handler: (_args, opts) => executeConfigReset(opts),                      description: 'Reset config to defaults' },
};

// Group → ordered list of dispatch keys for group-level help
const GROUPS = {
  api:      ['api list', 'api check'],
  github:   ['github connect', 'github profile', 'github analyze'],
  doc:      ['doc', 'doc check'],
  config:   ['config list', 'config set', 'config reset'],
};

// ---------------------------------------------------------------------------
// parseSlashInput(raw) — exported for unit testing
// ---------------------------------------------------------------------------
/**
 * Parses a raw REPL line into a command descriptor.
 *
 * Returns null for non-slash input.
 * Returns { command: string, args: string[], opts: {} } for slash input.
 *
 * Rules:
 *  - Strip the leading '/'
 *  - First token is always the top-level command
 *  - If the second token is a known subcommand keyword it becomes part of `command`
 *  - Remaining tokens: --flag / -f  → opts; anything else → args
 */
export function parseSlashInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) return null;

  // Strip leading slash and split
  const tokens = trimmed.slice(1).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const top = tokens[0];

  // Decide whether the second token is a subcommand or a positional/flag
  const subcommandKeywords = new Set([
    'list', 'check', 'connect', 'profile', 'analyze', 'set', 'reset', 'agent',
  ]);
  let command;
  let rest;
  if (tokens.length > 1 && !tokens[1].startsWith('-') && subcommandKeywords.has(tokens[1])) {
    command = `${top} ${tokens[1]}`;
    rest = tokens.slice(2);
  } else {
    command = top;
    rest = tokens.slice(1);
  }

  const args = [];
  const opts = {};
  for (const token of rest) {
    if (token.startsWith('--')) {
      const [key, val] = token.slice(2).split('=');
      opts[key] = val !== undefined ? val : true;
    } else if (token.startsWith('-') && token.length === 2) {
      opts[token.slice(1)] = true;
    } else {
      args.push(token);
    }
  }

  return { command, args, opts };
}

// ---------------------------------------------------------------------------
// Help rendering
// ---------------------------------------------------------------------------
function renderHelp() {
  output.plain('');
  output.heading('DeCode Interactive Session — available commands');
  output.plain('');

  // Group-level entries
  for (const [, keys] of Object.entries(GROUPS)) {
    for (const key of keys) {
      const label = `  /${key}`;
      output.plain(`${label.padEnd(30)} ${DISPATCH[key].description}`);
    }
    output.plain('');
  }

  // Top-level commands that aren't part of a group
  const grouped = new Set(Object.values(GROUPS).flat());
  const solo = Object.entries(DISPATCH).filter(([k]) => !grouped.has(k));
  if (solo.length) {
    for (const [key, { description }] of solo) {
      output.plain(`  /${key.padEnd(26)} ${description}`);
    }
    output.plain('');
  }

  output.dim('  /help                      Show this help');
  output.dim('  /exit                      Exit the session  (also Ctrl+D / Ctrl+C)');
  output.plain('');
}

function renderGroupHelp(group) {
  const keys = GROUPS[group];
  if (!keys) return;
  output.plain('');
  output.heading(`/${group} — subcommands`);
  for (const key of keys) {
    const label = `  /${key}`;
    output.plain(`${label.padEnd(30)} ${DISPATCH[key].description}`);
  }
  output.plain('');
}

// ---------------------------------------------------------------------------
// dispatchCommand — exported so App.jsx can call it directly (Ink path)
// ---------------------------------------------------------------------------
/**
 * Processes one raw input line from the REPL.
 * Returns { type: 'exit' } if the session should terminate, { type: 'ok' } otherwise.
 * Side effects: calls command handlers which write to console.log/console.error.
 */
export async function dispatchCommand(raw, _config) {
  if (!raw) return { type: 'ok' };

  if (raw.startsWith('/')) {
    const parsed = parseSlashInput(raw);
    if (!parsed) {
      output.error('Could not parse command. Type /help for a list.');
      return { type: 'ok' };
    }

    const { command, args, opts } = parsed;

    if (command === 'exit' || command === 'quit') {
      return { type: 'exit' };
    }
    if (command === 'help') {
      renderHelp();
      return { type: 'ok' };
    }
    if (GROUPS[command]) {
      renderGroupHelp(command);
      return { type: 'ok' };
    }

    const entry = DISPATCH[command];
    if (!entry) {
      output.error(`Unknown command: /${command}. Type /help for a list.`);
      return { type: 'ok' };
    }

    try {
      await entry.handler(args, opts);
    } catch (err) {
      output.error(`/${command} failed: ${err.message}`);
    }
    return { type: 'ok' };
  }

  // Non-slash input: AI agent seam (intentionally empty for now)
  return { type: 'ok' };
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------
function printBanner(_config) {
  output.plain('');
  output.heading('DeCode Interactive Session');
  output.dim('  Type /help for commands, /exit to quit, Ctrl+D to quit.');
  output.plain('');
}

// ---------------------------------------------------------------------------
// startReadlineSession — readline-based REPL (internal)
// ---------------------------------------------------------------------------
async function startReadlineSession(config) {
  printBanner(config);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'decode> ',
    terminal: true,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const raw = line.trim();
    const result = await dispatchCommand(raw, config);
    if (result.type === 'exit') {
      rl.close();
      return;
    }
    rl.prompt();
  });

  rl.on('close', () => {
    output.plain('\nGoodbye!');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    rl.close();
  });
}

// ---------------------------------------------------------------------------
// startSession — the public entry point
// ---------------------------------------------------------------------------
export async function startSession() {
  const config = readConfig();

  if (!process.stdout.isTTY) {
    return startReadlineSession(config);
  }

  // TTY path: Ink UI
  // Dynamic imports keep Ink entirely out of the non-TTY code path.
  const { render } = await import('ink');
  const React = (await import('react')).default;
  const { default: App } = await import('../ui/ink/App.jsx');

  render(React.createElement(App, { config }));
}
