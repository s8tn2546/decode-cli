import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, useApp } from 'ink';
import WelcomeBanner from './WelcomeBanner.jsx';
import MessageLog from './MessageLog.jsx';
import PromptLine from './PromptLine.jsx';
import StatusBar from './StatusBar.jsx';
import { dispatchCommand } from '../../session/session.js';
import { registerPromptGuard } from './promptGuard.js';
import { beginOutputCapture, endOutputCapture } from './outputCapture.js';

function appendCapturedLines(captured, line) {
  captured.push(line);
}

export default function App({ config }) {
  const { exit, suspendTerminal } = useApp();
  const messagesRef = useRef([]);
  const [, forceRender] = useState(0);
  const [showBanner, setShowBanner] = useState(true);
  const outputCaptureRef = useRef(null);
  const cwd = process.cwd();

  useEffect(() => {
    registerPromptGuard({
      suspendTerminal: async (fn) => {
        const capture = outputCaptureRef.current;
        if (capture) {
          console.log = capture.origLog;
          console.error = capture.origErr;
          endOutputCapture();
        }
        try {
          return await suspendTerminal(fn);
        } finally {
          if (capture) {
            console.log = (...args) => capture.captured.push(args.join(' '));
            console.error = (...args) => capture.captured.push(args.join(' '));
            beginOutputCapture((line) => appendCapturedLines(capture.captured, line));
          }
        }
      },
    });
    return () => registerPromptGuard({ suspendTerminal: null });
  }, [suspendTerminal]);

  const handleSubmit = useCallback(async (raw) => {
    if (!raw.trim()) return;

    setShowBanner(false);

    const captured = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args) => captured.push(args.join(' '));
    console.error = (...args) => captured.push(args.join(' '));
    beginOutputCapture((line) => appendCapturedLines(captured, line));
    outputCaptureRef.current = { origLog, origErr, captured };

    let result;
    try {
      result = await dispatchCommand(raw.trim(), config);
    } finally {
      outputCaptureRef.current = null;
      endOutputCapture();
      console.log = origLog;
      console.error = origErr;
    }

    if (captured.length) {
      messagesRef.current = [...messagesRef.current, ...captured];
      forceRender((n) => n + 1);
    }

    if (result?.type === 'exit') {
      exit();
    }
  }, [config, exit]);

  const messages = messagesRef.current;

  return (
    <>
      <MessageLog messages={messages} />
      <Box flexDirection="column">
        {showBanner && <WelcomeBanner config={config} cwd={cwd} />}
        <PromptLine onSubmit={handleSubmit} />
        <StatusBar cwd={cwd} />
      </Box>
    </>
  );
}
