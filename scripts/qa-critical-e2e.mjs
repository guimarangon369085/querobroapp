import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = process.env.QA_CRITICAL_E2E_OUTPUT_DIR || path.join(ROOT_DIR, 'output', 'playwright');
const API_PORT = Number(process.env.QA_CRITICAL_E2E_API_PORT || 3001);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const DEFAULT_TEMP_WEB_PORT = Number(process.env.QA_CRITICAL_E2E_WEB_PORT || 3100);
const TEMP_WEB_DIST_DIR = String(process.env.QA_CRITICAL_E2E_WEB_DIST_DIR || '.next-qa-critical-e2e').trim();
const SESSION_NAME = process.env.PLAYWRIGHT_CLI_SESSION || 'qa_critical_e2e';
const CODEX_HOME = process.env.CODEX_HOME || path.join(process.env.HOME || '', '.codex');
const PWCLI = path.join(CODEX_HOME, 'skills', 'playwright', 'scripts', 'playwright_cli.sh');
const PLAYWRIGHT_DIR = path.join(ROOT_DIR, '.playwright-cli');
const WEB_APP_DIR = path.join(ROOT_DIR, 'apps', 'web');
const API_AUTH_ENABLED = String(process.env.APP_AUTH_ENABLED || 'false').trim() || 'false';

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

let apiChild = null;
let webChild = null;
let webUrl = '';

function log(message) {
  console.log(message);
}

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
  for (let index = 0; index < attempts; index += 1) {
    if (await isHttpOk(url)) {
      return true;
    }
    await delay(delayMs);
  }
  return false;
}

async function isApiCompatible() {
  try {
    const response = await fetch(`${API_URL}/production/queue`);
    if (!response.ok) {
      return false;
    }

    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : null;
    return Boolean(data) && typeof data === 'object' && Array.isArray(data.queue) && Array.isArray(data.recentBatches);
  } catch {
    return false;
  }
}

function runCommand(label, command, args, options = {}) {
  log(`[qa-critical-e2e] ${label}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT_DIR,
    env: options.env || process.env,
    stdio: options.stdio || 'inherit',
    encoding: options.encoding || 'utf8'
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} falhou com status ${result.status}`);
  }

  if (result.signal) {
    throw new Error(`${command} ${args.join(' ')} interrompido por ${result.signal}`);
  }

  return result;
}

function listListeningPids(port) {
  const result = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8'
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && ![0, 1].includes(result.status)) {
    throw new Error(`Falha ao consultar processos em escuta na porta ${port}.`);
  }

  return String(result.stdout || '')
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => /^\d+$/.test(entry))
    .map((entry) => Number(entry));
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

async function resolveTempWebPort() {
  const candidates = [DEFAULT_TEMP_WEB_PORT, 3200, 3300, 3400];
  for (const candidate of candidates) {
    if (await isPortAvailable(candidate)) return candidate;
  }
  throw new Error('Nenhuma porta livre encontrada para subir o web temporario do E2E.');
}

async function stopProcessOnPort(port) {
  const pids = listListeningPids(port);
  if (pids.length === 0) {
    return;
  }

  log(`[qa-critical-e2e] Encerrando processo(s) stale na porta ${port}: ${pids.join(', ')}`);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
        throw error;
      }
    }
  }

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    if (await isPortAvailable(port)) {
      return;
    }
    await delay(250);
  }

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
        throw error;
      }
    }
  }

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    if (await isPortAvailable(port)) {
      return;
    }
    await delay(250);
  }

  throw new Error(`Nao foi possivel liberar a porta ${port} para reiniciar a API.`);
}

async function ensureApiServer() {
  if ((await isHttpOk(`${API_URL}/health`)) && (await isApiCompatible())) {
    log(`[qa-critical-e2e] Usando API existente em ${API_URL}`);
    return;
  }

  if (await isHttpOk(`${API_URL}/health`)) {
    await stopProcessOnPort(API_PORT);
  }

  runCommand('Build da API', 'pnpm', ['--filter', '@querobroapp/api', 'build']);

  log(`[qa-critical-e2e] Iniciando API temporaria em ${API_URL}`);
  const apiLog = fs.openSync(path.join(OUTPUT_DIR, 'qa-critical-e2e-api.log'), 'a');
  apiChild = spawn('node', ['dist/main.js'], {
    cwd: path.join(ROOT_DIR, 'apps', 'api'),
    env: {
      ...process.env,
      APP_AUTH_ENABLED: API_AUTH_ENABLED,
      PORT: String(API_PORT)
    },
    stdio: ['ignore', apiLog, apiLog]
  });

  const ready = await waitForUrl(`${API_URL}/health`);
  if (!ready) {
    throw new Error(`API nao ficou disponivel em ${API_URL}.`);
  }
  if (!(await isApiCompatible())) {
    throw new Error(`API iniciada em ${API_URL} nao expoe /production/queue como esperado.`);
  }
}

async function ensureWebServer() {
  if (!TEMP_WEB_DIST_DIR) {
    throw new Error('QA_CRITICAL_E2E_WEB_DIST_DIR vazio.');
  }

  const resolvedDistDir = path.resolve(WEB_APP_DIR, TEMP_WEB_DIST_DIR);
  if (!resolvedDistDir.startsWith(`${WEB_APP_DIR}${path.sep}`)) {
    throw new Error(`Dist dir temporario invalido para o web: ${TEMP_WEB_DIST_DIR}`);
  }

  fs.rmSync(resolvedDistDir, { recursive: true, force: true });

  runCommand('Build do web', 'pnpm', ['--filter', '@querobroapp/web', 'build'], {
    env: {
      ...process.env,
      NEXT_DIST_DIR: TEMP_WEB_DIST_DIR
    }
  });

  const port = await resolveTempWebPort();
  webUrl = `http://127.0.0.1:${port}`;
  log(`[qa-critical-e2e] Iniciando web temporario em ${webUrl}`);

  const webLog = fs.openSync(path.join(OUTPUT_DIR, 'qa-critical-e2e-web.log'), 'a');
  webChild = spawn('pnpm', ['exec', 'next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: WEB_APP_DIR,
    env: {
      ...process.env,
      NEXT_DIST_DIR: TEMP_WEB_DIST_DIR
    },
    stdio: ['ignore', webLog, webLog]
  });

  const ready = await waitForUrl(`${webUrl}/pedidos`);
  if (!ready) {
    throw new Error(`Web nao ficou disponivel em ${webUrl}.`);
  }
}

function latestPlaywrightLog(prefix) {
  if (!fs.existsSync(PLAYWRIGHT_DIR)) return null;
  const files = fs
    .readdirSync(PLAYWRIGHT_DIR)
    .filter((entry) => entry.startsWith(`${prefix}-`) && entry.endsWith('.log'))
    .map((entry) => path.join(PLAYWRIGHT_DIR, entry))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  return files[0] || null;
}

function pwArgs(args) {
  return args.filter((entry) => entry != null).map((entry) => String(entry));
}

function pw(command, ...args) {
  return runCommand(`Playwright: ${command}`, PWCLI, pwArgs([command, ...args]), {
    env: {
      ...process.env,
      PLAYWRIGHT_CLI_SESSION: SESSION_NAME
    },
    stdio: 'pipe'
  });
}

function pwRun(code, label) {
  const wrapped = `async () => { ${code} }`;
  const result = runCommand(`Playwright script: ${label}`, PWCLI, ['run-code', wrapped], {
    env: {
      ...process.env,
      PLAYWRIGHT_CLI_SESSION: SESSION_NAME
    },
    stdio: 'pipe'
  });

  const stdout = result.stdout || '';
  if (stdout.includes('### Error')) {
    throw new Error(`Playwright falhou em "${label}".\n${stdout}`);
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, `${label.replace(/\s+/g, '-').toLowerCase()}.md`), stdout, 'utf8');
}

function pwSnapshot(label) {
  const result = pw('snapshot');
  fs.writeFileSync(path.join(OUTPUT_DIR, `${label}-snapshot.md`), result.stdout || '', 'utf8');
}

function assertConsoleClean(label) {
  pw('console', 'error');
  const source = latestPlaywrightLog('console');
  if (!source) {
    throw new Error(`Log de console nao encontrado para ${label}.`);
  }

  const target = path.join(OUTPUT_DIR, `${label}-console.log`);
  fs.copyFileSync(source, target);
  const content = fs.readFileSync(source, 'utf8');
  if (/Errors:\s*[1-9][0-9]*/.test(content)) {
    throw new Error(`Erros de console detectados em ${label}.\n${content}`);
  }
}

function assertNetworkClean(label) {
  pw('network');
  const source = latestPlaywrightLog('network');
  if (!source) {
    throw new Error(`Log de rede nao encontrado para ${label}.`);
  }

  const target = path.join(OUTPUT_DIR, `${label}-network.log`);
  fs.copyFileSync(source, target);

  const lines = fs
    .readFileSync(source, 'utf8')
    .split('\n')
    .filter(Boolean)
    .filter((line) => !/\/favicon\.ico|\/apple-touch-icon(\.png)?/.test(line));
  const failures = lines.filter((line) => /=> \[(FAILED|4[0-9]{2}|5[0-9]{2})\]/.test(line));
  if (failures.length > 0) {
    throw new Error(`Falhas de rede detectadas em ${label}.\n${failures.slice(0, 20).join('\n')}`);
  }
}

async function apiRequest(pathname, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  let response = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      response = await fetch(`${API_URL}${pathname}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 5) {
        await delay(200 * attempt);
      }
    }
  }

  if (!response) {
    const detail =
      lastError instanceof Error
        ? `${lastError.message}${lastError.cause ? ` | cause: ${String(lastError.cause)}` : ''}`
        : String(lastError);
    throw new Error(`fetch ${options.method || 'GET'} ${pathname} failed: ${detail}`);
  }

  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${pathname} -> ${response.status} ${raw}`);
  }
  return data;
}

async function cleanupTestData() {
  runCommand('Limpando dados de teste', 'node', ['scripts/cleanup-test-data.mjs'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      QB_API_URL: API_URL
    }
  });
}

async function waitForApiMatch(label, matcher, options = {}) {
  const attempts = Number(options.attempts || 12);
  const delayMs = Number(options.delayMs || 500);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const value = await matcher();
    if (value) {
      return value;
    }

    if (attempt < attempts) {
      await delay(delayMs);
    }
  }

  throw new Error(`Nao foi possivel localizar ${label} apos ${attempts} tentativa(s).`);
}

async function runCriticalFlow() {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const productName = `Broa E2E [TESTE_E2E] ${suffix}`;
  const customerName = `Cliente E2E [TESTE_E2E] ${suffix}`;
  const customerPhone = '11999999999';
  const customerAddress = `Rua QA E2E, ${suffix}`;

  pw('open', 'about:blank');

  pwRun(
    `
      await page.goto(${JSON.stringify(`${webUrl}/produtos`)}, { waitUntil: 'domcontentloaded' });
      try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
      await page.getByText('Base de massa', { exact: false }).first().waitFor({ state: 'visible', timeout: 10000 });
    `,
    'Validar rota produtos'
  );
  pwSnapshot('critical-e2e-produtos-route');
  assertConsoleClean('critical-e2e-produtos-route');
  assertNetworkClean('critical-e2e-produtos-route');

  const createdProduct = await apiRequest('/products', {
    method: 'POST',
    body: {
      name: productName,
      category: 'Sabores',
      unit: 'un',
      price: 12.5,
      active: true
    }
  });
  if (!createdProduct?.id) {
    throw new Error(`Produto criado via API sem id: ${productName}`);
  }

  await apiRequest('/boms', {
    method: 'POST',
    body: {
      productId: createdProduct.id,
      name: `Receita E2E [TESTE_E2E] ${suffix}`,
      saleUnitLabel: 'Unidade',
      yieldUnits: 1,
      items: []
    }
  });

  pwRun(
    `
      await page.goto(${JSON.stringify(`${webUrl}/clientes`)}, { waitUntil: 'domcontentloaded' });
      try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
      await page.getByPlaceholder('Nome completo').fill(${JSON.stringify(customerName)});
      await page.getByPlaceholder('(11) 99999-9999').fill(${JSON.stringify(customerPhone)});
      await page.getByPlaceholder('Rua, numero, bairro, cidade').fill(${JSON.stringify(customerAddress)});
      await page.getByRole('button', { name: 'Criar', exact: true }).click();
      await page.getByText(${JSON.stringify(customerName)}, { exact: false }).first().waitFor({ state: 'visible', timeout: 10000 });
    `,
    'Criar cliente'
  );
  pwSnapshot('critical-e2e-clientes');
  assertConsoleClean('critical-e2e-clientes');
  assertNetworkClean('critical-e2e-clientes');

  pwRun(
    `
      await page.goto(${JSON.stringify(`${webUrl}/pedidos`)}, { waitUntil: 'domcontentloaded' });
      try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}

      const legacySummary = page.locator('summary').filter({ hasText: 'Novo pedido' }).first();
      if (await legacySummary.count()) {
        const newOrderDetails = legacySummary.locator('xpath=ancestor::details[1]');
        if (!(await newOrderDetails.evaluate((element) => Boolean(element.open)))) {
          await legacySummary.click();
        }

        await newOrderDetails.getByPlaceholder('Buscar cliente...').fill(${JSON.stringify(customerName)});
        await newOrderDetails.getByPlaceholder('Buscar produto...').fill(${JSON.stringify(productName)});
        await newOrderDetails.getByRole('button', { name: 'Adicionar item', exact: true }).click();
        await newOrderDetails.getByText(${JSON.stringify(productName)}, { exact: false }).first().waitFor({ state: 'visible', timeout: 10000 });
        await newOrderDetails.getByRole('button', { name: 'Criar pedido', exact: true }).click();
      } else {
        const newOrderSlot = page.locator('[data-layout-slot-id="new_order"]').first();
        const hasLegacySlot = await newOrderSlot.count();
        if (hasLegacySlot && (await newOrderSlot.isVisible().catch(() => false))) {
          await newOrderSlot.getByPlaceholder('Cliente').fill(${JSON.stringify(customerName)});

          const productCard = newOrderSlot.locator(
            ${JSON.stringify(`[data-quick-order-product-id="${createdProduct.id}"]`)}
          );

          await productCard.waitFor({ state: 'visible', timeout: 10000 });
          await productCard.getByRole('button', { name: '+1', exact: true }).click();
          await newOrderSlot.getByRole('button', { name: 'Criar', exact: true }).click();
        } else {
          const openNewOrderButton = page.getByRole('button', { name: /novo pedido/i }).first();
          await openNewOrderButton.waitFor({ state: 'visible', timeout: 10000 });
          await openNewOrderButton.click();

          const newOrderModal = page.locator('.order-detail-modal__dialog').first();
          await newOrderModal.waitFor({ state: 'visible', timeout: 10000 });
          await newOrderModal.getByPlaceholder('Cliente').fill(${JSON.stringify(customerName)});

          const productCard = newOrderModal.locator(
            ${JSON.stringify(`[data-quick-order-product-id="${createdProduct.id}"]`)}
          );
          await productCard.waitFor({ state: 'visible', timeout: 10000 });
          await productCard.getByRole('button', { name: '+1', exact: true }).click();
          await newOrderModal.getByRole('button', { name: 'Criar', exact: true }).click();
        }
      }
      await page.waitForTimeout(1000);
    `,
    'Jornada critica em pedidos'
  );
  pwSnapshot('critical-e2e-pedidos');
  assertConsoleClean('critical-e2e-pedidos');
  assertNetworkClean('critical-e2e-pedidos');

  const createdCustomer = await waitForApiMatch(`cliente ${customerName}`, async () => {
    const customers = await apiRequest('/customers');
    return [...customers]
      .filter((entry) => String(entry.name || '').includes(suffix))
      .sort((left, right) => (right.id || 0) - (left.id || 0))[0];
  });
  if (!createdCustomer?.id) {
    throw new Error(`Cliente criado no browser nao encontrado na API: ${customerName}`);
  }

  const createdOrder = await waitForApiMatch(`pedido do cliente ${customerName}`, async () => {
    const orders = await apiRequest('/orders');
    return [...orders]
      .filter((entry) => entry.customerId === createdCustomer.id)
      .sort((left, right) => (right.id || 0) - (left.id || 0))[0];
  });
  if (!createdOrder?.id) {
    throw new Error(`Pedido criado no browser nao encontrado para o cliente ${customerName}.`);
  }
  if (!Array.isArray(createdOrder.items) || !createdOrder.items.some((entry) => entry.productId === createdProduct.id)) {
    throw new Error(`Pedido #${createdOrder.id} nao contem o produto criado pelo fluxo de UI.`);
  }
  if ((createdOrder.status || '').toUpperCase() !== 'ABERTO') {
    throw new Error(`Pedido criado via UI deveria iniciar em ABERTO, mas veio como ${createdOrder.status}.`);
  }

  let progressedOrder = createdOrder;
  for (const status of ['CONFIRMADO', 'EM_PREPARACAO', 'PRONTO', 'ENTREGUE']) {
    progressedOrder = await apiRequest(`/orders/${createdOrder.id}/status`, {
      method: 'PATCH',
      body: { status }
    });

    if (progressedOrder.status !== status) {
      throw new Error(`Pedido #${createdOrder.id} nao avancou para ${status}. Status atual: ${progressedOrder.status}`);
    }
  }

  await apiRequest('/payments', {
    method: 'POST',
    body: {
      orderId: createdOrder.id,
      amount: progressedOrder.total,
      method: 'pix',
      status: 'PAGO'
    }
  });

  const finalOrder = await apiRequest(`/orders/${createdOrder.id}`);
  if (finalOrder.status !== 'ENTREGUE') {
    throw new Error(`Pedido final nao terminou em ENTREGUE. Status atual: ${finalOrder.status}`);
  }
  if (finalOrder.paymentStatus !== 'PAGO') {
    throw new Error(`Pedido final nao terminou em PAGO. Payment status atual: ${finalOrder.paymentStatus}`);
  }
  if (Number(finalOrder.balanceDue || 0) > 0.00001) {
    throw new Error(`Pedido final ficou com saldo residual: ${finalOrder.balanceDue}`);
  }

  log(`[qa-critical-e2e] Jornada concluida. Pedido #${createdOrder.id} validado como ENTREGUE e PAGO.`);
}

async function shutdownChild(child, label) {
  if (!child || child.exitCode != null) return;

  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(3000)
  ]);

  if (child.exitCode == null) {
    child.kill('SIGKILL');
  }

  log(`[qa-critical-e2e] ${label} finalizado.`);
}

async function main() {
  if (spawnSync('bash', ['-lc', 'command -v npx >/dev/null 2>&1']).status !== 0) {
    throw new Error('npx nao encontrado. Instale Node.js/npm antes de rodar o E2E critico.');
  }

  if (!fs.existsSync(PWCLI)) {
    throw new Error(`Wrapper do Playwright nao encontrado: ${PWCLI}`);
  }

  log('QA Critical E2E started.');
  await ensureApiServer();
  await ensureWebServer();
  await cleanupTestData();
  await runCriticalFlow();
  await cleanupTestData();
  log(`QA Critical E2E OK (${webUrl})`);
}

main()
  .catch(async (error) => {
    console.error('QA Critical E2E FAILED');
    if (error instanceof Error) {
      console.error(error.stack || error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (await isHttpOk(`${API_URL}/health`)) {
        await cleanupTestData();
      }
    } catch (error) {
      console.error(
        `[qa-critical-e2e] Falha ao limpar dados de teste no encerramento: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      process.exitCode = 1;
    }

    try {
      runCommand('Encerrando sessao Playwright', PWCLI, ['close'], {
        env: {
          ...process.env,
          PLAYWRIGHT_CLI_SESSION: SESSION_NAME
        },
        stdio: 'ignore'
      });
    } catch {
      // melhor esforco
    }

    await shutdownChild(webChild, 'Web temporario');
    await shutdownChild(apiChild, 'API temporaria');
  });
