import inquirer from 'inquirer';

console.log('Before inquirer - stdin.isTTY:', process.stdin.isTTY);
console.log('Before inquirer - stdin._events:', Object.keys(process.stdin._events || {}));

const answers = await inquirer.prompt([
  {
    type: 'input',
    name: 'test',
    message: 'Test prompt:',
  },
]);

console.log('After inquirer - answers:', answers);
console.log('After inquirer - stdin.isTTY:', process.stdin.isTTY);
console.log('After inquirer - stdin._events:', Object.keys(process.stdin._events || {}));
console.log('After inquirer - stdin._readableState:', process.stdin._readableState?.ended);
