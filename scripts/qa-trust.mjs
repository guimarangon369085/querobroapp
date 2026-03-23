import { spawnSync } from 'node:child_process';

const webCiDistDir = '.next-qa-trust';

const includeSmoke = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.QA_TRUST_INCLUDE_SMOKE || '')
    .trim()
    .toLowerCase()
);

const includeBrowser = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.QA_TRUST_INCLUDE_BROWSER || '')
    .trim()
    .toLowerCase()
);

const includeCriticalE2E = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.QA_TRUST_INCLUDE_CRITICAL_E2E || '')
    .trim()
    .toLowerCase()
);

const includeLint = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.QA_TRUST_INCLUDE_LINT || '')
    .trim()
    .toLowerCase()
);

const steps = [
  {
    label: 'session docs guard',
    command: 'pnpm',
    args: ['session:docs:guard']
  },
  {
    label: 'git diff check',
    command: 'git',
    args: ['diff', '--check']
  },
  {
    label: 'typecheck',
    command: 'pnpm',
    args: ['typecheck']
  },
  {
    label: 'tests',
    command: 'pnpm',
    args: ['test']
  },
  {
    label: 'prepare build ci',
    command: 'node',
    args: [
      '-e',
      `require('node:fs').rmSync('apps/web/${webCiDistDir}', { recursive: true, force: true })`
    ]
  },
  {
    label: 'build ci',
    command: 'pnpm',
    args: ['build:ci'],
    env: {
      NEXT_DIST_DIR: webCiDistDir
    }
  },
  ...(includeLint
    ? [
        {
          label: 'lint',
          command: 'pnpm',
          args: ['lint']
        }
      ]
    : []),
  ...(includeSmoke
    ? [
        {
          label: 'qa smoke',
          command: 'pnpm',
          args: ['qa:smoke']
        }
      ]
    : []),
  ...(includeBrowser
    ? [
        {
          label: 'qa browser smoke',
          command: 'pnpm',
          args: ['qa:browser-smoke']
        }
      ]
    : []),
  ...(includeCriticalE2E
    ? [
        {
          label: 'qa critical e2e',
          command: 'pnpm',
          args: ['qa:critical-e2e']
        }
      ]
    : [])
];

function runStep(index, total, step) {
  console.log(`\n[${index}/${total}] ${step.label}`);
  console.log(`$ ${[step.command, ...step.args].join(' ')}`);

  const result = spawnSync(step.command, step.args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(step.env || {})
    }
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.signal) {
    console.error(`Processo interrompido por sinal: ${result.signal}`);
    process.exit(1);
  }
}

console.log('QA trust gate started.');
console.log(
  `Optional steps: lint=${includeLint ? 'on' : 'off'}, smoke=${includeSmoke ? 'on' : 'off'}, browser=${includeBrowser ? 'on' : 'off'}, criticalE2E=${includeCriticalE2E ? 'on' : 'off'}`
);

steps.forEach((step, index) => runStep(index + 1, steps.length, step));

console.log('\nQA trust gate passed.');
