import { registerApiRoute } from '@mastra/core/server';
import {
  createDurabilityProbe,
  deleteDurabilityProbe,
  isProbeEnabled,
  isProbeId,
  readDurabilityProbe,
} from './turso-probe.ts';

async function memoryFromContext(c: Parameters<NonNullable<Parameters<typeof registerApiRoute>[1]['handler']>>[0]) {
  const storage = c.get('mastra').getStorage();
  const memory = await storage?.getStore('memory');
  if (!memory) throw new Error('Memory storage unavailable');
  // Initialize only the native memory domain on first probe use; this may
  // create Mastra-owned memory tables, but never touches Supabase or other domains.
  await memory.init();
  return memory;
}

/**
 * Routes are authenticated by the existing Mastra SimpleAuth middleware,
 * disabled by default, and usable only with a remote Turso URL. They accept
 * no user-supplied SQL, table names, record values or arbitrary thread IDs.
 * Never return underlying driver errors.
 */
export const tursoDurabilityCreateRoute = registerApiRoute('/internal/durability/turso/create', {
  method: 'POST',
  requiresAuth: true,
  handler: async c => {
    if (!isProbeEnabled()) return c.json({ status: 'disabled' }, 404);
    try {
      const receipt = await createDurabilityProbe(await memoryFromContext(c));
      return c.json({ status: 'created', ...receipt }, 201);
    } catch {
      return c.json({ status: 'unavailable' }, 503);
    }
  },
});

export const tursoDurabilityReadRoute = registerApiRoute('/internal/durability/turso/read', {
  method: 'GET',
  requiresAuth: true,
  handler: async c => {
    if (!isProbeEnabled()) return c.json({ status: 'disabled' }, 404);
    const id = c.req.query('id');
    if (!isProbeId(id)) return c.json({ status: 'invalid_id' }, 400);
    try {
      const receipt = await readDurabilityProbe(await memoryFromContext(c), id);
      return receipt
        ? c.json({ status: 'found', ...receipt }, 200)
        : c.json({ status: 'not_found' }, 404);
    } catch {
      return c.json({ status: 'unavailable' }, 503);
    }
  },
});

export const tursoDurabilityDeleteRoute = registerApiRoute('/internal/durability/turso/delete', {
  method: 'DELETE',
  requiresAuth: true,
  handler: async c => {
    if (!isProbeEnabled()) return c.json({ status: 'disabled' }, 404);
    const id = c.req.query('id');
    if (!isProbeId(id)) return c.json({ status: 'invalid_id' }, 400);
    try {
      const removed = await deleteDurabilityProbe(await memoryFromContext(c), id);
      return removed
        ? c.json({ status: 'deleted' }, 200)
        : c.json({ status: 'not_found' }, 404);
    } catch {
      return c.json({ status: 'unavailable' }, 503);
    }
  },
});
