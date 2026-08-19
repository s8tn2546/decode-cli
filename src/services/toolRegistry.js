/**
 * src/services/toolRegistry.js
 * Central registry for DeCode tools.
 *
 * Registration is idempotent: re-registering a tool with the same name
 * replaces the previous entry. This keeps tests simple and allows future
 * hot-reloading without duplicate-key errors.
 */

const registry = new Map();

export const Permission = Object.freeze({
  READ_ONLY: 'READ_ONLY',
  WRITE: 'WRITE',
  EXECUTE: 'EXECUTE',
  GIT: 'GIT',
});

/**
 * Register a tool definition. Idempotent.
 * @param {{ name: string, description: string, inputSchema: object, permission: string, execute: function }} tool
 */
export function registerTool(tool) {
  if (!tool || typeof tool.name !== 'string') {
    throw new Error('Tool must have a string name');
  }
  registry.set(tool.name, tool);
}

/**
 * Get a registered tool by name, or null.
 * @param {string} name
 * @returns {{ name: string, description: string, inputSchema: object, permission: string, execute: function }|null}
 */
export function getTool(name) {
  return registry.get(name) || null;
}

/**
 * Check whether a tool is registered.
 * @param {string} name
 * @returns {boolean}
 */
export function hasTool(name) {
  return registry.has(name);
}

/**
 * List all registered tool definitions.
 * @returns {Array<object>}
 */
export function listTools() {
  return Array.from(registry.values());
}

/**
 * Clear all registered tools. Intended for hermetic tests only.
 */
export function clearRegistry() {
  registry.clear();
}
