/**
 * src/services/toolExecutor.js
 * Central tool execution boundary for the DeCode Agent.
 *
 * Responsibilities:
 *  - Look up the requested tool in the registry.
 *  - Validate arguments against the tool's input schema.
 *  - Enforce the tool's permission classification.
 *  - Execute the tool inside a try/catch so failures never crash the CLI.
 *  - Return a structured result or a structured error.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getTool, hasTool, Permission } from './toolRegistry.js';

/**
 * @typedef {success: true, data: *} SuccessResult
 * @typedef {success: false, error: { message: string, code: string }} ErrorResult
 * @typedef {SuccessResult|ErrorResult} ToolResult
 */

/**
 * Wrap a successful tool execution.
 * @param {*} data
 * @returns {SuccessResult}
 */
export function successResult(data) {
  return { success: true, data };
}

/**
 * Wrap a failed tool execution.
 * @param {string} message
 * @param {string} code
 * @returns {ErrorResult}
 */
export function errorResult(message, code) {
  return { success: false, error: { message: String(message || 'Unknown error'), code: String(code || 'ERROR') } };
}

/**
 * Minimal argument validation against a JSON-Schema-like shape.
 *
 * Supports:
 *  - `required`: array of string keys that must be present.
 *  - `properties`: map of key → { type } for basic type checking.
 *
 * Does not pull in a JSON Schema validator to keep dependencies minimal.
 *
 * @param {{ required?: string[], properties?: object }} schema
 * @param {object} args
 * @returns {{ valid: boolean, message?: string }}
 */
export function validateArgs(schema = {}, args = {}) {
  if (schema.required) {
    for (const key of schema.required) {
      if (!(key in args)) {
        return { valid: false, message: `Missing required argument: ${key}` };
      }
    }
  }

  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (!(key in args)) continue;
      const value = args[key];
      if (prop.type === 'string' && typeof value !== 'string') {
        return { valid: false, message: `Argument "${key}" must be a string` };
      }
      if (prop.type === 'boolean' && typeof value !== 'boolean') {
        return { valid: false, message: `Argument "${key}" must be a boolean` };
      }
      if (prop.type === 'number' && typeof value !== 'number') {
        return { valid: false, message: `Argument "${key}" must be a number` };
      }
    }
  }

  return { valid: true };
}

/**
 * Resolve a user-supplied relative path against the project root and
 * assert that the resolved path remains inside the root.
 *
 * Security:
 *  - Rejects absolute paths outside the project root.
 *  - Rejects `../` traversal that escapes the root.
 *  - Normalizes trailing slashes so prefix checks are reliable.
 *
 * @param {string} relPath
 * @param {string} projectRoot
 * @returns {string} resolved absolute path
 */
export function resolveProjectPath(relPath, projectRoot) {
  const root = String(projectRoot || process.cwd()).replace(/\/+$/, '');
  const resolved = path.resolve(root, relPath);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('Path escapes project root');
  }
  return resolved;
}

const DEFAULT_EXCLUDED = new Set(['node_modules', '.git', '.env', 'dist', 'coverage']);

/**
 * Read a directory, filtering out excluded names.
 * @param {string} dir
 * @param {Set<string>} [excluded]
 * @returns {Array<{ name: string, type: 'file'|'directory' }>}
 */
function readDirSafe(dir, excluded = DEFAULT_EXCLUDED) {
  const entries = [];
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return entries;
  }
  for (const name of names) {
    if (excluded.has(name)) continue;
    const full = path.join(dir, name);
    try {
      const stat = fs.statSync(full);
      entries.push({ name, type: stat.isDirectory() ? 'directory' : 'file' });
    } catch {
      // skip unreadable entries
    }
  }
  return entries;
}

/**
 * Central tool executor.
 *
 * @param {string} projectRoot
 */
export class ToolExecutor {
  #projectRoot;

  constructor(projectRoot) {
    this.#projectRoot = String(projectRoot || process.cwd()).replace(/\/+$/, '');
  }

  /**
   * Execute a tool by name.
   *
   * @param {string} name
   * @param {object} [args={}]
   * @param {{ cwd?: string }} [context={}]
   * @returns {ToolResult}
   */
  async execute(name, args = {}, context = {}) {
    if (!hasTool(name)) {
      return errorResult(`Unknown tool: ${name}`, 'UNKNOWN_TOOL');
    }

    const tool = getTool(name);

    if (
      tool.permission !== Permission.READ_ONLY &&
      tool.permission !== Permission.EXECUTE &&
      tool.permission !== Permission.GIT
    ) {
      return errorResult(`Tool "${name}" is not available in this phase`, 'PERMISSION_DENIED');
    }

    const validation = validateArgs(tool.inputSchema, args);
    if (!validation.valid) {
      return errorResult(validation.message, 'VALIDATION_ERROR');
    }

    try {
      const result = await tool.execute(args, {
        ...context,
        projectRoot: this.#projectRoot,
      });
      return successResult(result);
    } catch (err) {
      return errorResult(err.message || 'Tool execution failed', 'EXECUTION_ERROR');
    }
  }
}
