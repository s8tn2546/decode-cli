/**
 * src/services/tools/searchFiles.js
 * Project file search tool.
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectPath } from '../toolExecutor.js';

const EXCLUDED = new Set(['node_modules', '.git', '.env', 'dist', 'coverage']);

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    path: { type: 'string' },
  },
  required: ['query'],
};

export const searchFilesTool = {
  name: 'search_files',
  description: 'Search for files matching a query within the project',
  inputSchema: INPUT_SCHEMA,
  permission: 'READ_ONLY',
  execute: async (args, context) => {
    const query = String(args.query || '').trim();
    if (!query) {
      throw new Error('Search query is required and must not be empty');
    }
    const basePath = args.path ? resolveProjectPath(args.path, context.projectRoot) : context.projectRoot;
    const matches = [];
    const walk = (dir, depth) => {
      if (depth > 2) return;
      let names;
      try {
        names = fs.readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (EXCLUDED.has(name)) continue;
        const full = path.join(dir, name);
        try {
          const stat = fs.statSync(full);
          if (stat.isFile() && name.toLowerCase().includes(query.toLowerCase())) {
            matches.push({ path: path.relative(basePath, full) });
          } else if (stat.isDirectory()) {
            walk(full, depth + 1);
          }
        } catch {
          // skip
        }
      }
    };
    walk(basePath, 0);
    return { query, matches };
  },
};
