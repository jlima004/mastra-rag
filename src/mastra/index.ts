import { Mastra } from '@mastra/core/mastra';
import { createServerAuth } from './security/server-auth.ts';
import { createRuntimeStorage } from './storage/runtime-storage.ts';
import { supabaseReadinessRoute } from './readiness/supabase-readiness.ts';

export const mastra = new Mastra({
  // Turso persists runtime state; Supabase pgvector remains independent.
  storage: createRuntimeStorage(),
  server: {
    auth: createServerAuth(),
    apiRoutes: [supabaseReadinessRoute],
  },
});
