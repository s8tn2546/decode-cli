import React, { useEffect } from 'react';
import { render, Text, Box, useApp } from 'ink';
import inquirer from 'inquirer';

function App({ mode }) {
  const { exit, suspendTerminal } = useApp();
  useEffect(() => {
    (async () => {
      try {
        if (mode === 'single') {
          const both = await suspendTerminal(() => inquirer.prompt([
            { type: 'list', name: 'a', message: 'PICK A', choices: ['a1', 'a2'] },
            { type: 'list', name: 'b', message: 'PICK B', choices: ['b1', 'b2'] },
          ]));
          console.log('ANSWERS=' + JSON.stringify(both));
        } else {
          const a = await suspendTerminal(() => inquirer.prompt([
            { type: 'list', name: 'a', message: 'PICK A', choices: ['a1', 'a2'] },
          ]));
          console.log('ANSWER_A=' + JSON.stringify(a));
          const b = await suspendTerminal(() => inquirer.prompt([
            { type: 'list', name: 'b', message: 'PICK B', choices: ['b1', 'b2'] },
          ]));
          console.log('ANSWER_B=' + JSON.stringify(b));
        }
      } catch (e) {
        console.log('ERR=' + e.stack);
      }
      exit();
    })();
  }, []);
  return <Box><Text>minimal repro ({mode})</Text></Box>;
}

render(<App mode={process.env.MODE || 'single'} />);
