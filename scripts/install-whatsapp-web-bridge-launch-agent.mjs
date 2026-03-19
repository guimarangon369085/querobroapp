import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LAUNCH_AGENT_ID = 'com.querobroapp.whatsapp-web-bridge';
const LAUNCH_AGENTS_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const LOGS_DIR = path.join(os.homedir(), 'Library', 'Logs', 'querobroapp');
const PLIST_PATH = path.join(LAUNCH_AGENTS_DIR, `${LAUNCH_AGENT_ID}.plist`);

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

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: 'pipe'
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].map((value) => String(value || '').trim()).filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} falhou${detail ? `\n${detail}` : ''}`);
  }

  return result;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function main() {
  loadEnvFile(path.join(ROOT_DIR, '.env'));
  loadEnvFile(path.join(ROOT_DIR, 'apps', 'api', '.env'));

  const apiUrl = String(process.env.QB_WHATSAPP_WEB_BRIDGE_API_URL || 'https://api.querobroa.com.br').trim();
  const apiToken = String(
    process.env.QB_WHATSAPP_WEB_BRIDGE_API_TOKEN || process.env.APP_AUTH_TOKEN || ''
  ).trim();
  const nodeBinary = process.execPath;
  const bridgeScript = path.join(ROOT_DIR, 'scripts', 'whatsapp-web-bridge.mjs');
  const stdoutLog = path.join(LOGS_DIR, 'whatsapp-web-bridge.log');
  const stderrLog = path.join(LOGS_DIR, 'whatsapp-web-bridge.error.log');

  fs.mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LAUNCH_AGENT_ID}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${xmlEscape(nodeBinary)}</string>
      <string>${xmlEscape(bridgeScript)}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>QB_WHATSAPP_WEB_BRIDGE_API_URL</key>
      <string>${xmlEscape(apiUrl)}</string>
${apiToken ? `      <key>QB_WHATSAPP_WEB_BRIDGE_API_TOKEN</key>\n      <string>${xmlEscape(apiToken)}</string>\n` : ''}    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>60</integer>
    <key>WorkingDirectory</key>
    <string>${xmlEscape(ROOT_DIR)}</string>
    <key>StandardOutPath</key>
    <string>${xmlEscape(stdoutLog)}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(stderrLog)}</string>
  </dict>
</plist>
`;

  fs.writeFileSync(PLIST_PATH, plist, 'utf8');

  const uid = String(process.getuid?.() ?? '');
  if (!uid) {
    throw new Error('Nao foi possivel resolver o UID atual para carregar o launch agent.');
  }

  spawnSync('launchctl', ['bootout', `gui/${uid}`, PLIST_PATH], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: 'pipe'
  });

  run('launchctl', ['bootstrap', `gui/${uid}`, PLIST_PATH]);
  run('launchctl', ['kickstart', '-k', `gui/${uid}/${LAUNCH_AGENT_ID}`]);

  console.log(
    JSON.stringify({
      ok: true,
      plistPath: PLIST_PATH,
      stdoutLog,
      stderrLog
    })
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
