import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseH11Command } from './h11-ops.ts';

const command = [
  'execute', 'br-anpd-res-18-2024', '/private/example',
  '--confirm-paid-openai', '--max-provider-calls=1',
];

test('H11 CLI requires the frozen first source, the paid confirmation and the one-call cap', () => {
  assert.deepEqual(parseH11Command(command), {
    kind: 'execute', directory: '/private/example', sourceId: 'br-anpd-res-18-2024', maxProviderCalls: 1,
  });
  assert.deepEqual(parseH11Command(['preflight']), { kind: 'preflight' });
  assert.deepEqual(parseH11Command(['dry-run', '/private/example']),
    { kind: 'dry-run', directory: '/private/example' });
  for (const bad of [
    ['execute', 'br-anpd-res-15-2024', ...command.slice(2)],
    ['execute', 'https://arbitrary.invalid', ...command.slice(2)],
    command.slice(0, -1),
    [...command.slice(0, 3), command[4]],
    [...command.slice(0, -1), '--max-provider-calls=2'],
    [...command, '--dsn=arbitrary'],
    ['dry-run', '--bypass'],
  ]) assert.throws(() => parseH11Command(bad), { message: 'H11_COMMAND_INVALID' });
});

test('hosted H11 entrypoint fails closed without the pinned target and explicit project CA', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const script = fileURLToPath(new URL('./h11-ops.ts', import.meta.url));
  const result = spawnSync(process.execPath, ['--experimental-strip-types', script, 'preflight'], {
    env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'H11_HOSTED_TARGET_NOT_CONFIRMED');
});
