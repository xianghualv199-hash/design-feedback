#!/usr/bin/env node
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SSH_KEY = path.join(process.env.HOME, '.ssh', 'serveo');

let sshProcess = null;
let tunnelReady = false;

// Clean up zombie tunnels from previous runs
try { require('child_process').execSync('pkill -f "serveo.net" 2>/dev/null', { stdio:'ignore' }); } catch(e) {}

console.log('');
console.log('  ╔══════════════════════════════╗');
console.log('  ║  设计批注工具 启动中...     ║');
console.log('  ╚══════════════════════════════╝');
console.log('');

// Start server
const server = spawn('node', [path.join(__dirname, 'server.js')], {
  cwd: __dirname,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT) }
});
server.stdout.on('data', d => process.stdout.write(`  ${d}`));
server.stderr.on('data', d => process.stderr.write(`  ${d}`));

function getProjects(cb) {
  http.get(`http://localhost:${PORT}/api/projects`, (res) => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => { try { cb(JSON.parse(d)); } catch(e) { cb([]); } });
  }).on('error', () => cb(null));
}

// Wait for server, then start tunnel
function poll(n) {
  if (n <= 0) return;
  getProjects((projects) => {
    if (projects === null) {
      setTimeout(() => poll(n - 1), 1000);
    } else {
      console.log('  正在建立公网隧道，国内约需 6-30 秒...\n');
      startTunnel();
    }
  });
}

function startTunnel() {
  const ssh = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    '-i', SSH_KEY,
    '-R', 'mihua:80:localhost:' + PORT,
    'serveo.net'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  sshProcess = ssh;

  ssh.stdout.on('data', d => {
    if (tunnelReady) return;
    const text = d.toString();
    const m = text.match(/https:\/\/[a-z0-9-]+\.(?:serveousercontent|serveo)\.com/);
    if (m) {
      tunnelReady = true;
      printStatus(m[0]);
    }
  });
}

function printStatus(url) {
  getProjects((projects) => {
    console.log('');
    console.log('  ╔══════════════════════════════╗');
    console.log('  ║  ✅ 设计批注工具已就绪！    ║');
    console.log('  ╚══════════════════════════════╝');
    console.log('');
    console.log(`  本地管理 : http://localhost:${PORT}`);
    console.log('');
    if (projects && projects.length > 0) {
      projects.forEach((p, i) => {
        const rurl = `${url}/review?token=${p.shareToken}`;
        console.log(`  📋 ${p.clientName} - ${p.title}`);
        console.log(`     发给客户 → ${rurl}`);
      });
    } else {
      console.log('  (暂无项目，打开本地地址上传设计稿)');
    }
    console.log('');
    console.log('  ⚠️  保持此窗口运行，关闭即停止');
    console.log('');
  });
}

function cleanup() {
  if (sshProcess) sshProcess.kill();
  server.kill();
  process.exit();
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

poll(30);
