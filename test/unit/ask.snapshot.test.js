/**
 * test/unit/ask.snapshot.test.js
 * Snapshot test for the ask screen output.
 * Captures the rendered assistant screen to detect layout regressions.
 */
import { describe, it, expect } from 'vitest';
import * as ui from '../../src/ui/index.js';
import * as renderer from '../../src/ui/renderer.js';

describe('ask screen snapshot', () => {
  it('renders a successful assistant response', () => {
    const answerBlock = ui.panel({
      title: 'Answer',
      content: 'DeCode is a Node.js CLI that auto-detects API routes and checks them against a live backend.',
      width: 70,
      borderColor: 'cyan',
    });

    const meta = [
      `${ui.statusDot('pass')}  3 file(s) in context`,
      `${ui.statusDot('pass')}  12,000 char budget`,
    ].join('\n');

    const content = [answerBlock, '', '', meta].join('\n');

    const snap = renderer.snapshot({
      command: 'decode ask',
      context: '— project assistant',
      content,
    });

    expect(snap).toMatchSnapshot();
  });

  it('renders the warning when no LLM is configured', () => {
    const warning = ui.warningPrompt({
      message: 'No LLM provider configured. Run `decode init` to connect your LLM provider.',
      impact: 'Configure an LLM provider with `decode init` to enable the assistant.',
    });

    const snap = renderer.snapshot({
      command: 'decode ask',
      context: '— project assistant',
      content: warning,
    });

    expect(snap).toMatchSnapshot();
  });
});
