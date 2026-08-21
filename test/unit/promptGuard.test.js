import { describe, it, expect, vi } from 'vitest';
import {
  registerPromptGuard,
  withPrompt,
  isInInkSession,
} from '../../src/ui/ink/promptGuard.js';

describe('promptGuard', () => {
  it('delegates withPrompt to registered suspendTerminal', async () => {
    const suspendTerminal = vi.fn(async (fn) => fn());
    registerPromptGuard({ suspendTerminal });

    expect(isInInkSession()).toBe(true);

    const result = await withPrompt(async () => 'done');

    expect(result).toBe('done');
    expect(suspendTerminal).toHaveBeenCalledTimes(1);
  });

  it('runs function directly when suspendTerminal is not registered', async () => {
    registerPromptGuard({ suspendTerminal: null });
    expect(isInInkSession()).toBe(false);

    const result = await withPrompt(async () => 'plain');
    expect(result).toBe('plain');
  });

  it('propagates errors from withPrompt action', async () => {
    const suspendTerminal = vi.fn(async (fn) => fn());
    registerPromptGuard({ suspendTerminal });

    await expect(
      withPrompt(async () => {
        throw new Error('prompt cancelled');
      })
    ).rejects.toThrow('prompt cancelled');
  });

  it('isInInkSession is false before registration (outside Ink)', () => {
    registerPromptGuard({ suspendTerminal: null });
    expect(isInInkSession()).toBe(false);
  });

  it('returns the prompt answers even when suspendTerminal resolves undefined (ink behavior)', async () => {
    // Ink's suspendTerminal(callback) always resolves to undefined — it is an
    // async-dispose API, not a pass-through. withPrompt must still surface the
    // answers captured inside the callback.
    const suspendTerminal = vi.fn(async (fn) => {
      await fn();
      return undefined;
    });
    registerPromptGuard({ suspendTerminal });

    const result = await withPrompt(async () => ({ scope: 'global', llmApiKey: 'k' }));

    expect(result).toEqual({ scope: 'global', llmApiKey: 'k' });
    registerPromptGuard({ suspendTerminal: null });
  });
});
