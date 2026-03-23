import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const API_APP_DIR = path.join(ROOT_DIR, 'apps', 'api');
const API_PRISMA_DIR = path.join(API_APP_DIR, 'prisma');
const API_TEMPLATE_DB_PATH = path.join(API_PRISMA_DIR, 'dev.db');
const OUTPUT_DIR = path.join(ROOT_DIR, 'output', 'tests');
const EXPLICIT_API_URL = String(process.env.QBAPP_E2E_API_URL || '').trim();
const API_AUTH_ENABLED = String(process.env.APP_AUTH_ENABLED || 'false').trim() || 'false';

let buildPromise = null;

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

async function ensureApiBuild() {
  if (!buildPromise) {
    buildPromise = Promise.resolve().then(() => {
      runCommand('pnpm', ['--filter', '@querobroapp/api', 'prisma:generate:dev']);
      runCommand('pnpm', ['--filter', '@querobroapp/api', 'build']);
    });
    buildPromise.catch(() => {
      buildPromise = null;
    });
  }
  await buildPromise;
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

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ESRCH') {
      return false;
    }
    return true;
  }
}

function tryAcquirePortLockOrCleanup(port) {
  const lock = tryAcquirePortLock(port);
  if (lock) return lock;

  const lockPath = path.join(OUTPUT_DIR, `api-${port}.lock`);
  let stalePid = null;
  try {
    stalePid = Number.parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
  } catch {
    return null;
  }

  if (processExists(stalePid)) {
    return null;
  }

  try {
    fs.unlinkSync(lockPath);
  } catch {
    return null;
  }

  return tryAcquirePortLock(port);
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

function removeDatabaseArtifacts(databasePath) {
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      fs.unlinkSync(`${databasePath}${suffix}`);
    } catch {}
  }
}

function prepareTestDatabase(port) {
  const databasePath = path.join(OUTPUT_DIR, `api-${port}.db`);
  removeDatabaseArtifacts(databasePath);
  fs.copyFileSync(API_TEMPLATE_DB_PATH, databasePath);
  const relativePath = path.relative(API_PRISMA_DIR, databasePath).split(path.sep).join('/');
  const databaseUrl = `file:${relativePath.startsWith('.') ? relativePath : `./${relativePath}`}`;
  return {
    databasePath,
    databaseUrl
  };
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

  await ensureApiBuild();

  for (let port = 3101; port <= 3600; port += 1) {
    const portLock = tryAcquirePortLockOrCleanup(port);
    if (!portLock) continue;

    const apiUrl = `http://127.0.0.1:${port}`;
    if (!(await isPortAvailable(port))) {
      releasePortLock(portLock);
      continue;
    }

    const testDatabase = prepareTestDatabase(port);
    const apiLog = fs.openSync(path.join(OUTPUT_DIR, `api-${port}.log`), 'w');
    const child = spawn('node', ['--env-file=.env', 'dist/main.js'], {
      cwd: API_APP_DIR,
      env: {
        ...process.env,
        APP_AUTH_ENABLED: API_AUTH_ENABLED,
        DATABASE_URL: testDatabase.databaseUrl,
        PORT: String(port)
      },
      stdio: ['ignore', apiLog, apiLog]
    });
    fs.closeSync(apiLog);

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
          removeDatabaseArtifacts(testDatabase.databasePath);
        }
      };
    } catch (error) {
      await shutdownChild(child);
      releasePortLock(portLock);
      removeDatabaseArtifacts(testDatabase.databasePath);
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
