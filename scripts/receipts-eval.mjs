#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const OFFICIAL_ITEMS = new Set([
  'FARINHA DE TRIGO',
  'FUBA DE CANJICA',
  'ACUCAR',
  'MANTEIGA',
  'LEITE',
  'OVOS',
  'GOIABADA',
  'DOCE DE LEITE',
  'QUEIJO DO SERRO',
  'REQUEIJAO DE CORTE',
  'SACOLA',
  'CAIXA DE PLASTICO',
  'PAPEL MANTEIGA'
]);

const defaultApiUrl = 'http://127.0.0.1:3001';
const defaultFixturesPath = path.join(process.cwd(), 'tests', 'fixtures', 'receipts-evals.json');

function normalizeOfficialName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function parseArgs(argv) {
  const options = {
    apiUrl: process.env.QB_API_URL || defaultApiUrl,
    fixturesPath: process.env.QB_RECEIPTS_EVAL_FIXTURES || defaultFixturesPath,
    token: process.env.RECEIPTS_API_TOKEN || ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--api-url') options.apiUrl = argv[index + 1] || options.apiUrl;
    if (arg === '--fixtures') options.fixturesPath = argv[index + 1] || options.fixturesPath;
    if (arg === '--token') options.token = argv[index + 1] || options.token;
  }

  options.apiUrl = String(options.apiUrl || defaultApiUrl).trim().replace(/\/+$/, '');
  options.fixturesPath = path.resolve(String(options.fixturesPath || defaultFixturesPath).trim());
  options.token = String(options.token || '').trim();
  return options;
}

function inferMimeTypeFromPath(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.heic') return 'image/heic';
  if (ext === '.heif') return 'image/heif';
  return 'image/jpeg';
}

async function materializeRequestBody(request, fixturesPath) {
  const body = { ...(request || {}) };
  const imageFile = String(body.imageFile || '').trim();
  if (!imageFile) return body;

  const baseDir = path.dirname(fixturesPath);
  const absoluteImagePath = path.isAbsolute(imageFile) ? imageFile : path.resolve(baseDir, imageFile);
  const fileBuffer = await fs.readFile(absoluteImagePath);
  body.imageBase64 = fileBuffer.toString('base64');
  body.mimeType = body.mimeType || inferMimeTypeFromPath(absoluteImagePath);
  if (!body.sourceFriendly) {
    body.sourceFriendly = path.basename(absoluteImagePath);
  }
  delete body.imageFile;
  return body;
}

function validateResponseShape(response) {
  if (!response || typeof response !== 'object') return ['resposta vazia ou invalida'];
  const issues = [];
  const items = Array.isArray(response.items) ? response.items : [];
  if (!Array.isArray(response.items)) issues.push('campo items ausente ou invalido');

  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== 'object') {
      issues.push(`item ${index + 1}: formato invalido`);
      continue;
    }
    const official = normalizeOfficialName(item.item);
    if (!OFFICIAL_ITEMS.has(official)) {
      issues.push(`item ${index + 1}: item fora da lista oficial (${String(item.item || '')})`);
    }
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      issues.push(`item ${index + 1}: quantity invalido (${String(item.quantity)})`);
    }
    const unitPrice = Number(item.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      issues.push(`item ${index + 1}: unitPrice invalido (${String(item.unitPrice)})`);
    }
  }

  return issues;
}

function gradeScenario(response, checks) {
  const issues = validateResponseShape(response);
  const items = Array.isArray(response?.items) ? response.items : [];
  const itemSet = new Set(items.map((item) => normalizeOfficialName(item?.item)));

  const minItems = Number(checks?.minItems ?? 0);
  if (Number.isFinite(minItems) && items.length < minItems) {
    issues.push(`minItems nao atingido (esperado >= ${minItems}, recebido ${items.length})`);
  }

  const maxItems = Number(checks?.maxItems ?? Number.POSITIVE_INFINITY);
  if (Number.isFinite(maxItems) && items.length > maxItems) {
    issues.push(`maxItems excedido (esperado <= ${maxItems}, recebido ${items.length})`);
  }

  const requireItems = Array.isArray(checks?.requireItems) ? checks.requireItems : [];
  for (const required of requireItems) {
    const normalized = normalizeOfficialName(required);
    if (!itemSet.has(normalized)) {
      issues.push(`item obrigatorio nao encontrado: ${required}`);
    }
  }

  const forbidItems = Array.isArray(checks?.forbidItems) ? checks.forbidItems : [];
  for (const forbidden of forbidItems) {
    const normalized = normalizeOfficialName(forbidden);
    if (itemSet.has(normalized)) {
      issues.push(`item proibido encontrado: ${forbidden}`);
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

async function requestParse(apiUrl, token, body) {
  const headers = {
    'Content-Type': 'application/json',
    'x-receipts-preview': 'true'
  };
  if (token) {
    headers['x-receipts-token'] = token;
  }

  const response = await fetch(`${apiUrl}/receipts/parse`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${raw}`);
  }

  return raw ? JSON.parse(raw) : {};
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const raw = await fs.readFile(options.fixturesPath, 'utf8');
  const fixtures = JSON.parse(raw);

  if (!Array.isArray(fixtures)) {
    throw new Error('Arquivo de fixtures deve ser um array JSON.');
  }

  const enabledScenarios = fixtures.filter((entry) => entry && entry.enabled !== false);
  if (enabledScenarios.length === 0) {
    console.log(`[receipts-eval] Nenhum cenario habilitado em ${options.fixturesPath}.`);
    return;
  }

  console.log(`[receipts-eval] API: ${options.apiUrl}`);
  console.log(`[receipts-eval] Cenarios habilitados: ${enabledScenarios.length}`);

  let failures = 0;
  for (const [index, scenario] of enabledScenarios.entries()) {
    const name = String(scenario.name || `cenario-${index + 1}`);
    const requestBody = await materializeRequestBody(scenario.request || {}, options.fixturesPath);

    try {
      const response = await requestParse(options.apiUrl, options.token, requestBody);
      const grade = gradeScenario(response, scenario.checks || {});
      if (!grade.ok) {
        failures += 1;
        console.error(`\n[FAIL] ${name}`);
        for (const issue of grade.issues) {
          console.error(`- ${issue}`);
        }
        continue;
      }
      console.log(`[OK] ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`\n[FAIL] ${name}`);
      console.error(`- erro de execucao: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures > 0) {
    console.error(`\n[receipts-eval] Falhas: ${failures}`);
    process.exit(1);
  }
  console.log('\n[receipts-eval] Todos os cenarios passaram.');
}

main().catch((error) => {
  console.error(`[receipts-eval] Falha: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
