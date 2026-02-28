import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const mode = args.has('--full') ? 'full' : 'staged';

const HIGH_CONFIDENCE_PATTERNS = [
  { id: 'private-key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'openai-key', regex: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { id: 'github-pat', regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { id: 'github-fine-grained-pat', regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { id: 'aws-access-key', regex: /\b(?:AKIA|ASIA|A3T)[A-Z0-9]{16}\b/ },
  { id: 'slack-token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'google-api-key', regex: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { id: 'jwt-token', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ }
];

const GENERIC_SECRET_ASSIGNMENT =
  /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|DATABASE_URL|ACCESS_KEY|CLIENT_SECRET)[A-Z0-9_]*)\s*=\s*["']?([^"'\s`,;]+)/;

const DB_URL_WITH_CREDENTIALS = /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?):\/\/([^/\s:@]+):([^/\s@]+)@([^/\s]+)/i;

function runGit(argsList) {
  return execFileSync('git', argsList, { encoding: 'utf8' }).trimEnd();
}

function isBinaryBuffer(buffer) {
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function isLikelyPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.includes('${') || normalized.includes('process.env')) return true;
  if (/^\d+$/.test(normalized)) return true;
  if (
    /^(example|examples|sample|dummy|test|tests|changeme|replace_me|your[_-]?token|your[_-]?key|null|undefined|todo)$/i.test(
      normalized
    )
  ) {
    return true;
  }
  if (/^<.*>$/.test(normalized)) return true;
  if (/^\*+$/.test(normalized)) return true;
  if (/^x{4,}$/.test(normalized)) return true;
  if (/^postgres$/.test(normalized)) return true;
  if (/^https?:\/\//.test(normalized)) return true;
  if (/^file:\.\/dev\.db$/.test(normalized)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)/.test(normalized)) return true;
  if (
    /^postgresql:\/\/postgres:postgres@(localhost|127\.0\.0\.1):5432\/querobroapp\?schema=public$/.test(
      normalized
    )
  ) {
    return true;
  }
  return false;
}

function buildFullTargets() {
  const files = runGit(['ls-files'])
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);

  const targets = [];
  for (const file of files) {
    if (file.startsWith('.git/')) continue;
    const buffer = readFileSync(file);
    if (isBinaryBuffer(buffer)) continue;
    const text = buffer.toString('utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      targets.push({ file, line: i + 1, text: lines[i] });
    }
  }
  return targets;
}

function buildStagedTargets() {
  const diff = runGit(['diff', '--cached', '--no-color', '--unified=0', '--diff-filter=AM']);
  if (!diff) return [];

  const targets = [];
  let currentFile = '';
  let currentLine = 0;

  for (const rawLine of diff.split('\n')) {
    if (rawLine.startsWith('+++ b/')) {
      currentFile = rawLine.slice(6).trim();
      continue;
    }

    if (rawLine.startsWith('@@')) {
      const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
      if (match) currentLine = Number(match[1]);
      continue;
    }

    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      targets.push({ file: currentFile, line: currentLine, text: rawLine.slice(1) });
      currentLine += 1;
      continue;
    }

    if (rawLine.startsWith(' ') && !rawLine.startsWith('\\')) {
      currentLine += 1;
    }
  }

  return targets;
}

function analyzeLine(file, lineNumber, lineText) {
  const findings = [];
  const trimmed = lineText.trim();
  if (!trimmed) return findings;
  if (/^\s*#/.test(trimmed)) return findings;

  for (const pattern of HIGH_CONFIDENCE_PATTERNS) {
    if (pattern.regex.test(lineText)) {
      findings.push({
        file,
        line: lineNumber,
        reason: `high-confidence pattern: ${pattern.id}`,
        sample: trimmed.slice(0, 160)
      });
    }
  }

  const assignment = GENERIC_SECRET_ASSIGNMENT.exec(lineText);
  if (assignment) {
    const variable = assignment[1];
    const value = assignment[2];
    if (!value.includes('$') && !isLikelyPlaceholder(value)) {
      findings.push({
        file,
        line: lineNumber,
        reason: `suspicious secret assignment: ${variable}`,
        sample: trimmed.slice(0, 160)
      });
    }
  }

  const dbUrl = DB_URL_WITH_CREDENTIALS.exec(lineText);
  if (dbUrl) {
    const host = dbUrl[3].toLowerCase();
    const isLocalHost = host.startsWith('localhost') || host.startsWith('127.0.0.1');
    if (!isLocalHost) {
      findings.push({
        file,
        line: lineNumber,
        reason: 'database URL with embedded credentials',
        sample: trimmed.slice(0, 160)
      });
    }
  }

  return findings;
}

function main() {
  const targets = mode === 'full' ? buildFullTargets() : buildStagedTargets();
  if (targets.length === 0) {
    console.log(`Secret guard: no ${mode === 'full' ? 'tracked text' : 'staged added'} lines to scan.`);
    return;
  }

  const findings = [];
  for (const target of targets) {
    findings.push(...analyzeLine(target.file, target.line, target.text));
  }

  if (findings.length > 0) {
    console.error('Secret guard blocked potential credential exposure:');
    for (const finding of findings) {
      console.error(`- ${finding.file}:${finding.line} -> ${finding.reason}`);
      console.error(`  ${finding.sample}`);
    }
    console.error('');
    console.error(
      'Action required: move secrets to local .env (ignored) or a secret manager. Never commit real credentials.'
    );
    process.exit(1);
  }

  console.log(`Secret guard: ok (${mode} scan).`);
}

main();
