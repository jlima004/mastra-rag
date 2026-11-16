import assert from 'node:assert/strict';
import test from 'node:test';
import { SOURCE_MANIFEST } from './manifest.ts';
import { validateSourceManifest, resolveSourceIds } from './validation.ts';

test('fixed corpus contains LGPD and two official DOU resolution references', () => {
  assert.deepEqual(SOURCE_MANIFEST.map(s => s.sourceId).sort(), [
    'br-anpd-res-15-2024', 'br-anpd-res-18-2024', 'br-planalto-lei-13709-2018',
  ]);
  assert.equal(SOURCE_MANIFEST.every(s => s.language === 'pt-BR' && s.tenantId === 'public'), true);
  assert.equal(SOURCE_MANIFEST.every(s => s.expectedMediaTypes.includes('text/html')), true);
});

test('committed manifest passes the runtime contract validator unchanged', () => {
  const validated = validateSourceManifest(SOURCE_MANIFEST);
  assert.deepEqual(validated, SOURCE_MANIFEST);
  assert.equal(resolveSourceIds(['br-planalto-lei-13709-2018'], validated).length, 1);
});

test('amended Resolution 2/2022 and corrected Resolution 19/2024 are explicitly excluded', () => {
  assert.equal(SOURCE_MANIFEST.some(s => /res-(2-2022|19-2024)/.test(s.sourceId)), false);
});
