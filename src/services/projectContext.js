/**
 * src/services/projectContext.js
 * Assembles a bounded PROJECT_CONTEXT object for the AI assistant.
 *
 * Design:
 * - Reuses projectScanner's walkFiles so traversal rules stay in one place.
 * - Prioritizes files explicitly named in the question (or via --file).
 * - Caps total context size with PROJECT_CONTEXT_BUDGET; truncation removes
 *   whole files, never mid-file.
 * - Returns a plain object so callers and tests can inspect exactly what was
 *   included.
 */

import fs from 'node:fs';
import path from 'node:path';

export const PROJECT_CONTEXT_BUDGET = 12000;

/**
 * Build a project context object for the given question.
 *
 * @param {{ question?: string, file?: string, cwd?: string }} options
 * @returns {{ structure: string, dependencies: object, files: Array<{ path: string, content: string }>, truncated: boolean, omittedFiles: string[] }}
 */
export function buildProjectContext({ question = '', file, cwd } = {}) {
  const root = cwd || process.cwd();
  const normalizedQuestion = question.toLowerCase();
  const mentionedFiles = extractMentionedFiles(normalizedQuestion);
  const targetFile = file ? path.resolve(root, file) : (mentionedFiles[0] || null);

  const packageInfo = readPackageInfo(root);
  const tree = buildDirectoryTree(root);
  const candidateFiles = collectCandidateFiles(root, targetFile, mentionedFiles);

  const contextFiles = [];
  const omittedFiles = [];
  let totalBytes = 0;

  for (const relPath of candidateFiles) {
    const fullPath = path.join(root, relPath);
    const content = readFileContent(fullPath);
    if (content === null) continue;

    const fileBytes = content.length;
    if (totalBytes + fileBytes > PROJECT_CONTEXT_BUDGET) {
      omittedFiles.push(relPath);
      continue;
    }

    totalBytes += fileBytes;
    contextFiles.push({ path: relPath, content });
  }

  return {
    structure: tree,
    dependencies: packageInfo.dependencies,
    files: contextFiles,
    truncated: omittedFiles.length > 0,
    omittedFiles,
  };
}

/**
 * Extract filenames mentioned in the question (e.g. "src/index.js", "README.md").
 */
function extractMentionedFiles(question) {
  const matches = [];
  const regex = /[a-zA-Z0-9_\-./]+\.(js|mjs|cjs|json|md|ts|tsx|jsx|py|rb|go|rs|toml|yaml|yml)/g;
  let m;
  while ((m = regex.exec(question)) !== null) {
    matches.push(m[0]);
  }
  return matches;
}

/**
 * Read package.json dependencies (dependencies + devDependencies).
 */
function readPackageInfo(root) {
  const pkgPath = path.join(root, 'package.json');
  try {
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw);
    return {
      name: pkg.name || null,
      version: pkg.version || null,
      dependencies: { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) },
    };
  } catch {
    return { name: null, version: null, dependencies: {} };
  }
}

/**
 * Build a top-level directory tree string (first 2 levels).
 */
function buildDirectoryTree(root) {
  const entries = [];
  try {
    const names = fs.readdirSync(root).sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      const full = path.join(root, name);
      const stat = fs.statSync(full);
      if (name === 'node_modules' || name === '.git' || name === 'docs') continue;
      entries.push(stat.isDirectory() ? `${name}/` : name);
      if (stat.isDirectory() && name !== 'node_modules') {
        try {
          const children = fs.readdirSync(full).sort((a, b) => a.localeCompare(b));
          for (const child of children) {
            if (child === '.env') continue;
            entries.push(`  ${child}`);
          }
        } catch {
          // unreadable subdirectory — skip
        }
      }
    }
  } catch {
    // unreadable root — return empty tree
  }
  return entries.join('\n');
}

/**
 * Collect candidate files, prioritizing targetFile and mentioned files.
 * Falls back to README.md + top-level source files when nothing specific
 * is targeted.
 */
function collectCandidateFiles(root, targetFile, mentionedFiles) {
  const files = new Set();

  if (targetFile) {
    const rel = path.relative(root, targetFile);
    files.add(rel);
  }

  for (const mf of mentionedFiles) {
    const resolved = path.resolve(root, mf);
    if (resolved.startsWith(root)) {
      files.add(path.relative(root, resolved));
    }
  }

  const hasSpecificTarget = targetFile || mentionedFiles.length > 0;

  const topLevel = ['README.md'];
  for (const name of topLevel) {
    if (fs.existsSync(path.join(root, name))) files.add(name);
  }

  if (!hasSpecificTarget) {
    try {
      const names = fs.readdirSync(root).sort((a, b) => a.localeCompare(b));
      for (const name of names) {
        const full = path.join(root, name);
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        const ext = path.extname(name);
        if (name === 'README.md' || /\.(js|mjs|cjs|json|md|ts)$/.test(ext)) {
          files.add(name);
        }
      }
    } catch {
      // unreadable root
    }
  }

  return Array.from(files);
}

/**
 * Read a file's content, returning null on failure.
 */
function readFileContent(fullPath) {
  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return null;
    if (stat.size > 50000) return null;
    return fs.readFileSync(fullPath, 'utf8');
  } catch {
    return null;
  }
}
