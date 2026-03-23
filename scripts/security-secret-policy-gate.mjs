import { execFileSync } from 'node:child_process';

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trimEnd();
}

function getArgValue(name, fallback = '') {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

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

const DISALLOWED_PATH_PATTERNS = [
  { id: 'dotenv-sensitive', regex: /(^|\/)\.env(?:\.[^/]+)?$/i },
  { id: 'private-key-file', regex: /\.(pem|p12|pfx|key|jks|kdbx|p8)$/i }
];

const ALLOWLIST_PATHS = [/\.env\.example$/i];

function isAllowedPath(path) {
  return ALLOWLIST_PATHS.some((pattern) => pattern.test(path));
}

function isDisallowedPath(path) {
  if (isAllowedPath(path)) return false;
  return DISALLOWED_PATH_PATTERNS.some((pattern) => pattern.regex.test(path));
}

function isLikelyPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.includes('${') || normalized.includes('process.env')) return true;
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

function scanChangedPaths(range) {
  const output = runGit(['diff', '--name-status', '--diff-filter=ACMRTUXB', range]);
  if (!output) return [];

  const findings = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    const status = parts[0];
    const maybePathA = parts[1] || '';
    const maybePathB = parts[2] || '';
    const candidatePath = status.startsWith('R') ? maybePathB : maybePathA;
    if (!candidatePath) continue;

    if (isDisallowedPath(candidatePath)) {
      findings.push({
        type: 'path-policy',
        reason: `disallowed file path changed: ${candidatePath}`
      });
    }
  }
  return findings;
}

function scanAddedLines(range) {
  const diff = runGit(['diff', '--no-color', '--unified=0', '--diff-filter=AM', range]);
  if (!diff) return [];

  const findings = [];
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
      const content = rawLine.slice(1);
      const trimmed = content.trim();
      if (!trimmed || /^\s*#/.test(trimmed)) {
        currentLine += 1;
        continue;
      }

      for (const pattern of HIGH_CONFIDENCE_PATTERNS) {
        if (pattern.regex.test(content)) {
          findings.push({
            type: 'content-policy',
            reason: `high-confidence secret pattern (${pattern.id})`,
            file: currentFile,
            line: currentLine,
            sample: trimmed.slice(0, 160)
          });
        }
      }

      const assignment = GENERIC_SECRET_ASSIGNMENT.exec(content);
      if (assignment) {
        const variable = assignment[1];
        const value = assignment[2];
        if (!value.includes('$') && !isLikelyPlaceholder(value)) {
          findings.push({
            type: 'content-policy',
            reason: `suspicious secret assignment (${variable})`,
            file: currentFile,
            line: currentLine,
            sample: trimmed.slice(0, 160)
          });
        }
      }

      const dbUrl = DB_URL_WITH_CREDENTIALS.exec(content);
      if (dbUrl) {
        const host = dbUrl[3].toLowerCase();
        const isLocalHost = host.startsWith('localhost') || host.startsWith('127.0.0.1');
        if (!isLocalHost) {
          findings.push({
            type: 'content-policy',
            reason: 'database URL with embedded credentials',
            file: currentFile,
            line: currentLine,
            sample: trimmed.slice(0, 160)
          });
        }
      }

      currentLine += 1;
      continue;
    }

    if (rawLine.startsWith(' ') && !rawLine.startsWith('\\')) {
      currentLine += 1;
    }
  }

  return findings;
}

function buildRange(base, head) {
  const zeroSha = /^0{40}$/;
  if (zeroSha.test(base)) {
    return `${head}^!`;
  }
  return `${base}...${head}`;
}

function main() {
  const base = getArgValue('--base', process.env.SECURITY_DIFF_BASE || '');
  const head = getArgValue('--head', process.env.SECURITY_DIFF_HEAD || '');

  if (!base || !head) {
    console.error('Missing required refs. Use --base <ref> --head <ref>.');
    process.exit(1);
  }

  const range = buildRange(base, head);

  const findings = [...scanChangedPaths(range), ...scanAddedLines(range)];
  if (findings.length > 0) {
    console.error('Secret policy gate blocked this diff:');
    for (const finding of findings) {
      if (finding.type === 'path-policy') {
        console.error(`- ${finding.reason}`);
        continue;
      }
      console.error(`- ${finding.file}:${finding.line} -> ${finding.reason}`);
      console.error(`  ${finding.sample}`);
    }
    console.error('');
    console.error('Policy: never commit sensitive .env/key files or literal credentials.');
    process.exit(1);
  }

  console.log(`Secret policy gate passed for range ${range}.`);
}

main();
