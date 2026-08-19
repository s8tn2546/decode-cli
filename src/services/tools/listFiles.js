/**
 * src/services/tools/listFiles.js
 * Project file listing tool.
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectPath } from '../toolExecutor.js';

const EXCLUDED = new Set(['node_modules', '.git', '.env', 'dist', 'coverage']);

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
  },
  required: [],
};

function walkDir(currentDir, targetPath, entries, depth = 0) {
  if (depth > 2) return entries;
  let names;
  try {
    names = fs.readdirSync(currentDir);
  } catch {
    return entries;
  }
  for (const name of names) {
    if (EXCLUDED.has(name)) continue;
    const full = path.join(currentDir, name);
    try {
      const stat = fs.statSync(full);
      entries.push({ path: path.relative(targetPath, full), type: stat.isDirectory() ? 'directory' : 'file' });
      if (stat.isDirectory()) {
        walkDir(full, targetPath, entries, depth + 1);
      }
    } catch {
      // skip unreadable entries
    }
  }
  return entries;
}

export const listFilesTool = {
  name: 'list_files',
  description: 'List files and directories in the project (excludes node_modules, .git, .env, dist, coverage)',
  inputSchema: INPUT_SCHEMA,
  permission: 'READ_ONLY',
  execute: async (args, context) => {
    const targetPath = args.path ? resolveProjectPath(args.path, context.projectRoot) : context.projectRoot;
    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${args.path || '.'}`);
    }
    const entries = walkDir(targetPath, targetPath, []);
    return { path: args.path || '.', entries };
  },
};
