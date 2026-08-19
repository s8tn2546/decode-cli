/**
 * src/services/tools/readFile.js
 * Read-only file reader tool.
 */

import fs from 'node:fs';
import { resolveProjectPath } from '../toolExecutor.js';

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
  },
  required: ['path'],
};

export const readFileTool = {
  name: 'read_file',
  description: 'Read the contents of a file within the project',
  inputSchema: INPUT_SCHEMA,
  permission: 'READ_ONLY',
  execute: async (args, context) => {
    const fullPath = resolveProjectPath(args.path, context.projectRoot);
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      throw new Error(`Path is not a file: ${args.path}`);
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    return { path: args.path, content };
  },
};
