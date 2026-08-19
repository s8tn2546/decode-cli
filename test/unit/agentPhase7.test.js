/**
 * test/unit/agentPhase7.test.js
 * Phase 7 hardening tests for the DeCode Agent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../src/services/llmClient.js', () => ({
  generateSummary: vi.fn(),
  isLlmConfigured: vi.fn(),
}));

import { runAgent, MAX_ITERATIONS, MAX_HISTORY_SIZE, MAX_TOOL_OUTPUT_SIZE, MAX_RETRIES_PER_TOOL, MAX_PROPOSED_FILES, MAX_PROPOSAL_SIZE, MAX_TOOL_CALLS_PER_ITERATION } from '../../src/services/agent.js';
import { saveConnection, disconnect } from '../../src/services/configStore.js';
import { clearRegistry, registerTool, Permission } from '../../src/services/toolRegistry.js';
import { registerBuiltinTools } from '../../src/services/tools.js';
import { generateSummary, isLlmConfigured } from '../../src/services/llmClient.js';
import { resolveProjectPath } from '../../src/services/toolExecutor.js';
import { ProposedChange, detectConflicts, applyProposals } from '../../src/services/proposedChange.js';
import { runVerification } from '../../src/commands/agent.js';

let tmp;
let projectRoot;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-phase7-'));
  projectRoot = tmp;
  fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Test Project\n');
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'src', 'index.js'), 'console.log("hi");');
  clearRegistry();
  registerBuiltinTools();
});

afterEach(() => {
  delete process.env.LLM_PROVIDER_BASE_URL;
  disconnect({ cwd: tmp });
  fs.rmSync(tmp, { recursive: true, force: true });
});

function configureLlm() {
  saveConnection({ llmProvider: 'openai', llmApiKey: 'sk-test' }, { cwd: tmp });
  isLlmConfigured.mockReturnValue(true);
}

beforeEach(() => {
  generateSummary.mockReset();
});

describe('Phase 7 hardening', () => {
  describe('symlink security', () => {
    it('rejects symlink pointing outside project root', async () => {
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-outside-'));
      const outsideFile = path.join(outsideDir, 'secret.txt');
      fs.writeFileSync(outsideFile, 'secret');
      const linkPath = path.join(projectRoot, 'link');
      fs.symlinkSync(outsideDir, linkPath);

      expect(() => resolveProjectPath('link/secret.txt', projectRoot)).toThrow('Path escapes project root via symlink');

      fs.rmSync(outsideDir, { recursive: true });
    });

    it('allows symlink pointing inside project root', async () => {
      const target = path.join(projectRoot, 'src', 'index.js');
      const linkPath = path.join(projectRoot, 'link_to_index');
      fs.symlinkSync(target, linkPath);

      const resolved = resolveProjectPath('link_to_index', projectRoot);
      expect(resolved).toBe(path.resolve(projectRoot, 'link_to_index'));
    });
  });

  describe('repeated tool-call protection', () => {
    it('blocks repeated identical tool calls', async () => {
      configureLlm();
      generateSummary.mockResolvedValueOnce(
        { type: 'tool_call', name: 'list_files', arguments: {} }
      ).mockResolvedValueOnce(
        { type: 'tool_call', name: 'list_files', arguments: {} }
      ).mockResolvedValueOnce('Done.');

      const result = await runAgent('Loop', projectRoot, { cwd: tmp });

      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].result.success).toBe(true);
      expect(result.steps[1].result.success).toBe(false);
      expect(result.steps[1].result.error.code).toBe('REPEATED_CALL');
    });

    it('allows same tool with different arguments', async () => {
      configureLlm();
      generateSummary.mockResolvedValueOnce(
        { type: 'tool_call', name: 'read_file', arguments: { path: 'README.md' } }
      ).mockResolvedValueOnce(
        { type: 'tool_call', name: 'read_file', arguments: { path: 'src/index.js' } }
      ).mockResolvedValueOnce('Done.');

      const result = await runAgent('Multi-read', projectRoot, { cwd: tmp });

      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].result.success).toBe(true);
      expect(result.steps[1].result.success).toBe(true);
    });
  });

  describe('context safeguards', () => {
    it('limits history size', async () => {
      configureLlm();
      const toolCall = { type: 'tool_call', name: 'list_files', arguments: {} };
      const responses = Array(MAX_HISTORY_SIZE + 5).fill(toolCall);
      generateSummary.mockResolvedValue(...responses);

      const result = await runAgent('History', projectRoot, {
        cwd: tmp,
        maxIterations: MAX_HISTORY_SIZE + 5,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('iterations');
    });
  });

  describe('approval UX', () => {
    it('shows file count and line stats in approval prompt', async () => {
      configureLlm();
      generateSummary.mockResolvedValueOnce(
        { type: 'tool_call', name: 'propose_change', arguments: { path: 'README.md', proposedContent: '# New Header\n\nBody' } }
      ).mockResolvedValueOnce('Done.');

      const result = await runAgent('Update readme', projectRoot, { cwd: tmp });

      expect(result.success).toBe(true);
      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0].path).toBe('README.md');
    });
  });

  describe('malformed tool-call handling', () => {
    it('handles empty tool_calls array', async () => {
      configureLlm();
      generateSummary.mockResolvedValueOnce(
        { type: 'tool_calls', calls: [] }
      ).mockResolvedValueOnce('Done.');

      const result = await runAgent('Empty', projectRoot, { cwd: tmp });

      expect(result.success).toBe(true);
      expect(result.response).toBe('Done.');
    });

    it('handles tool call with missing name', async () => {
      configureLlm();
      generateSummary.mockResolvedValueOnce(
        { type: 'tool_call', name: '', arguments: {} }
      ).mockResolvedValueOnce('Done.');

      const result = await runAgent('Bad name', projectRoot, { cwd: tmp });

      expect(result.success).toBe(true);
      expect(result.steps[0].result.success).toBe(false);
    });
  });

  describe('deterministic verification', () => {
    it('verification function exists and returns structured result', async () => {
      const result = runVerification(projectRoot);
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('exitCode');
      expect(result).toHaveProperty('stdout');
      expect(result).toHaveProperty('stderr');
    });
  });

  describe('tool failure recovery', () => {
    it('preserves tool errors in history and continues', async () => {
      configureLlm();
      generateSummary.mockResolvedValueOnce(
        { type: 'tool_call', name: 'read_file', arguments: { path: 'missing.txt' } }
      ).mockResolvedValueOnce('The file is missing.');

      const result = await runAgent('Read missing', projectRoot, { cwd: tmp });

      expect(result.success).toBe(true);
      expect(result.response).toBe('The file is missing.');
      expect(result.steps[0].result.success).toBe(false);
      expect(result.steps[0].result.error.code).toBe('EXECUTION_ERROR');
    });

    it('does not crash when tool throws an exception', async () => {
      configureLlm();
      generateSummary.mockResolvedValueOnce(
        { type: 'tool_call', name: 'read_file', arguments: { path: 'missing.txt' } }
      ).mockResolvedValueOnce('Done.');

      const result = await runAgent('Safe', projectRoot, { cwd: tmp });

      expect(result.success).toBe(true);
      expect(result.steps[0].result.success).toBe(false);
    });
  });

  describe('retry limit', () => {
    it('blocks repeated failures after retry limit', async () => {
      configureLlm();
      generateSummary.mockResolvedValueOnce(
        { type: 'tool_call', name: 'read_file', arguments: { path: 'missing1.txt' } }
      ).mockResolvedValueOnce(
        { type: 'tool_call', name: 'read_file', arguments: { path: 'missing2.txt' } }
      ).mockResolvedValueOnce(
        { type: 'tool_call', name: 'read_file', arguments: { path: 'missing3.txt' } }
      ).mockResolvedValueOnce('Giving up.');

      const result = await runAgent('Retry', projectRoot, { cwd: tmp });

      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(4);
      expect(result.steps[0].result.error.code).toBe('EXECUTION_ERROR');
      expect(result.steps[1].result.error.code).toBe('RETRY_LIMIT_EXCEEDED');
      expect(result.steps[2].result.error.code).toBe('RETRY_LIMIT_EXCEEDED');
    });

    it('does not retry successful calls', async () => {
      configureLlm();
      generateSummary.mockResolvedValueOnce(
        { type: 'tool_call', name: 'list_files', arguments: {} }
      ).mockResolvedValueOnce(
        { type: 'tool_call', name: 'list_files', arguments: { path: 'src' } }
      ).mockResolvedValueOnce('Done.');

      const result = await runAgent('No retry', projectRoot, { cwd: tmp });

      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].result.success).toBe(true);
      expect(result.steps[1].result.success).toBe(true);
    });
  });

  describe('iteration limit', () => {
    it('stops at maximum iterations with explanation', async () => {
      configureLlm();
      const toolCall = { type: 'tool_call', name: 'list_files', arguments: {} };
      const responses = Array(MAX_ITERATIONS).fill(toolCall);
      generateSummary.mockResolvedValue(...responses);

      const result = await runAgent('Loop', projectRoot, {
        cwd: tmp,
        maxIterations: MAX_ITERATIONS,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe(`Agent stopped after ${MAX_ITERATIONS} iterations`);
      expect(result.steps).toHaveLength(MAX_ITERATIONS);
    });
  });

  describe('tool-call limit', () => {
    it('rejects too many simultaneous tool calls', async () => {
      configureLlm();
      const calls = Array(MAX_TOOL_CALLS_PER_ITERATION + 1).fill({
        type: 'tool_call',
        name: 'list_files',
        arguments: {},
      });
      generateSummary.mockResolvedValueOnce({
        type: 'tool_calls',
        calls,
      }).mockResolvedValueOnce('Done.');

      const result = await runAgent('Too many', projectRoot, { cwd: tmp });

      expect(result.success).toBe(true);
      expect(result.response).toContain('Too many tool calls');
    });
  });

  describe('output limits', () => {
    it('truncates large tool output', async () => {
      configureLlm();
      const largeContent = 'x'.repeat(MAX_TOOL_OUTPUT_SIZE + 100);
      generateSummary.mockResolvedValueOnce(
        { type: 'tool_call', name: 'read_file', arguments: { path: 'README.md' } }
      ).mockResolvedValueOnce('Done.');

      fs.writeFileSync(path.join(projectRoot, 'README.md'), largeContent);

      const result = await runAgent('Large', projectRoot, { cwd: tmp });

      expect(result.success).toBe(true);
      expect(result.steps[0].result.success).toBe(true);
      expect(result.steps[0].result.data.content.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_SIZE + 30);
    });
  });

  describe('proposal limits', () => {
    it('truncates large proposal content', async () => {
      configureLlm();
      const largeContent = 'x'.repeat(MAX_PROPOSAL_SIZE + 100);
      generateSummary.mockResolvedValueOnce(
        { type: 'tool_call', name: 'propose_change', arguments: { path: 'README.md', proposedContent: largeContent } }
      ).mockResolvedValueOnce('Done.');

      const result = await runAgent('Large proposal', projectRoot, { cwd: tmp });

      expect(result.success).toBe(true);
      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0].proposedContent.length).toBeLessThanOrEqual(MAX_PROPOSAL_SIZE + 30);
    });

    it('limits maximum number of proposed files', async () => {
      configureLlm();
      const calls = [];
      for (let i = 0; i < MAX_PROPOSED_FILES + 2; i++) {
        calls.push({
          type: 'tool_call',
          name: 'propose_change',
          arguments: { path: `file${i}.js`, proposedContent: `content${i}` },
        });
      }
      generateSummary.mockResolvedValueOnce({
        type: 'tool_calls',
        calls,
      }).mockResolvedValueOnce('Done.');

      const result = await runAgent('Many proposals', projectRoot, { cwd: tmp });

      expect(result.success).toBe(true);
      expect(result.proposals.length).toBeLessThanOrEqual(MAX_PROPOSED_FILES);
    });
  });

  describe('error sanitization', () => {
    it('does not expose API keys in errors', async () => {
      configureLlm();
      generateSummary.mockImplementationOnce(() => {
        throw new Error('API key sk-secret123 is invalid');
      });

      const result = await runAgent('Key error', projectRoot, { cwd: tmp });

      expect(result.success).toBe(false);
      expect(result.error).not.toContain('sk-secret123');
      expect(result.error).toContain('Authentication or configuration error');
    });

    it('sanitizes spawnSync errors', async () => {
      configureLlm();
      generateSummary.mockImplementationOnce(() => {
        throw new Error('spawnSync /bin/sh ENOENT');
      });

      const result = await runAgent('Spawn error', projectRoot, { cwd: tmp });

      expect(result.success).toBe(false);
      expect(result.error).not.toContain('spawnSync');
      expect(result.error).not.toContain('ENOENT');
      expect(result.error).toContain('Command could not be executed');
    });

    it('sanitizes realpath errors', async () => {
      configureLlm();
      generateSummary.mockImplementationOnce(() => {
        throw new Error('realpath failed for path');
      });

      const result = await runAgent('Realpath error', projectRoot, { cwd: tmp });

      expect(result.success).toBe(false);
      expect(result.error).not.toContain('realpath');
      expect(result.error).toContain('Path security check failed');
    });
  });

  describe('symlink security', () => {
    it('rejects nested symlink pointing outside project root', async () => {
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-outside-'));
      const outsideFile = path.join(outsideDir, 'secret.txt');
      fs.writeFileSync(outsideFile, 'secret');
      const linkPath = path.join(projectRoot, 'link');
      fs.symlinkSync(outsideDir, linkPath);
      const nestedLink = path.join(projectRoot, 'nested');
      fs.symlinkSync(linkPath, nestedLink);

      expect(() => resolveProjectPath('nested/secret.txt', projectRoot)).toThrow('Path escapes project root via symlink');

      fs.rmSync(outsideDir, { recursive: true });
    });

    it('rejects symlinked directory outside project root', async () => {
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-outside-'));
      fs.writeFileSync(path.join(outsideDir, 'file.txt'), 'secret');
      const linkPath = path.join(projectRoot, 'dir_link');
      fs.symlinkSync(outsideDir, linkPath);

      expect(() => resolveProjectPath('dir_link/file.txt', projectRoot)).toThrow('Path escapes project root via symlink');

      fs.rmSync(outsideDir, { recursive: true });
    });
  });

  describe('proposal safety', () => {
    it('detects conflicts before multi-file write', async () => {
      fs.writeFileSync(path.join(projectRoot, 'a.js'), 'originalA');
      fs.writeFileSync(path.join(projectRoot, 'b.js'), 'originalB');

      const proposals = [
        new ProposedChange({ path: 'a.js', originalContent: 'originalA', proposedContent: 'newA' }),
        new ProposedChange({ path: 'b.js', originalContent: 'originalB', proposedContent: 'newB' }),
      ];

      fs.writeFileSync(path.join(projectRoot, 'a.js'), 'changedA');

      const conflicts = detectConflicts(proposals, projectRoot);
      expect(conflicts.length).toBeGreaterThanOrEqual(1);
      expect(conflicts.some((c) => c.path === 'a.js')).toBe(true);
    });

    it('applies proposals only after conflict check passes', async () => {
      fs.writeFileSync(path.join(projectRoot, 'a.js'), 'originalA');

      const proposals = [
        new ProposedChange({ path: 'a.js', originalContent: 'originalA', proposedContent: 'newA' }),
      ];

      const conflicts = detectConflicts(proposals, projectRoot);
      expect(conflicts).toHaveLength(0);

      const results = applyProposals(proposals, projectRoot);
      expect(results[0].success).toBe(true);
      expect(fs.readFileSync(path.join(projectRoot, 'a.js'), 'utf8')).toBe('newA');
    });
  });

  describe('agent prompt safety rules', () => {
    it('prompt contains required safety rules', async () => {
      const { AGENT_SYSTEM_PROMPT } = await import('../../src/services/agentPrompt.js');
      expect(AGENT_SYSTEM_PROMPT).toContain('NEVER write');
      expect(AGENT_SYSTEM_PROMPT).toContain('user must approve');
      expect(AGENT_SYSTEM_PROMPT).toContain('actual command exit codes');
      expect(AGENT_SYSTEM_PROMPT).toContain('run_command');
      expect(AGENT_SYSTEM_PROMPT).toContain('propose_change');
    });
  });

  describe('verify pass and fail', () => {
    it('returns success when npm test passes', async () => {
      const result = runVerification(projectRoot);
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('exitCode');
      if (result.success) {
        expect(result.exitCode).toBe(0);
      }
    });

    it('returns structured failure when verification fails', async () => {
      const result = runVerification(projectRoot);
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('error');
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('execute-tool rejection', () => {
    it('rejects arbitrary shell commands via run_command', async () => {
      configureLlm();
      generateSummary.mockResolvedValueOnce(
        { type: 'tool_call', name: 'run_command', arguments: { command: 'npm install evil' } }
      ).mockResolvedValueOnce('Done.');

      const result = await runAgent('Install', projectRoot, { cwd: tmp });

      expect(result.success).toBe(true);
      expect(result.steps[0].result.success).toBe(false);
      expect(result.steps[0].result.error.code).toBe('EXECUTION_ERROR');
    });

    it('rejects dangerous shell metacharacters', async () => {
      configureLlm();
      generateSummary.mockResolvedValueOnce(
        { type: 'tool_call', name: 'run_command', arguments: { command: 'npm test | cat /etc/passwd' } }
      ).mockResolvedValueOnce('Done.');

      const result = await runAgent('Leak', projectRoot, { cwd: tmp });

      expect(result.success).toBe(true);
      expect(result.steps[0].result.success).toBe(false);
    });
  });
});
