import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const devSchemaPath = path.resolve(__dirname, '../apps/api/prisma/schema.prisma');
const prodSchemaPath = path.resolve(__dirname, '../apps/api/prisma/schema.prod.prisma');

function parseBlocks(schemaText) {
  const lines = schemaText.replace(/\r\n/g, '\n').split('\n');
  const blocks = new Map();

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    const headerMatch = /^(model|enum|type)\s+([A-Za-z0-9_]+)/.exec(trimmed);
    if (!headerMatch) continue;

    const kind = headerMatch[1];
    const name = headerMatch[2];
    const key = `${kind}:${name}`;

    let depth = 0;
    const content = [];

    for (; i < lines.length; i += 1) {
      const rawLine = lines[i].replace(/\s+$/g, '');
      const line = rawLine.trim();
      if (line.startsWith('//')) continue;
      if (line.length > 0) content.push(line.replace(/\s+/g, ' '));

      for (const char of rawLine) {
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
      }

      if (depth === 0 && content.length > 0) break;
    }

    blocks.set(key, content.join('\n'));
  }

  return blocks;
}

function findMismatches(devBlocks, prodBlocks) {
  const mismatches = [];

  for (const [key, devContent] of devBlocks.entries()) {
    if (!prodBlocks.has(key)) {
      mismatches.push(`Missing in prod schema: ${key}`);
      continue;
    }

    const prodContent = prodBlocks.get(key);
    if (devContent !== prodContent) {
      mismatches.push(`Different block content: ${key}`);
    }
  }

  for (const key of prodBlocks.keys()) {
    if (!devBlocks.has(key)) {
      mismatches.push(`Missing in dev schema: ${key}`);
    }
  }

  return mismatches;
}

function main() {
  const devSchema = readFileSync(devSchemaPath, 'utf8');
  const prodSchema = readFileSync(prodSchemaPath, 'utf8');

  const devBlocks = parseBlocks(devSchema);
  const prodBlocks = parseBlocks(prodSchema);
  const mismatches = findMismatches(devBlocks, prodBlocks);

  if (mismatches.length > 0) {
    console.error('Prisma schema drift detected between dev and prod schema files.');
    for (const mismatch of mismatches) {
      console.error(`- ${mismatch}`);
    }
    process.exit(1);
  }

  console.log('Prisma schemas are aligned (models/enums/types match).');
}

main();
