/**
 * src/services/tools/gitDiff.js
 * Read-only git diff tool.
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

export const gitDiffTool = {
  name: 'git_diff',
  description: 'Get the current git diff for changed files',
  inputSchema: INPUT_SCHEMA,
  permission: Permission.READ_ONLY,
  execute: async (_args, context) => {
    try {
      const diff = execSync('git diff', {
        cwd: context.projectRoot,
        encoding: 'utf8',
        timeout: 10000,
        shell: false,
      });

      return {
        diff: truncateOutput(diff || ''),
      };
    } catch (err) {
      throw new Error(err.message || 'git diff failed');
    }
  },
};
