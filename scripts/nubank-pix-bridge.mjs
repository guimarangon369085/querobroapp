import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DEFAULT_API_URL = 'https://api.querobroa.com.br';
const DEFAULT_STATE_FILE = path.join(ROOT_DIR, 'output', 'nubank-pix-bridge', 'state.json');
const DEFAULT_POLL_MS = 60_000;
const DEFAULT_RETRY_MS = 5 * 60_000;

const FIND_NUBANK_TAB_SCRIPT = `
on run
  tell application "Google Chrome"
    set fallbackWindowIndex to 0
    set fallbackTabIndex to 0
    repeat with w from 1 to count of windows
      repeat with t from 1 to count of tabs of window w
        set tabRef to tab t of window w
        set tabUrl to URL of tabRef
        if tabUrl contains "app.nubank.com.br/beta/pj/savings-account/" then
          return (w as text) & "," & (t as text)
        end if
        if fallbackWindowIndex is 0 and tabUrl contains "app.nubank.com.br/beta/pj/" then
          set fallbackWindowIndex to w
          set fallbackTabIndex to t
        end if
      end repeat
    end repeat
    if fallbackWindowIndex is not 0 then
      tell tab fallbackTabIndex of window fallbackWindowIndex
        set URL to "https://app.nubank.com.br/beta/pj/savings-account/"
      end tell
      return (fallbackWindowIndex as text) & "," & (fallbackTabIndex as text)
    end if
  end tell
  error "Nenhuma aba autenticada do Nubank PJ foi encontrada no Google Chrome."
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
    pollMs: Number(process.env.NUBANK_PIX_BRIDGE_POLL_MS || DEFAULT_POLL_MS),
    retryMs: Number(process.env.NUBANK_PIX_BRIDGE_RETRY_MS || DEFAULT_RETRY_MS)
  };

  for (const arg of argv) {
    if (arg === '--once') options.once = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--poll-ms=')) options.pollMs = Number(arg.slice('--poll-ms='.length));
    else if (arg.startsWith('--retry-ms=')) options.retryMs = Number(arg.slice('--retry-ms='.length));
  }

  if (!Number.isFinite(options.pollMs) || options.pollMs <= 0) options.pollMs = DEFAULT_POLL_MS;
  if (!Number.isFinite(options.retryMs) || options.retryMs <= 0) options.retryMs = DEFAULT_RETRY_MS;
  return options;
}

function runAppleScript(script, args = []) {
  const result = spawnSync('osascript', ['-', ...args], {
    encoding: 'utf8',
    input: script,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim() || `osascript exit ${result.status}`;
    throw new Error(detail);
  }

  return String(result.stdout || '').trim();
}

function findNubankTab() {
  const raw = runAppleScript(FIND_NUBANK_TAB_SCRIPT);
  const [windowIndexRaw, tabIndexRaw] = raw.split(',');
  const windowIndex = Number(windowIndexRaw);
  const tabIndex = Number(tabIndexRaw);
  if (!Number.isInteger(windowIndex) || !Number.isInteger(tabIndex)) {
    throw new Error(`Resposta invalida da aba do Nubank: ${raw}`);
  }
  return { windowIndex, tabIndex };
}

function executeChromeJs(tab, jsSource) {
  return runAppleScript(EXEC_CHROME_JS_SCRIPT, [jsSource, String(tab.windowIndex), String(tab.tabIndex)]);
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readState(filePath) {
  if (!fs.existsSync(filePath)) {
    return { version: 1, records: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.records && typeof parsed.records === 'object') {
      return parsed;
    }
  } catch {}

  return { version: 1, records: {} };
}

function writeState(filePath, state) {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBrazilianCurrency(rawValue) {
  const normalized = String(rawValue || '')
    .replace(/[^\d,+.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim();
  const parsed = Number(normalized.replace(/^\+/, ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function nowInSaoPauloParts(reference = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return Object.fromEntries(formatter.formatToParts(reference).map((entry) => [entry.type, entry.value]));
}

function resolveObservedPaidAt(timeLabel) {
  const match = String(timeLabel || '').match(/(\d{2}):(\d{2})/);
  if (!match) return null;
  const parts = nowInSaoPauloParts();
  return `${parts.year}-${parts.month}-${parts.day}T${match[1]}:${match[2]}:00-03:00`;
}

function fingerprintTransaction(transaction) {
  return [
    transaction.timeLabel || 'sem-hora',
    normalizeName(transaction.payerName || 'sem-nome'),
    Number(transaction.amount || 0).toFixed(2)
  ].join('|');
}

function parseVisiblePixTransaction(row) {
  const lines = Array.isArray(row.lines) ? row.lines.map((value) => String(value || '').trim()).filter(Boolean) : [];
  if (lines.length < 3) return null;

  const payerName = lines[0];
  const detailLine = lines[1];
  const amountLine = lines[2];
  if (!/\bPix\b/i.test(detailLine)) return null;
  if (!amountLine.includes('+')) return null;

  const amount = parseBrazilianCurrency(amountLine);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const timeMatch = detailLine.match(/(\d{2}:\d{2})/);
  const timeLabel = timeMatch?.[1] ?? null;
  const transaction = {
    payerName,
    amount,
    timeLabel,
    paidAt: resolveObservedPaidAt(timeLabel),
    rawText: String(row.rawText || lines.join(' | ')),
    rowIndex: row.rowIndex || null
  };

  return {
    ...transaction,
    fingerprint: fingerprintTransaction(transaction)
  };
}

function buildExtractScript() {
  return `(() => {
    const grid = document.querySelector('[role="grid"]');
    if (grid && typeof grid.scrollTop === 'number') {
      grid.scrollTop = 0;
      grid.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    const rows = Array.from(document.querySelectorAll('[role="row"][tabindex]')).slice(0, 20).map((node) => {
      const lines = String(node.innerText || '')
        .split('\\n')
        .map((value) => value.trim())
        .filter(Boolean);
      return {
        rowIndex: node.getAttribute('aria-rowindex'),
        rawText: lines.join(' | '),
        lines
      };
    });
    return JSON.stringify({
      title: document.title,
      url: location.href,
      rows
    });
  })()`;
}

async function postReconciliation(apiUrl, token, transaction) {
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}/payments/pix-reconciliations/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-bank-sync-token': token
    },
    body: JSON.stringify({
      payerName: transaction.payerName,
      amount: transaction.amount,
      paidAt: transaction.paidAt,
      source: 'nubank-web-bridge',
      sourceTransactionId: transaction.fingerprint,
      metadata: {
        rowIndex: transaction.rowIndex,
        rawText: transaction.rawText,
        timeLabel: transaction.timeLabel
      }
    })
  });

  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${raw}`);
  }

  return body;
}

function log(message, extra = null) {
  const prefix = new Date().toISOString();
  if (extra == null) {
    console.log(`${prefix} ${message}`);
    return;
  }
  console.log(`${prefix} ${message}`, extra);
}

async function runCycle(context) {
  const tab = findNubankTab();
  const raw = executeChromeJs(tab, buildExtractScript());
  const snapshot = JSON.parse(raw || '{}');
  const transactions = (snapshot.rows || [])
    .map((row) => parseVisiblePixTransaction(row))
    .filter(Boolean);

  if (!transactions.length) {
    log('Nenhum PIX de entrada visivel no extrato do Nubank.');
    return;
  }

  const now = Date.now();
  let processed = 0;
  for (const transaction of transactions) {
    const existing = context.state.records[transaction.fingerprint];
    if (existing?.matched) continue;
    if (existing?.lastAttemptedAt && now - Date.parse(existing.lastAttemptedAt) < context.retryMs) continue;

    processed += 1;
    const record = context.state.records[transaction.fingerprint] || {
      firstSeenAt: new Date(now).toISOString()
    };

    try {
      if (context.dryRun) {
        log(`DRY RUN ${transaction.payerName} ${transaction.amount.toFixed(2)}`, transaction);
        context.state.records[transaction.fingerprint] = {
          ...record,
          lastAttemptedAt: new Date(now).toISOString(),
          lastOutcome: 'DRY_RUN',
          matched: false
        };
        continue;
      }

      const result = await postReconciliation(context.apiUrl, context.token, transaction);
      const matched = Boolean(result?.matched);
      context.state.records[transaction.fingerprint] = {
        ...record,
        lastAttemptedAt: new Date(now).toISOString(),
        lastOutcome: matched ? 'MATCHED' : String(result?.reason || 'NO_MATCH'),
        matched
      };
      if (matched) {
        log(
          `PIX conciliado para ${transaction.payerName} ${transaction.amount.toFixed(2)}`,
          result?.order || result
        );
      } else {
        log(
          `PIX sem baixa automatica para ${transaction.payerName} ${transaction.amount.toFixed(2)}`,
          { reason: result?.reason, candidateCount: result?.candidateCount }
        );
      }
    } catch (error) {
      context.state.records[transaction.fingerprint] = {
        ...record,
        lastAttemptedAt: new Date(now).toISOString(),
        lastOutcome: 'ERROR',
        matched: false
      };
      throw error;
    }
  }

  if (processed === 0) {
    log('Nenhuma transacao nova precisou de tentativa nesta rodada.');
  }
}

async function main() {
  loadEnvFile(path.join(ROOT_DIR, '.env'));
  loadEnvFile(path.join(ROOT_DIR, 'apps', 'api', '.env'));

  const options = parseArgs(process.argv.slice(2));
  const apiUrl = String(process.env.QB_PIX_BRIDGE_API_URL || DEFAULT_API_URL).trim() || DEFAULT_API_URL;
  const token = String(process.env.BANK_SYNC_WEBHOOK_TOKEN || '').trim();
  const stateFile = String(process.env.NUBANK_PIX_BRIDGE_STATE_FILE || DEFAULT_STATE_FILE).trim() || DEFAULT_STATE_FILE;

  if (!options.dryRun && !token) {
    throw new Error('BANK_SYNC_WEBHOOK_TOKEN obrigatorio para reconciliar PIX fora do modo dry-run.');
  }

  const context = {
    apiUrl,
    token,
    dryRun: options.dryRun,
    retryMs: options.retryMs,
    state: readState(stateFile),
    stateFile
  };

  if (options.once) {
    await runCycle(context);
    writeState(stateFile, context.state);
    return;
  }

  while (true) {
    try {
      await runCycle(context);
      writeState(stateFile, context.state);
    } catch (error) {
      log(error instanceof Error ? error.message : String(error));
      writeState(stateFile, context.state);
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollMs));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
