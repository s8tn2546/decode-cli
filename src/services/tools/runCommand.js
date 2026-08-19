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

const ALLOWED_PREFIXES = [
  'npm test',
  'npm run test',
  'npm run build',
  'npm run lint',
  'npm run dev',
  'node --version',
  'npm --version',
  'git status',
  'git diff',
  'git log',
  'git branch',
  'git remote -v',
];

const DANGEROUS_PATTERNS = [
  /;/, /&&/, /\|\|/, /\|/, /`/, /\$\(/, />/, /</, /rm\b/, /sudo\b/, /chmod\b/, /chown\b/,
  /curl\b/, /wget\b/, /git push\b/, /git reset\b/, /git clean\b/, /npm install\b/,
  /npm uninstall\b/, /yarn add\b/, /pnpm add\b/, /bun install\b/,
];

const OUTPUT_LIMIT = 65536;
const COMMAND_TIMEOUT = 30000;

function truncateOutput(raw, limit = OUTPUT_LIMIT) {
  const str = String(raw || '');
  if (str.length <= limit) return str;
  return str.slice(0, limit) + '\n... [output truncated]';
}

function isAllowedCommand(command) {
  const trimmed = command.trim();
  return ALLOWED_PREFIXES.some((prefix) => trimmed === prefix || trimmed.startsWith(`${prefix} `));
}

function containsDangerousPatterns(command) {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

function parseCommand(command) {
  const trimmed = command.trim();
  const match = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const cmd = match[0] || '';
  const args = match.slice(1).map((arg) => arg.replace(/^"(.*)"$/, '$1'));
  return { cmd, args };
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

    if (!isAllowedCommand(command)) {
      throw new Error(`Command not allowed: ${command}`);
    }

    if (containsDangerousPatterns(command)) {
      throw new Error(`Command contains dangerous patterns: ${command}`);
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
