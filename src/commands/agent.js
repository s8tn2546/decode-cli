/**
 * src/commands/agent.js
 * `decode agent` — DeCode Agent (PRD story 5, Phase 4 controlled coding implementation).
 *
 * Forms:
 *  - `decode agent <goal>`        run the agent with a goal
 *  - `decode agent --json`        machine-readable output
 *
 * The agent remains read-only while investigating. Proposed changes are only
 * applied after explicit user approval.
 */

import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { Command } from 'commander';
import ora from 'ora';

import { runAgent, MAX_ITERATIONS } from '../services/agent.js';
import {
  generateUnifiedDiff,
  detectConflicts,
  applyProposals,
} from '../services/proposedChange.js';
import * as ui from '../ui/index.js';
import * as renderer from '../ui/renderer.js';
import * as output from '../utils/output.js';

const VERIFY_COMMAND = 'npm test';
const VERIFY_TIMEOUT = 120000;
const VERIFY_OUTPUT_LIMIT = 65536;

export function agentCommand() {
  return new Command('agent')
    .description('Run the DeCode Agent to accomplish a goal using available tools')
    .argument('[goal]', 'The goal for the agent to accomplish')
    .option('--json', 'Output machine-readable JSON to stdout')
    .option('--verbose', 'Log the exact outgoing LLM request URL and model')
    .option('--verify', 'Run verification tests after applying changes')
    .action(async (goal, opts) => executeAgent(goal, opts));
}

export { runVerification };

export async function executeAgent(goal, opts = {}) {
  try {
    const resolvedGoal = await resolveGoal(goal, opts);
    if (!resolvedGoal) return;

    if (opts.json) {
      const result = await runAgent(resolvedGoal, process.cwd(), { verbose: opts.verbose });
      renderer.render(JSON.stringify(result, null, 2));
      return;
    }

    await renderInteractiveAgent(resolvedGoal, opts);
  } catch (err) {
    renderError(err);
    process.exitCode = 1;
  }
}

async function resolveGoal(goal, _opts) {
  if (goal) return goal;
  renderError(new Error('No goal provided. Pass a goal argument: decode agent "your goal"'));
  return null;
}

async function promptForApproval(proposals) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const filePaths = proposals.map((p) => p.path);
  const totalAdditions = proposals.reduce((sum, p) => {
    const diff = generateUnifiedDiff(p.originalContent, p.proposedContent, p.path);
    if (!diff) return sum;
    return sum + diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
  }, 0);
  const totalDeletions = proposals.reduce((sum, p) => {
    const diff = generateUnifiedDiff(p.originalContent, p.proposedContent, p.path);
    if (!diff) return sum;
    return sum + diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
  }, 0);

  output.heading('Proposed changes');
  output.plain('');
  output.dim(`${proposals.length} file(s) changed  |  +${totalAdditions} / -${totalDeletions}`);
  output.plain('');
  output.dim('The following files will be modified:');
  for (const fp of filePaths) {
    output.plain(`  ${fp}`);
  }
  output.plain('');
  output.dim('WARNING: These changes will be written to disk.');
  output.plain('');

  for (const proposal of proposals) {
    const diff = generateUnifiedDiff(proposal.originalContent, proposal.proposedContent, proposal.path);
    if (diff) {
      output.plain(diff);
      output.plain('');
    }
  }

  const answer = await new Promise((resolve) => {
    rl.question('Apply these changes? [y/N] ', resolve);
  });

  rl.close();
  return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
}

async function renderInteractiveAgent(goal, opts) {
  const spinner = process.stdout.isTTY ? ora('Agent working...').start() : null;
  let result;
  try {
    result = await runAgent(goal, process.cwd(), {
      verbose: opts.verbose,
      onProgress: (event) => {
        if (spinner) {
          spinner.text = event.detail || event.type;
        }
      },
    });
  } finally {
    if (spinner) spinner.stop();
  }

  if (!result.success) {
    renderError(new Error(result.error));
    process.exitCode = 1;
    return;
  }

  const proposals = result.proposals || [];
  if (proposals.length > 0) {
    const conflicts = detectConflicts(proposals, process.cwd());
    if (conflicts.length > 0) {
      output.heading('Cannot apply changes');
      output.plain('');
      for (const conflict of conflicts) {
        output.error(`${conflict.path}: ${conflict.message}`);
      }
      output.plain('');
      output.dim('Files changed since the proposal was generated. Refusing to overwrite.');
      process.exitCode = 1;
      return;
    }

    const approved = await promptForApproval(proposals);
    if (!approved) {
      output.heading('Changes cancelled');
      output.dim('No files were modified.');
      process.exitCode = 0;
      return;
    }

    const writeResults = applyProposals(proposals, process.cwd());
    const failed = writeResults.filter((r) => !r.success);
    if (failed.length > 0) {
      output.heading('Write failures');
      for (const fail of failed) {
        output.error(`${fail.path}: ${fail.error}`);
      }
      process.exitCode = 1;
      return;
    }

    output.success(`Applied ${writeResults.length} change(s).`);
    output.plain('');

    if (opts.verify) {
      output.heading('Verifying changes');
      output.plain('');
      const verifySpinner = process.stdout.isTTY ? ora('Running verification...').start() : null;
      let verifyResult;
      try {
        verifyResult = runVerification(process.cwd());
      } finally {
        if (verifySpinner) verifySpinner.stop();
      }

      output.plain('');
      if (verifyResult.success) {
        output.success('Verification passed.');
      } else {
        output.error('Verification failed.');
        output.plain(verifyResult.error || 'Unknown error');
        process.exitCode = 1;
        return;
      }
      output.plain('');
    }
  }

  const answerBlock = ui.panel({
    title: 'Agent Answer',
    content: result.response,
    width: 70,
    borderColor: 'green',
  });

  const meta = [];
  meta.push(`${ui.statusDot('pass')}  ${result.steps.length} step(s)`);
  const toolCalls = result.steps.filter((s) => s.type === 'tool_call');
  meta.push(`${ui.statusDot('pass')}  ${toolCalls.length} tool call(s)`);
  if (proposals.length > 0) {
    meta.push(`${ui.statusDot('pass')}  ${proposals.length} proposed change(s) applied`);
  }

  const content = [answerBlock, '', '', meta.join('\n')].join('\n');

  renderer.render({
    command: 'decode agent',
    context: '— read-only agent',
    content,
  });
}

function renderError(err) {
  const error = ui.errorPrompt({
    type: 'Agent failed',
    explanation: err.message || 'An unexpected error occurred.',
    actions: [
      { command: 'decode status', description: 'check configuration' },
      { command: 'decode init', description: 'connect an LLM provider' },
    ],
  });

  renderer.render({
    type: 'error',
    command: 'decode agent',
    error,
  });
}

function sanitizeError(message) {
  const str = String(message || '');
  if (str.includes('API key') || str.includes('api_key') || str.includes('token')) {
    return 'Authentication or configuration error. Check your LLM provider settings.';
  }
  if (str.includes('ENOENT') || str.includes('spawnSync')) {
    return 'Command could not be executed. Check that the required tool is available.';
  }
  if (str.includes('realpath')) {
    return 'Path security check failed. The requested path may be outside the project.';
  }
  if (str.includes('EACCES') || str.includes('EPERM')) {
    return 'Permission denied. The agent cannot access the requested resource.';
  }
  return str;
}

function truncateOutput(raw, limit = VERIFY_OUTPUT_LIMIT) {
  const str = String(raw || '');
  if (str.length <= limit) return str;
  return str.slice(0, limit) + '\n... [output truncated]';
}

function runVerification(projectRoot) {
  try {
    const result = spawnSync('npm', ['test'], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: VERIFY_TIMEOUT,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const exitCode = result.status != null ? result.status : 1;
    const stdout = truncateOutput(result.stdout || '');
    const stderr = truncateOutput(result.stderr || '');

    if (exitCode === 0) {
      return { success: true, exitCode, stdout, stderr };
    }

    const errorLines = [];
    if (stderr) errorLines.push(stderr.trim());
    if (stdout) errorLines.push(stdout.trim());
    const rawError = errorLines.filter(Boolean).join('\n') || `npm test exited with code ${exitCode}`;
    return {
      success: false,
      exitCode,
      stdout,
      stderr,
      error: sanitizeError(rawError),
    };
  } catch (err) {
    return {
      success: false,
      exitCode: 1,
      error: sanitizeError(err.message || 'Verification command failed'),
    };
  }
}
