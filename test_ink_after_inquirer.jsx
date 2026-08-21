import inquirer from 'inquirer';
import { render } from 'ink';
import React from 'react';
import TextInput from 'ink-text-input';
import { Box } from 'ink';

console.log('=== Before inquirer ===');
console.log('stdin._events:', Object.keys(process.stdin._events || {}));

const answers = await inquirer.prompt([
  {
    type: 'input',
    name: 'test',
    message: 'Test prompt:',
  },
]);

console.log('=== After inquirer ===');
console.log('stdin._events:', Object.keys(process.stdin._events || {}));

console.log('=== Starting Ink ===');

function App() {
  const [value, setValue] = React.useState('');
  
  return (
    <Box>
      <TextInput value={value} onChange={setValue} onSubmit={(v) => { console.log('Submitted:', v); process.exit(0); }} />
    </Box>
  );
}

render(React.createElement(App));

console.log('Ink render called');
