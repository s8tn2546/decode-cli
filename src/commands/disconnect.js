/**
 * src/commands/disconnect.js
 * `decode disconnect` — remove stored credentials (PRD story 6, AC3).
 * Confirms before removing unless `--yes` is passed (scriptable/CI-friendly).
 */
import inquirer from 'inquirer';
import { Command } from 'commander';

import { disconnect, isConfigured } from '../services/configStore.js';
import { withPrompt } from '../ui/ink/promptGuard.js';
import * as output from '../utils/output.js';

export async function executeDisconnect(opts) {
  try {
    if (!isConfigured()) {
      output.info('Nothing to disconnect — no credentials are stored.');
      return;
    }
    if (!opts.yes) {
      const { confirm } = await withPrompt(() => inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Remove all stored credentials?',
          default: false,
        },
      ]));
      if (!confirm) {
        output.info('Aborted — credentials were kept.');
        return;
      }
    }
    disconnect();
    output.success('Credentials removed.');
  } catch (err) {
    output.error(`disconnect failed: ${err.message}`);
    process.exitCode = 1;
  }
}

export function disconnectCommand() {
  return new Command('disconnect')
    .description('Remove stored credentials')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (opts) => executeDisconnect(opts));
}
