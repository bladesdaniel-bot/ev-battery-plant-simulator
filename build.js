// Cross-platform build: compile TypeScript, run engine tests, inline the app into dist/index.html
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const tsc = path.join(__dirname, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
const run = cmd => execSync(cmd, { stdio: 'inherit', cwd: __dirname });

run(`"${tsc}" -p .`);
run(`"${tsc}" -p test`);
run('node build/test.js');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
const shell = fs.readFileSync(path.join(__dirname, 'src/index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, 'build/app.js'), 'utf8');
fs.writeFileSync(path.join(__dirname, 'dist/index.html'), shell.replace('<!--APP-->', () => app));
console.log('Built dist/index.html');