import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('dev/prod prisma schemas stay aligned', () => {
  const result = spawnSync(process.execPath, ['scripts/check-prisma-schema-drift.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(
    result.status,
    0,
    `schema drift check failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
});
