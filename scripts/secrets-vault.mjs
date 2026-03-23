import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function usage() {
  console.log('Usage:');
  console.log('  node scripts/secrets-vault.mjs encrypt <input-file> <output-file>');
  console.log('  node scripts/secrets-vault.mjs decrypt <input-file> <output-file>');
  console.log('');
  console.log('Required: set SECRETS_VAULT_PASSPHRASE in environment.');
}

function requirePassphrase() {
  const passphrase = process.env.SECRETS_VAULT_PASSPHRASE || '';
  if (!passphrase) {
    throw new Error('SECRETS_VAULT_PASSPHRASE is required.');
  }
  return passphrase;
}

function ensureOutputDir(filePath) {
  const dir = path.dirname(path.resolve(filePath));
  mkdirSync(dir, { recursive: true });
}

function encryptFile(inputPath, outputPath) {
  const passphrase = requirePassphrase();
  const plaintext = readFileSync(inputPath);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = {
    version: 1,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64')
  };

  ensureOutputDir(outputPath);
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  console.log(`Encrypted -> ${outputPath}`);
}

function decryptFile(inputPath, outputPath) {
  const passphrase = requirePassphrase();
  const raw = readFileSync(inputPath, 'utf8');
  const payload = JSON.parse(raw);

  if (!payload || payload.version !== 1 || payload.algorithm !== 'aes-256-gcm' || payload.kdf !== 'scrypt') {
    throw new Error('Unsupported vault payload format.');
  }

  const salt = Buffer.from(payload.salt, 'base64');
  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
  const key = scryptSync(passphrase, salt, 32);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  ensureOutputDir(outputPath);
  writeFileSync(outputPath, plaintext, { mode: 0o600 });
  console.log(`Decrypted -> ${outputPath}`);
}

function main() {
  const [action, inputPath, outputPath] = process.argv.slice(2);
  if (!action || !inputPath || !outputPath) {
    usage();
    process.exit(1);
  }

  if (action === 'encrypt') {
    encryptFile(inputPath, outputPath);
    return;
  }

  if (action === 'decrypt') {
    decryptFile(inputPath, outputPath);
    return;
  }

  usage();
  process.exit(1);
}

main();
