import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const API_APP_DIR = path.join(ROOT_DIR, 'apps', 'api');
const OUTPUT_DIR = path.join(ROOT_DIR, 'output', 'tests');
const EXPLICIT_API_URL = String(process.env.QBAPP_E2E_API_URL || '').trim();
const API_AUTH_ENABLED = String(process.env.APP_AUTH_ENABLED || 'false').trim() || 'false';

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isHttpOk(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url, attempts = 80, delayMs = 500) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await isHttpOk(url)) {
      return true;
    }
    await delay(delayMs);
  }
  return false;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT_DIR,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: 'pipe'
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    const stdout = String(result.stdout || '').trim();
    const stderr = String(result.stderr || '').trim();
    const detail = [stdout, stderr].filter(Boolean).join('\n');
    throw new Error(
      `${command} ${args.join(' ')} falhou com status ${result.status}${detail ? `\n${detail}` : ''}`
    );
  }

  if (result.signal) {
    throw new Error(`${command} ${args.join(' ')} interrompido por ${result.signal}`);
  }

  return result;
}

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

function tryAcquirePortLock(port) {
  const lockPath = path.join(OUTPUT_DIR, `api-${port}.lock`);

  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, String(process.pid), 'utf8');
    return {
      fd,
      lockPath
    };
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      return null;
    }
    throw error;
  }
}

function releasePortLock(lock) {
  if (!lock) return;

  try {
    fs.closeSync(lock.fd);
  } catch {}

  try {
    fs.unlinkSync(lock.lockPath);
  } catch {}
}

async function shutdownChild(child) {
  if (!child || child.exitCode != null) return;

  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(3000)
  ]);

  if (child.exitCode == null) {
    child.kill('SIGKILL');
  }
}

async function waitForServerStartup(apiUrl, child) {
  const attempts = 80;
  const delayMs = 200;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await isHttpOk(`${apiUrl}/health`)) return true;
    if (child.exitCode != null) return false;
    await delay(delayMs);
  }
  return false;
}

async function ensureApiServer() {
  if (EXPLICIT_API_URL) {
    const online = await isHttpOk(`${EXPLICIT_API_URL}/health`);
    if (!online) {
      throw new Error(`QBAPP_E2E_API_URL indisponivel em ${EXPLICIT_API_URL}`);
    }
    if (!(await waitForUrl(`${EXPLICIT_API_URL}/production/queue`, 1, 1))) {
      throw new Error(`QBAPP_E2E_API_URL em ${EXPLICIT_API_URL} nao expoe a API esperada.`);
    }
    return {
      apiUrl: EXPLICIT_API_URL,
      shutdown: async () => {}
    };
  }

  runCommand('pnpm', ['--filter', '@querobroapp/api', 'build']);

  for (let port = 3101; port <= 3600; port += 1) {
    const portLock = tryAcquirePortLock(port);
    if (!portLock) continue;

    const apiUrl = `http://127.0.0.1:${port}`;
    if (!(await isPortAvailable(port))) {
      releasePortLock(portLock);
      continue;
    }

    const apiLog = fs.openSync(path.join(OUTPUT_DIR, `api-${port}.log`), 'a');
    const child = spawn('node', ['dist/main.js'], {
      cwd: API_APP_DIR,
      env: {
        ...process.env,
        APP_AUTH_ENABLED: API_AUTH_ENABLED,
        PORT: String(port)
      },
      stdio: ['ignore', apiLog, apiLog]
    });

    try {
      const ready = await waitForServerStartup(apiUrl, child);
      if (!ready) {
        await shutdownChild(child);
        releasePortLock(portLock);
        continue;
      }

      if (!(await isHttpOk(`${apiUrl}/production/queue`))) {
        await shutdownChild(child);
        releasePortLock(portLock);
        continue;
      }

      return {
        apiUrl,
        shutdown: async () => {
          await shutdownChild(child);
          releasePortLock(portLock);
        }
      };
    } catch (error) {
      await shutdownChild(child);
      releasePortLock(portLock);
      continue;
    }
  }

  throw new Error('Nenhuma porta livre encontrada para subir a API temporaria do teste de jornada.');
}

async function request(apiUrl, requestPath, init = {}) {
  const response = await fetch(`${apiUrl}${requestPath}`, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {})
    },
    body: init.body ? JSON.stringify(init.body) : undefined
  });

  const raw = await response.text();
  const body = raw ? JSON.parse(raw) : null;

  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${requestPath} -> ${response.status} ${response.statusText}\n${raw}`);
  }

  return body;
}

async function requestExpectError(apiUrl, requestPath, expectedStatus, init = {}) {
  const response = await fetch(`${apiUrl}${requestPath}`, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {})
    },
    body: init.body ? JSON.stringify(init.body) : undefined
  });

  const raw = await response.text();
  const body = raw ? JSON.parse(raw) : null;

  if (response.status !== expectedStatus) {
    throw new Error(`${init.method || 'GET'} ${requestPath} deveria retornar ${expectedStatus}, mas retornou ${response.status}`);
  }

  return body;
}

export { ensureApiServer, request, requestExpectError };
