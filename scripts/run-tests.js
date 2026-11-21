const { spawn, spawnSync } = require('node:child_process');
const { createWriteStream, mkdirSync, writeFileSync } = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { once } = require('node:events');

const mode = process.argv[2];
if (!['pass', 'fail', 'chaos'].includes(mode)) {
  console.error('Usage: node scripts/run-tests.js pass|fail|chaos');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const k6 = process.env.K6_BIN || 'k6';
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let server;
let serverOutput;
let testProcess;
let output;

function apiReady() {
  return new Promise((resolve) => {
    const request = http.request('http://127.0.0.1:3000/cart/add', { method: 'POST', timeout: 200 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
    request.end();
  });
}

async function startServer() {
  server = spawn(process.execPath, ['server.js'], { cwd: root, windowsHide: true });
  server.stdout.pipe(serverOutput, { end: false });
  server.stderr.pipe(serverOutput, { end: false });
  server.on('error', (error) => console.error(error.message));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error('The API process exited before it was ready');
    if (await apiReady()) return;
    await wait(100);
  }
  throw new Error('The API did not become ready');
}

async function stopServer() {
  if (server && server.exitCode === null && server.signalCode === null) {
    const stopped = once(server, 'close');
    server.kill();
    await stopped;
  }
}

function record(message) {
  output.write(`${message}\n`);
  console.log(message);
}

async function crashAndRestart() {
  await wait(30000);
  record(`CHAOS_STOP_REQUESTED=${new Date().toISOString()}`);
  await stopServer();
  const stoppedAt = Date.now();
  record(`CHAOS_PROCESS_STOPPED=${new Date(stoppedAt).toISOString()}`);
  await wait(10000);
  await startServer();
  const readyAt = Date.now();
  record(`CHAOS_API_READY=${new Date(readyAt).toISOString()}`);
  record(`CHAOS_DOWNTIME_MS=${readyAt - stoppedAt}`);
}

async function run() {
  const portBusy = await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 3000 });
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
  });
  if (portBusy) throw new Error('Port 3000 is already in use; stop that server first');

  mkdirSync(path.join(root, 'results'), { recursive: true });
  mkdirSync(path.join(root, '.runtime'), { recursive: true });
  const version = spawnSync(k6, ['version'], { encoding: 'utf8', windowsHide: true });
  if (version.error || version.status !== 0) throw new Error('k6 was not found; set K6_BIN or add k6 to PATH');
  writeFileSync(path.join(root, 'results', 'environment.txt'), `node --version\n${process.version}\nk6 version\n${version.stdout.trim()}\nplatform=${process.platform}/${process.arch}\n`);

  output = createWriteStream(path.join(root, 'results', `${mode}.txt`));
  serverOutput = createWriteStream(path.join(root, '.runtime', `${mode}-server.log`));
  await startServer();

  const script = mode === 'fail' ? 'slo-test-fail.js' : 'slo-test.js';
  const duration = mode === 'chaos' ? '2m' : '1m';
  const argumentsList = ['run', '--no-color', '--log-format', 'raw', '--log-output', 'stdout', '--summary-export', `results/${mode}-summary.json`, script];
  record(`STARTED_AT=${new Date().toISOString()}`);
  record(`COMMAND=k6 ${argumentsList.join(' ')}`);
  record(`DURATION=${duration}; VUS=20; CHAOS=${mode === 'chaos' ? '1' : '0'}`);

  testProcess = spawn(k6, argumentsList, {
    cwd: root,
    env: { ...process.env, DURATION: duration, CHAOS: mode === 'chaos' ? '1' : '0', K6_NO_USAGE_REPORT: 'true' },
    windowsHide: true,
  });
  testProcess.stdout.on('data', (chunk) => output.write(chunk));
  testProcess.stderr.on('data', (chunk) => output.write(chunk));
  const completed = once(testProcess, 'close');
  const chaos = mode === 'chaos' ? crashAndRestart() : Promise.resolve();
  const [[exitCode]] = await Promise.all([completed, chaos]);
  record(`FINISHED_AT=${new Date().toISOString()}`);
  record(`exit_code=${exitCode}`);
  process.exitCode = exitCode === null ? 1 : exitCode;
}

run().catch((error) => {
  console.error(error.message);
  if (output) record(`RUNNER_ERROR=${error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  if (testProcess && testProcess.exitCode === null && testProcess.signalCode === null) testProcess.kill();
  await stopServer();
  if (serverOutput) serverOutput.end();
  if (output) {
    output.end();
    await once(output, 'finish');
  }
});
