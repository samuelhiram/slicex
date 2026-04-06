const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const indexPath = path.resolve(__dirname, '..', 'apps', 'web', 'public', 'index.html');

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const html = fs.readFileSync(indexPath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`static e2e server listening http://localhost:${PORT}`);
  // Run Playwright tests against the running server
  const cmdStr = process.platform === 'win32'
    ? 'pnpm.cmd exec playwright test --config=playwright.local.config.ts'
    : 'pnpm exec playwright test --config=playwright.local.config.ts';
  const runner = spawn(cmdStr, { stdio: 'inherit', shell: true });
  runner.on('exit', (code) => {
    server.close(() => process.exit(code));
  });
});
