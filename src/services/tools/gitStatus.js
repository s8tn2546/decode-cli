/**
 * src/services/tools/gitStatus.js
 * Read-only git status tool.
 */

import { execSync } from 'node:child_process';
import { Permission } from '../toolRegistry.js';

const OUTPUT_LIMIT = 65536;

function truncateOutput(raw, limit = OUTPUT_LIMIT) {
  const str = String(raw || '');
  if (str.length <= limit) return str;
  return str.slice(0, limit) + '\n... [output truncated]';
}

const INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  required: [],
};

export const gitStatusTool = {
  name: 'git_status',
  description: 'Get the current git repository status (branch, working tree state, changed files)',
  inputSchema: INPUT_SCHEMA,
  permission: Permission.READ_ONLY,
  execute: async (_args, context) => {
    try {
      const branch = execSync('git branch --show-current', {
        cwd: context.projectRoot,
        encoding: 'utf8',
        timeout: 10000,
        shell: false,
      }).trim();

      const status = execSync('git status --short', {
        cwd: context.projectRoot,
        encoding: 'utf8',
        timeout: 10000,
        shell: false,
      });

      return {
        branch: branch || '(detached)',
        changes: truncateOutput(status || '').split('\n').filter(Boolean),
      };
    } catch (err) {
      throw new Error(err.message || 'git status failed');
    }
  },
};
