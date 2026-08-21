/**
 * src/commands/init.js
 * `decode init` — interactive setup wizard (PRD story 6, AC1).
 *
 * Prompts for the LLM provider + API key and the GitHub token, then persists
 * via configStore. The user picks the config scope:
 *  - global — written to ~/.decode, applies to every project
 *  - local  — written to this project's decode.config.json
 * Default: on a first-ever run (no global config yet) the wizard defaults to
 * global; once a global setup exists it defaults to local, since repeating
 * setup per-project is the common case.
 *
 * A flag-based, non-interactive path is provided so the wizard is scriptable
 * in CI/integration tests (AGENTS.md rules 5 & 8), plus `--scope` to choose
 * the tier without prompting.
 */
import inquirer from 'inquirer';
import { Command } from 'commander';
import { existsSync } from 'node:fs';

import {
  getGlobalConfigPath,
  saveConnection,
  SCOPE_GLOBAL,
  SCOPE_LOCAL,
} from '../services/configStore.js';
import { withPrompt } from '../ui/ink/promptGuard.js';
import * as ui from '../ui/index.js';
import * as renderer from '../ui/renderer.js';

export async function executeInit(opts) {
  try {
    process.stderr.write('[TRACE] executeInit start\n');
    const scope = await resolveScope(opts);
    process.stderr.write(`[TRACE] scope=${scope}\n`);
    const answers = await gatherCredentials(opts);
    process.stderr.write(`[TRACE] answers=${JSON.stringify(Object.keys(answers))} provider=${answers.llmProvider}\n`);
    saveConnection(
      {
        llmProvider: answers.llmProvider,
        llmApiKey: answers.llmApiKey,
        githubToken: answers.githubToken,
      },
      { scope },
    );
    renderer.render({
      type: 'success',
      command: 'decode init',
      confirmation: `DeCode is configured (${scope}).`,
      suggestion: 'Run `decode status` to verify your connection.',
    });
  } catch (err) {
    renderError(err);
    process.exitCode = 1;
  }
}

/**
 * Render an error screen with a recovery action back to init/status.
 */
function renderError(err) {
  const error = ui.errorPrompt({
    type: 'Init failed',
    explanation: err.message || 'Unable to save the connection configuration.',
    actions: [
      { command: 'decode status', description: 'check the current connection state' },
    ],
  });

  renderer.render({
    type: 'error',
    command: 'decode init',
    error,
  });
}

export function initCommand() {
  return new Command('init')
    .description('Interactive setup wizard — connect your LLM provider and GitHub')
    .option('--llm-provider <name>', 'LLM provider name (skips prompt)')
    .option('--llm-api-key <key>', 'LLM provider API key (skips prompt)')
    .option('--github-token <token>', 'GitHub personal access token (skips prompt)')
    .option('--scope <global|local>', 'Config scope to write to (defaults: global on first run, then local)')
    .action(async (opts) => executeInit(opts));
}

/** Default scope heuristic + optional interactive prompt. */
async function resolveScope(flags) {
  if (flags.scope) {
    if (flags.scope !== SCOPE_GLOBAL && flags.scope !== SCOPE_LOCAL) {
      throw new Error('--scope must be "global" or "local".');
    }
    return flags.scope;
  }
  const globalExists = existsSync(getGlobalConfigPath());
  const defaultScope = globalExists ? SCOPE_LOCAL : SCOPE_GLOBAL;

  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  if (!interactive) return defaultScope;

  const { scope } = await withPrompt(() => inquirer.prompt([
    {
      type: 'list',
      name: 'scope',
      message: 'Where should this configuration apply?',
      default: defaultScope,
      choices: [
        { name: 'Global — all projects on this machine', value: SCOPE_GLOBAL },
        { name: 'Local — this project only', value: SCOPE_LOCAL },
      ],
    },
  ]));
  return scope;
}

/**
 * Returns the connection answers. When all values are supplied via flags the
 * wizard runs non-interactively; otherwise the missing ones are prompted for.
 */
async function gatherCredentials(flags) {
  const resolved = {
    llmProvider: flags.llmProvider,
    llmApiKey: flags.llmApiKey,
    githubToken: flags.githubToken,
  };

  const prompts = [];
  if (!resolved.llmProvider) {
    prompts.push({
      type: 'list',
      name: 'llmProvider',
      message: 'Which LLM provider do you use?',
      choices: ['anthropic', 'openai', 'groq', 'other'],
    });
  }
  if (!resolved.llmApiKey) {
    prompts.push({
      type: 'password',
      name: 'llmApiKey',
      message: 'Paste your LLM provider API key:',
    });
  }
  if (!resolved.githubToken) {
    prompts.push({
      type: 'password',
      name: 'githubToken',
      message: 'Paste your GitHub personal access token (blank to skip):',
    });
  }

  if (prompts.length === 0) return resolved;

  const answers = await withPrompt(() => inquirer.prompt(prompts));
  return { ...resolved, ...answers };
}