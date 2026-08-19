/**
 * src/services/proposedChange.js
 * Proposed change model, unified diff generation, conflict detection,
 * and controlled file application for the DeCode Agent.
 *
 * All writes are gated behind explicit user approval in the command layer.
 * This module contains no approval logic — it only models and applies
 * already-approved changes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectPath } from './toolExecutor.js';

/**
 * @typedef {Object} ProposedChangeData
 * @property {string} path
 * @property {string|null} originalContent
 * @property {string} proposedContent
 */

export class ProposedChange {
  /**
   * @param {ProposedChangeData} data
   */
  constructor({ path, originalContent, proposedContent }) {
    this.path = String(path || '');
    this.originalContent = originalContent ?? null;
    this.proposedContent = String(proposedContent ?? '');
  }

  get hasChanges() {
    return this.originalContent !== this.proposedContent;
  }

  get isNewFile() {
    return this.originalContent === null;
  }
}

/**
 * Generate a minimal unified diff between original and proposed content.
 *
 * @param {string|null} original
 * @param {string} proposed
 * @param {string} filePath
 * @returns {string|null} unified diff or null when there are no changes
 */
export function generateUnifiedDiff(original, proposed, filePath) {
  const originalLines = (original || '').split('\n');
  const proposedLines = proposed.split('\n');

  if (original === null || original === undefined) {
    const lines = ['--- /dev/null', `+++ b/${filePath}`];
    if (proposedLines.length === 0) {
      return lines.join('\n');
    }
    lines.push(`@@ -0,0 +1,${proposedLines.length} @@`);
    for (const line of proposedLines) {
      lines.push(`+${line}`);
    }
    return lines.join('\n');
  }

  if (originalLines.length === 0 && proposedLines.length === 0) {
    return null;
  }

  let prefixLen = 0;
  while (
    prefixLen < originalLines.length &&
    prefixLen < proposedLines.length &&
    originalLines[prefixLen] === proposedLines[prefixLen]
  ) {
    prefixLen++;
  }

  let originalSuffix = 0;
  let proposedSuffix = 0;
  while (
    originalSuffix < originalLines.length - prefixLen &&
    proposedSuffix < proposedLines.length - prefixLen &&
    originalLines[originalLines.length - 1 - originalSuffix] ===
      proposedLines[proposedLines.length - 1 - proposedSuffix]
  ) {
    originalSuffix++;
    proposedSuffix++;
  }

  const originalStart = prefixLen + 1;
  const originalCount = Math.max(0, originalLines.length - prefixLen - originalSuffix);
  const proposedStart = prefixLen + 1;
  const proposedCount = Math.max(0, proposedLines.length - prefixLen - proposedSuffix);

  if (originalCount === 0 && proposedCount === 0) {
    return null;
  }

  const lines = [];
  lines.push(`--- a/${filePath}`);
  lines.push(`+++ b/${filePath}`);
  lines.push(`@@ -${originalStart},${originalCount} +${proposedStart},${proposedCount} @@`);

  for (let i = 0; i < prefixLen; i++) {
    lines.push(` ${originalLines[i]}`);
  }

  for (let i = prefixLen; i < originalLines.length - originalSuffix; i++) {
    lines.push(`-${originalLines[i]}`);
  }

  for (let i = prefixLen; i < proposedLines.length - proposedSuffix; i++) {
    lines.push(`+${proposedLines[i]}`);
  }

  for (let i = originalLines.length - originalSuffix; i < originalLines.length; i++) {
    lines.push(` ${originalLines[i]}`);
  }

  return lines.join('\n');
}

/**
 * Detect conflicts between proposals and current filesystem state.
 *
 * A conflict occurs when:
 * - A tracked file was modified or deleted after the proposal was generated.
 *
 * @param {ProposedChange[]} proposals
 * @param {string} projectRoot
 * @returns {Array<{ path: string, message: string }>}
 */
export function detectConflicts(proposals, projectRoot) {
  const conflicts = [];
  for (const proposal of proposals) {
    if (proposal.originalContent === null) {
      continue;
    }
    const fullPath = resolveProjectPath(proposal.path, projectRoot);
    try {
      const currentContent = fs.readFileSync(fullPath, 'utf8');
      if (currentContent !== proposal.originalContent) {
        conflicts.push({
          path: proposal.path,
          message: `File changed since proposal was generated`,
        });
      }
    } catch {
      conflicts.push({
        path: proposal.path,
        message: `File was deleted since proposal was generated`,
      });
    }
  }
  return conflicts;
}

/**
 * Apply approved proposals to the filesystem.
 *
 * Creates parent directories as needed. Does NOT check for conflicts —
 * call `detectConflicts` first.
 *
 * @param {ProposedChange[]} proposals
 * @param {string} projectRoot
 * @returns {Array<{ path: string, success: boolean, error?: string }>}
 */
export function applyProposals(proposals, projectRoot) {
  const results = [];
  for (const proposal of proposals) {
    try {
      const fullPath = resolveProjectPath(proposal.path, projectRoot);
      const dir = path.dirname(fullPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, proposal.proposedContent, 'utf8');
      results.push({ path: proposal.path, success: true });
    } catch (err) {
      results.push({
        path: proposal.path,
        success: false,
        error: err.message || 'Write failed',
      });
    }
  }
  return results;
}
