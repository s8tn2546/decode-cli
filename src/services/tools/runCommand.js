/**
 * src/services/tools/runCommand.js
 * Safe shell command execution tool.
 *
 * Only explicitly allowlisted commands may run. Everything else is rejected.
 * Commands execute with cwd = projectRoot and are bounded by a timeout and
 * output limit.
 */

import { spawnSync } from 'node:child_process';
import { Permission } from '../toolRegistry.js';
import { validateCommand, parseCommand } from '../commandSafety.js';

const OUTPUT_LIMIT = 65536;
const COMMAND_TIMEOUT = 30000;

function truncateOutput(raw, limit = OUTPUT_LIMIT) {
  const str = String(raw || '');
  if (str.length <= limit) return str;
  return str.slice(0, limit) + '\n... [output truncated]';
}

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    command: { type: 'string' },
  },
  required: ['command'],
};

export const runCommandTool = {
  name: 'run_command',
  description: 'Run a safe, allowlisted command inside the project (npm test, npm run build, git status, etc.)',
  inputSchema: INPUT_SCHEMA,
  permission: Permission.EXECUTE,
  execute: async (args, context) => {
    const command = String(args.command || '').trim();
    if (!command) {
      throw new Error('Command is required');
    }

    const safety = validateCommand(command);
    if (!safety.valid) {
      throw new Error(safety.reason);
    }

    const { cmd, args: cmdArgs } = parseCommand(command);

    const result = spawnSync(cmd, cmdArgs, {
      cwd: context.projectRoot,
      encoding: 'utf8',
      timeout: COMMAND_TIMEOUT,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const exitCode = result.status != null ? result.status : 1;
    return {
      command,
      exitCode,
      stdout: truncateOutput(result.stdout || ''),
      stderr: truncateOutput(result.stderr || ''),
    };
  },
};
