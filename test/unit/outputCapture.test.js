import { describe, it, expect, vi } from 'vitest';
import {
  beginOutputCapture,
  endOutputCapture,
  isCapturingOutput,
  pushCapturedOutput,
} from '../../src/ui/ink/outputCapture.js';

describe('outputCapture', () => {
  it('captures lines while active', () => {
    const lines = [];
    beginOutputCapture((line) => lines.push(line));

    expect(isCapturingOutput()).toBe(true);
    pushCapturedOutput('one\ntwo');

    endOutputCapture();
    expect(isCapturingOutput()).toBe(false);
    expect(lines).toEqual(['one', 'two']);
  });

  it('ignores pushes when capture is inactive', () => {
    const onLine = vi.fn();
    pushCapturedOutput('ignored');
    expect(onLine).not.toHaveBeenCalled();
  });
});
