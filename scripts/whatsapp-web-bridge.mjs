import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DEFAULT_API_URL = 'https://api.querobroa.com.br';
const DEFAULT_STATE_FILE = path.join(ROOT_DIR, 'output', 'whatsapp-web-bridge', 'state.json');
const DEFAULT_POLL_MS = 60_000;
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_CHAT_TIMEOUT_MS = 30_000;
const DEFAULT_POST_CLICK_DELAY_MS = 1_500;

const FIND_WHATSAPP_TAB_SCRIPT = `
on run
  tell application "Google Chrome"
    repeat with w from 1 to count of windows
      repeat with t from 1 to count of tabs of window w
        set tabRef to tab t of window w
        set tabUrl to URL of tabRef
        if tabUrl contains "web.whatsapp.com" then
          return (w as text) & "," & (t as text)
        end if
      end repeat
    end repeat
    if (count of windows) is 0 then
      make new window
    end if
    tell window 1
      make new tab with properties {URL:"https://web.whatsapp.com/"}
      return "1," & (count of tabs as text)
    end tell
  end tell
end run
`;

const EXEC_CHROME_JS_SCRIPT = `
on run argv
  set jsSource to item 1 of argv
  set windowIndex to item 2 of argv as integer
  set tabIndex to item 3 of argv as integer
  tell application "Google Chrome"
    tell tab tabIndex of window windowIndex
      return execute javascript jsSource
    end tell
  end tell
end run
`;

const SET_TAB_URL_SCRIPT = `
on run argv
  set nextUrl to item 1 of argv
  set windowIndex to item 2 of argv as integer
  set tabIndex to item 3 of argv as integer
  tell application "Google Chrome"
    tell tab tabIndex of window windowIndex
      set URL to nextUrl
    end tell
  end tell
end run
`;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!key || process.env[key]) continue;
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseArgs(argv) {
  const options = {
    once: false,
    dryRun: false,
    pollMs: Number(process.env.QB_WHATSAPP_WEB_BRIDGE_POLL_MS || DEFAULT_POLL_MS),
    lookbackDays: Number(process.env.QB_WHATSAPP_WEB_BRIDGE_LOOKBACK_DAYS || DEFAULT_LOOKBACK_DAYS),
    chatTimeoutMs: Number(process.env.QB_WHATSAPP_WEB_BRIDGE_CHAT_TIMEOUT_MS || DEFAULT_CHAT_TIMEOUT_MS),
    postClickDelayMs: Number(
      process.env.QB_WHATSAPP_WEB_BRIDGE_POST_CLICK_DELAY_MS || DEFAULT_POST_CLICK_DELAY_MS
    )
  };

  for (const arg of argv) {
    if (arg === '--once') options.once = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--poll-ms=')) options.pollMs = Number(arg.slice('--poll-ms='.length));
    else if (arg.startsWith('--lookback-days=')) options.lookbackDays = Number(arg.slice('--lookback-days='.length));
    else if (arg.startsWith('--chat-timeout-ms=')) {
      options.chatTimeoutMs = Number(arg.slice('--chat-timeout-ms='.length));
    } else if (arg.startsWith('--post-click-delay-ms=')) {
      options.postClickDelayMs = Number(arg.slice('--post-click-delay-ms='.length));
    }
  }

  if (!Number.isFinite(options.pollMs) || options.pollMs <= 0) options.pollMs = DEFAULT_POLL_MS;
  if (!Number.isFinite(options.lookbackDays) || options.lookbackDays <= 0) options.lookbackDays = DEFAULT_LOOKBACK_DAYS;
  if (!Number.isFinite(options.chatTimeoutMs) || options.chatTimeoutMs <= 0) options.chatTimeoutMs = DEFAULT_CHAT_TIMEOUT_MS;
  if (!Number.isFinite(options.postClickDelayMs) || options.postClickDelayMs < 0) {
    options.postClickDelayMs = DEFAULT_POST_CLICK_DELAY_MS;
  }

  return options;
}

function runAppleScript(script, args = []) {
  const result = spawnSync('osascript', ['-', ...args], {
    encoding: 'utf8',
    input: script,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim() || `osascript exit ${result.status}`;
    throw new Error(detail);
  }
  return String(result.stdout || '').trim();
}

function findWhatsAppTab() {
  const raw = runAppleScript(FIND_WHATSAPP_TAB_SCRIPT);
  const [windowIndexRaw, tabIndexRaw] = raw.split(',');
  const windowIndex = Number(windowIndexRaw);
  const tabIndex = Number(tabIndexRaw);
  if (!Number.isInteger(windowIndex) || !Number.isInteger(tabIndex)) {
    throw new Error(`Resposta invalida da aba do WhatsApp Web: ${raw}`);
  }
  return { windowIndex, tabIndex };
}

function setTabUrl(tab, url) {
  runAppleScript(SET_TAB_URL_SCRIPT, [url, String(tab.windowIndex), String(tab.tabIndex)]);
}

function executeChromeJs(tab, jsSource) {
  return runAppleScript(EXEC_CHROME_JS_SCRIPT, [jsSource, String(tab.windowIndex), String(tab.tabIndex)]);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readState(filePath) {
  if (!fs.existsSync(filePath)) {
    return { version: 1, startedAt: null, orders: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.orders && typeof parsed.orders === 'object') {
      return parsed;
    }
  } catch {}

  return { version: 1, startedAt: null, orders: {} };
}

function writeState(filePath, state) {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function firstName(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)[0]
    .trim() || 'cliente';
}

function resolveOrderNumber(order) {
  return order?.publicNumber || order?.id || '';
}

function buildPendingConfirmationBody(order) {
  return 'Seu pedido foi confirmado ❤️\nVc vai receber um aviso quando suas broinhas sairem para entrega :)';
}

function buildPaidConfirmationBody(order) {
  return 'Seu pedido foi confirmado ❤️\nVc vai receber um aviso quando suas broinhas sairem para entrega :)';
}

async function fetchOrders(apiUrl, apiToken) {
  const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/orders`, {
    headers: apiToken ? { authorization: `Bearer ${apiToken}` } : undefined
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`GET /orders -> ${response.status}${raw ? ` ${raw.slice(0, 300)}` : ''}`);
  }

  const parsed = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(parsed)) {
    throw new Error('A API /orders nao retornou uma lista.');
  }
  return parsed;
}

function buildChatUrl(phone, message) {
  const params = new URLSearchParams();
  params.set('phone', phone);
  params.set('text', message);
  params.set('type', 'phone_number');
  params.set('app_absent', '0');
  return `https://web.whatsapp.com/send/?${params.toString()}`;
}

function parseChromeJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildInspectSendStateScript() {
  return `(() => {
    const text = String(document.body?.innerText || '');
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const loginHints = [
      'Scan this QR code',
      'Use WhatsApp on your phone',
      'Keep your phone connected',
      'Baixe o WhatsApp para Windows',
      'Fazer login'
    ];
    if (loginHints.some((entry) => text.includes(entry))) {
      return JSON.stringify({ state: 'LOGIN_REQUIRED' });
    }

    const invalidHints = [
      'Phone number shared via url is invalid',
      'O numero de telefone compartilhado pela URL e invalido',
      'Numero de telefone invalido',
      'This phone number is not on WhatsApp'
    ];
    if (invalidHints.some((entry) => text.includes(entry))) {
      return JSON.stringify({ state: 'INVALID_PHONE', detail: normalize(text).slice(0, 240) });
    }

    const sendSelectors = [
      'button span[data-icon="send"]',
      '[data-icon="send"]',
      'button[aria-label="Send"]',
      'button[aria-label="Enviar"]',
      '[role="button"][aria-label="Send"]',
      '[role="button"][aria-label="Enviar"]'
    ];
    let sendTrigger = null;
    for (const selector of sendSelectors) {
      const node = document.querySelector(selector);
      if (!node) continue;
      sendTrigger = node.closest('button,[role="button"],div[tabindex],span') || node;
      break;
    }

    const composer =
      document.querySelector('footer div[contenteditable="true"][role="textbox"]') ||
      document.querySelector('div[contenteditable="true"][role="textbox"]') ||
      document.querySelector('div[contenteditable="true"][data-tab]');
    const composerText = normalize(composer?.textContent || '');

    if (sendTrigger) {
      sendTrigger.click();
      return JSON.stringify({ state: 'CLICKED_SEND', composerText });
    }

    if (composer && !composerText) {
      return JSON.stringify({ state: 'SENT' });
    }

    if (composer && composerText) {
      return JSON.stringify({ state: 'COMPOSER_READY', composerText });
    }

    return JSON.stringify({ state: 'LOADING', detail: normalize(text).slice(0, 240) });
  })();`;
}

async function sendMessageViaWhatsAppWeb(tab, phone, body, options) {
  setTabUrl(tab, buildChatUrl(phone, body));
  const startedAt = Date.now();
  let clickedAt = null;

  while (Date.now() - startedAt < options.chatTimeoutMs) {
    const inspected = parseChromeJson(executeChromeJs(tab, buildInspectSendStateScript())) || {
      state: 'UNKNOWN'
    };

    if (inspected.state === 'LOGIN_REQUIRED') {
      throw new Error('WhatsApp Web sem sessao autenticada nesta maquina.');
    }

    if (inspected.state === 'INVALID_PHONE') {
      throw new Error(inspected.detail || 'Numero invalido no WhatsApp Web.');
    }

    if (inspected.state === 'CLICKED_SEND') {
      clickedAt = Date.now();
      await delay(options.postClickDelayMs);
      continue;
    }

    if (inspected.state === 'SENT') {
      return { ok: true };
    }

    if (clickedAt && Date.now() - clickedAt >= options.postClickDelayMs) {
      return { ok: true };
    }

    await delay(1_000);
  }

  throw new Error('Tempo esgotado aguardando envio no WhatsApp Web.');
}

function ensureStartedAt(state) {
  if (!state.startedAt) {
    state.startedAt = new Date().toISOString();
  }
}

function isRecentEnough(order, lookbackDays) {
  const createdAt = Date.parse(String(order?.createdAt || ''));
  if (!Number.isFinite(createdAt)) return false;
  return createdAt >= Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
}

function ensureOrderRecord(state, order) {
  const key = String(order.id);
  if (!state.orders[key]) {
    state.orders[key] = {
      orderId: order.id,
      firstSeenAt: new Date().toISOString(),
      lastPaymentStatus: String(order.paymentStatus || 'PENDENTE')
    };
  }
  return state.orders[key];
}

function resolvePendingDispatch(order, state, options) {
  if (!order?.id || !order?.customer?.phone) return null;
  if (!isRecentEnough(order, options.lookbackDays)) return null;

  const createdAt = Date.parse(String(order.createdAt || ''));
  if (!Number.isFinite(createdAt)) return null;

  const record = ensureOrderRecord(state, order);
  const startedAt = Date.parse(String(state.startedAt || ''));
  if (!Number.isFinite(startedAt)) return null;
  const orderPhone = normalizePhone(order.customer.phone);
  if (!orderPhone) return null;

  if (createdAt < startedAt && !record.customerConfirmationSentAt && !record.paymentConfirmationSentAt) {
    record.lastPaymentStatus = String(order.paymentStatus || 'PENDENTE');
    return null;
  }

  const paymentStatus = String(order.paymentStatus || 'PENDENTE');
  const payloadBase = {
    orderId: order.id,
    publicNumber: resolveOrderNumber(order),
    phone: orderPhone,
    customerName: String(order.customer.name || '').trim()
  };

  if (!record.customerConfirmationSentAt) {
    return {
      ...payloadBase,
      type: paymentStatus === 'PAGO' ? 'PAID_CONFIRMATION' : 'ORDER_CONFIRMATION',
      body: paymentStatus === 'PAGO' ? buildPaidConfirmationBody(order) : buildPendingConfirmationBody(order)
    };
  }

  if (record.lastPaymentStatus !== 'PAGO' && paymentStatus === 'PAGO' && !record.paymentConfirmationSentAt) {
    return {
      ...payloadBase,
      type: 'PAID_CONFIRMATION',
      body: buildPaidConfirmationBody(order)
    };
  }

  record.lastPaymentStatus = paymentStatus;
  return null;
}

function markDispatched(state, dispatch) {
  const record = ensureOrderRecord(state, { id: dispatch.orderId, paymentStatus: dispatch.type === 'PAID_CONFIRMATION' ? 'PAGO' : 'PENDENTE' });
  const sentAt = new Date().toISOString();
  if (dispatch.type === 'ORDER_CONFIRMATION') {
    record.customerConfirmationSentAt = sentAt;
  }
  if (dispatch.type === 'PAID_CONFIRMATION') {
    record.paymentConfirmationSentAt = sentAt;
    record.lastPaymentStatus = 'PAGO';
    if (!record.customerConfirmationSentAt) {
      record.customerConfirmationSentAt = sentAt;
    }
  }
  record.lastPaymentStatus = dispatch.type === 'PAID_CONFIRMATION' ? 'PAGO' : record.lastPaymentStatus;
}

async function runCycle(options, stateFile) {
  const apiUrl = String(process.env.QB_WHATSAPP_WEB_BRIDGE_API_URL || DEFAULT_API_URL).trim();
  const apiToken = String(
    process.env.QB_WHATSAPP_WEB_BRIDGE_API_TOKEN || process.env.APP_AUTH_TOKEN || ''
  ).trim();
  const state = readState(stateFile);
  ensureStartedAt(state);

  const orders = await fetchOrders(apiUrl, apiToken);
  const candidates = [];

  for (const order of orders) {
    const dispatch = resolvePendingDispatch(order, state, options);
    if (dispatch) candidates.push(dispatch);
  }

  writeState(stateFile, state);

  if (candidates.length === 0) {
    console.log('Nenhuma confirmacao pendente nesta rodada.');
    return;
  }

  const tab = findWhatsAppTab();
  for (const dispatch of candidates) {
    if (options.dryRun) {
      console.log(
        JSON.stringify({
          dryRun: true,
          type: dispatch.type,
          orderId: dispatch.orderId,
          phone: dispatch.phone
        })
      );
      continue;
    }

    await sendMessageViaWhatsAppWeb(tab, dispatch.phone, dispatch.body, options);
    markDispatched(state, dispatch);
    writeState(stateFile, state);
    console.log(
      JSON.stringify({
        ok: true,
        type: dispatch.type,
        orderId: dispatch.orderId,
        phone: dispatch.phone,
        sentAt: new Date().toISOString()
      })
    );
    await delay(1_000);
  }
}

async function main() {
  loadEnvFile(path.join(ROOT_DIR, '.env'));
  loadEnvFile(path.join(ROOT_DIR, 'apps', 'api', '.env'));

  const options = parseArgs(process.argv.slice(2));
  const stateFile = String(process.env.QB_WHATSAPP_WEB_BRIDGE_STATE_FILE || DEFAULT_STATE_FILE).trim();

  do {
    try {
      await runCycle(options, stateFile);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }

    if (options.once) break;
    await delay(options.pollMs);
  } while (true);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
