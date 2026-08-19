/**
 * src/services/agent.js
 * DeCode Agent orchestrator — the minimum real agent loop for read-only goals.
 *
 * Responsibilities:
 *  - Convert registered READ_ONLY tool definitions into the provider schema.
 *  - Maintain minimal conversation state across turns.
 *  - Drive the loop: LLM -> tool call -> ToolExecutor -> observation -> LLM.
 *  - Enforce a hard iteration cap to prevent runaway loops.
 *
 * This module does not expose any write/execute/git tools, does not bypass
 * ToolExecutor, and does not execute tools directly.
 */

import { generateSummary, isLlmConfigured } from './llmClient.js';
import { readConfig } from './configStore.js';
import { listTools, getTool, Permission } from './toolRegistry.js';
import { ToolExecutor } from './toolExecutor.js';
import { registerBuiltinTools } from './tools.js';
import { AGENT_SYSTEM_PROMPT } from './agentPrompt.js';
import { ProposedChange } from './proposedChange.js';

export const MAX_ITERATIONS = 10;

let idCounter = 0;

function generateId() {
  idCounter += 1;
  return `call_${Date.now()}_${idCounter}`;
}

/**
 * Convert the current READ_ONLY registry into the provider tool schema.
 * Only READ_ONLY tools are exposed — write/execute/git tools are never sent
 * to the LLM.
 * @returns {Array<object>}
 */
function buildToolSchemas() {
  return listTools()
    .filter((t) => t.permission === Permission.READ_ONLY)
    .map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
}

/**
 * Build the full messages array for a multi-turn conversation.
 *
 * Provider-specific formatting is applied so Anthropic receives tool_result
 * blocks in user messages, while OpenAI-compatible providers receive tool
 * role messages.
 *
 * @param {string} goal
 * @param {Array} history
 * @param {string} provider
 * @returns {Array<{role:string,content:*}>}
 */
function buildMessages(goal, history, provider) {
  const messages = [
    { role: 'system', content: AGENT_SYSTEM_PROMPT },
    { role: 'user', content: `Goal: ${goal}` },
  ];

  for (const step of history) {
    if (step.type === 'proposal') {
      if (provider === 'anthropic') {
        messages.push({
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: step.id,
              name: 'propose_change',
              input: { path: step.path, proposedContent: step.proposedContent },
            },
          ],
        });
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: step.id,
              content: JSON.stringify({
                success: true,
                data: {
                  path: step.path,
                  originalContent: step.originalContent,
                  proposedContent: step.proposedContent,
                },
              }),
            },
          ],
        });
      } else {
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: step.id,
              type: 'function',
              function: {
                name: 'propose_change',
                arguments: JSON.stringify({ path: step.path, proposedContent: step.proposedContent }),
              },
            },
          ],
        });
        messages.push({
          role: 'tool',
          content: JSON.stringify({
            success: true,
            data: {
              path: step.path,
              originalContent: step.originalContent,
              proposedContent: step.proposedContent,
            },
          }),
          tool_call_id: step.id,
        });
      }
    } else if (step.type === 'tool_call') {
      if (provider === 'anthropic') {
        messages.push({
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: step.id,
              name: step.name,
              input: step.arguments,
            },
          ],
        });
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: step.id,
              content: JSON.stringify(step.result),
            },
          ],
        });
      } else {
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: step.id,
              type: 'function',
              function: {
                name: step.name,
                arguments: JSON.stringify(step.arguments),
              },
            },
          ],
        });
        messages.push({
          role: 'tool',
          content: JSON.stringify(step.result),
          tool_call_id: step.id,
        });
      }
    } else if (step.type === 'text') {
      messages.push({ role: 'assistant', content: step.content });
    }
  }

  return messages;
}

/**
 * Extract approved proposals from agent history.
 * @param {Array} history
 * @returns {Array<ProposedChange>}
 */
function extractProposals(history) {
  return history
    .filter((s) => s.type === 'tool_call' && s.name === 'propose_change' && s.result && s.result.success)
    .map((s) => new ProposedChange(s.result.data));
}

/**
 * Run the agent loop for a single user goal.
 *
 * @param {string} goal
 * @param {string} projectRoot
 * @param {{ cwd?: string, fetchImpl?: typeof fetch, maxTokens?: number, verbose?: boolean, maxIterations?: number }} [options={}]
 * @returns {{ success: boolean, response?: string, error?: string, steps: Array, proposals: Array<ProposedChange> }}
 */
export async function runAgent(goal, projectRoot, options = {}) {
  const {
    cwd,
    fetchImpl,
    maxTokens,
    verbose,
    maxIterations = MAX_ITERATIONS,
  } = options;

  if (!goal || typeof goal !== 'string' || !goal.trim()) {
    return { success: false, error: 'A goal is required', steps: [], proposals: [] };
  }

  if (!isLlmConfigured({ cwd })) {
    return {
      success: false,
      error: 'No LLM provider configured. Run `decode init` to connect your LLM provider.',
      steps: [],
      proposals: [],
    };
  }

  registerBuiltinTools();

  const readOnlyTools = listTools().filter((t) => t.permission === Permission.READ_ONLY);
  if (readOnlyTools.length === 0) {
    return { success: false, error: 'No read-only tools available', steps: [], proposals: [] };
  }

  const config = readConfig({ cwd });
  const provider = config.llm.provider || 'other';
  const executor = new ToolExecutor(String(projectRoot || process.cwd()).replace(/\/+$/, ''));
  const history = [];
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration += 1;
    const tools = buildToolSchemas();
    const messages = buildMessages(goal, history, provider);

    try {
      const response = await generateSummary('', {
        cwd,
        fetchImpl,
        maxTokens,
        verbose,
        tools,
        messages,
      });

      if (typeof response === 'string') {
        history.push({ type: 'text', content: response, iteration });
        const proposals = extractProposals(history);
        return { success: true, response, steps: history, proposals };
      }

      if (response && response.type === 'tool_call') {
        const toolName = response.name;
        const toolArgs = response.arguments || {};

        if (!getTool(toolName)) {
          history.push({
            type: 'tool_call',
            id: generateId(),
            name: toolName,
            arguments: toolArgs,
            result: {
              success: false,
              error: { message: `Unknown tool: ${toolName}`, code: 'UNKNOWN_TOOL' },
            },
            iteration,
          });
          continue;
        }

        const result = await executor.execute(toolName, toolArgs, { projectRoot });
        history.push({
          type: 'tool_call',
          id: generateId(),
          name: toolName,
          arguments: toolArgs,
          result,
          iteration,
        });
        continue;
      }

      history.push({ type: 'text', content: '', iteration });
      const proposals = extractProposals(history);
      return { success: true, response: '', steps: history, proposals };
    } catch (err) {
      return { success: false, error: err.message || 'Agent execution failed', steps: history, proposals: [] };
    }
  }

  const proposals = extractProposals(history);
  return { success: false, error: `Agent stopped after ${maxIterations} iterations`, steps: history, proposals };
}
