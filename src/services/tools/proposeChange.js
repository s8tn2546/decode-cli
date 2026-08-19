/**
 * src/services/tools/proposeChange.js
 * Read-only proposal tool.
 *
 * This tool does NOT modify files. It reads the current file content and
 * returns a structured proposed change that the command layer can present
 * to the user for approval before any write occurs.
 */

import fs from 'node:fs';
import { resolveProjectPath } from '../toolExecutor.js';

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    proposedContent: { type: 'string' },
  },
  required: ['path', 'proposedContent'],
};

export const proposeChangeTool = {
  name: 'propose_change',
  description: 'Propose creating or modifying a file within the project (requires user approval before writing)',
  inputSchema: INPUT_SCHEMA,
  permission: 'READ_ONLY',
  execute: async (args, context) => {
    const fullPath = resolveProjectPath(args.path, context.projectRoot);
    let originalContent = null;
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        originalContent = fs.readFileSync(fullPath, 'utf8');
      }
    } catch {
      // File does not exist yet — valid for new files.
    }
    return {
      path: args.path,
      originalContent,
      proposedContent: args.proposedContent,
    };
  },
};
