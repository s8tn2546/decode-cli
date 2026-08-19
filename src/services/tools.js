/**
 * src/services/tools.js
 * Registers DeCode's built-in read-only tools.
 *
 * Import this module (or call `registerBuiltinTools()`) during app startup
 * so the tool registry is populated before any Agent code runs.
 */

import { registerTool } from './toolRegistry.js';
import { readFileTool } from './tools/readFile.js';
import { listFilesTool } from './tools/listFiles.js';
import { searchFilesTool } from './tools/searchFiles.js';
import { proposeChangeTool } from './tools/proposeChange.js';

export function registerBuiltinTools() {
  registerTool(readFileTool);
  registerTool(listFilesTool);
  registerTool(searchFilesTool);
  registerTool(proposeChangeTool);
}
