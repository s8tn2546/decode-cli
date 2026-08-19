/**
 * src/services/tools/gitLog.js
 * Read-only git log tool.
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

export const gitLogTool = {
  name: 'git_log',
  description: 'Get recent git commit history',
  inputSchema: INPUT_SCHEMA,
  permission: Permission.READ_ONLY,
  execute: async (_args, context) => {
    try {
      const log = execSync('git log --oneline -n 20', {
        cwd: context.projectRoot,
        encoding: 'utf8',
        timeout: 10000,
        shell: false,
      });

      return {
        entries: truncateOutput(log || '').split('\n').filter(Boolean),
      };
    } catch (err) {
      throw new Error(err.message || 'git log failed');
    }
  },
};
