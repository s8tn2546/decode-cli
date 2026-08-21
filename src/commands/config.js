/**
 * src/commands/config.js
 * `decode config` — view and update configuration (README: list / set / reset).
 *
 * Two-tier model (see configStore): values live in a machine-wide global config
 * (`~/.decode/config.json`) or a project-local one (`decode.config.json`), and
 * local overrides global field-by-field. The subcommands accept `--global` /
 * `--local` to target a tier explicitly; without a flag they target the local
 * project config by default.
 *
 * Secret boundary: this group only ever touches metadata in config files.
 * Actual credentials live in .env and are managed by `decode init` / `connect`
 * / `disconnect` — nothing here reads or writes them beyond reporting presence.
 */
import inquirer from 'inquirer';
import { Command } from 'commander';

import {
  getConfigSummary,
  resetConfig,
  setConfigKey,
  SCOPE_GLOBAL,
  SCOPE_LOCAL,
} from '../services/configStore.js';
import { withPrompt } from '../ui/ink/promptGuard.js';
import * as output from '../utils/output.js';

export function configCommand() {
  return new Command('config')
    .description('View or update configuration (global ~/.decode · local ./decode.config.json)')
    .addCommand(configListCommand())
    .addCommand(configSetCommand())
    .addCommand(configResetCommand());
}

export function executeConfigList(opts) {
  try {
    const summary = getConfigSummary();
    if (opts.json) {
      output.printJson(summary);
      return;
    }
    printHumanSummary(summary);
  } catch (err) {
    output.error(`config list failed: ${err.message}`);
    process.exitCode = 1;
  }
}

function configListCommand() {
  return new Command('list')
    .description('Show the effective configuration and the scope each value came from (no secrets)')
    .option('--json', 'Output machine-readable JSON to stdout')
    .action((opts) => executeConfigList(opts));
}

export function executeConfigSet(key, value, opts) {
  try {
    const scope = opts.global ? SCOPE_GLOBAL : SCOPE_LOCAL;
    setConfigKey(key, value, { scope });
    output.success(`Set ${key} = ${value} (${scope})`);
  } catch (err) {
    output.error(`config set failed: ${err.message}`);
    process.exitCode = 1;
  }
}

function configSetCommand() {
  return new Command('set')
    .description('Set a non-secret config value by dotted path (e.g. llm.provider openai)')
    .argument('<key>', 'Config key path, e.g. "llm.provider"')
    .argument('<value>', 'Value to set')
    .option('--global', 'Write to the machine-wide global config')
    .option('--local', 'Write to the project-local config (default)')
    .action((key, value, opts) => executeConfigSet(key, value, opts));
}

export async function executeConfigReset(opts) {
  try {
    const scope = opts.global ? SCOPE_GLOBAL : SCOPE_LOCAL;
    const scopeLabel = scope === SCOPE_GLOBAL ? 'global' : 'local project';
    if (!opts.yes && !opts.global && !opts.local) {
      // interactive confirmation only when targeting the default scope
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        output.error('Non-interactive terminal — pass `--yes` (and --global/--local) to confirm the reset.');
        process.exitCode = 1;
        return;
      }
      const { confirm } = await withPrompt(() => inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Reset the local decode.config.json to defaults? (stored credentials in .env are kept)',
          default: false,
        },
      ]));
      if (!confirm) {
        output.info('Skipped — configuration was kept.');
        return;
      }
    }
    resetConfig({ scope });
    output.success(`Configuration reset to defaults (${scopeLabel}).`);
    output.dim('Credentials in .env are untouched. Run `decode disconnect` to remove them.');
  } catch (err) {
    output.error(`config reset failed: ${err.message}`);
    process.exitCode = 1;
  }
}

function configResetCommand() {
  return new Command('reset')
    .description('Reset one scope of the config to defaults (credentials in .env are untouched)')
    .option('--global', 'Reset only the global config')
    .option('--local', 'Reset only the project-local config (default)')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (opts) => executeConfigReset(opts));
}

/** Renders the effective config with its per-field source scope. */
function printHumanSummary(summary) {
  const source = (s) => (s === SCOPE_LOCAL ? 'local' : s === SCOPE_GLOBAL ? 'global' : 'default');
  const provider = summary.llm.provider
    ? `${summary.llm.provider} (${source(summary.llm.providerScope)})`
    : '—';

  const lines = [
    `llmProvider: ${provider}`,
    `llmApiKey:   ${summary.llm.configured ? `**** (${source(summary.llm.keyScope)})` : 'not set'}`,
    `githubToken: ${summary.github.configured ? `**** (${source(summary.github.tokenScope)})` : 'not set'}`,
    `routes:      ${summary.routes.length ? `${summary.routes.length} configured` : 'none'}`,
    `Config path: ${summary.configPath}`,
    `Global path: ${summary.globalConfigPath}`,
  ];
  if (summary.updatedAt) lines.push(`Updated:     ${summary.updatedAt}`);

  output.plain(lines.join('\n'));
}