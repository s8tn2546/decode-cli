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

export function agentCommand() {
  return new Command('agent')
    .description('Run the DeCode Agent to accomplish a goal using available tools')
    .argument('[goal]', 'The goal for the agent to accomplish')
    .option('--json', 'Output machine-readable JSON to stdout')
    .option('--verbose', 'Log the exact outgoing LLM request URL and model')
    .action(async (goal, opts) => executeAgent(goal, opts));
}

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

  output.heading('Proposed changes:');
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
    result = await runAgent(goal, process.cwd(), { verbose: opts.verbose });
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
