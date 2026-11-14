import { resolve } from 'node:path';
import { LibSQLStore } from '@mastra/libsql';
import { isMastraPlatform } from '../security/server-auth.ts';

export type StorageEnvironment = Readonly<{
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
  MASTRA_PROJECT_ID?: string;
  MASTRA_ENVIRONMENT_ID?: string;
}>;

export function resolveRuntimeStorage(environment: StorageEnvironment = process.env): {
  url: string;
  authToken?: string;
} {
  const platform = isMastraPlatform(environment);
  const url = environment.TURSO_DATABASE_URL?.trim();
  const authToken = environment.TURSO_AUTH_TOKEN?.trim();

  if (!url) {
    if (platform) throw new Error('The managed Turso database URL is required on Mastra Platform.');
    if (authToken) throw new Error('TURSO_AUTH_TOKEN requires TURSO_DATABASE_URL.');
    return { url: `file:${resolve(process.cwd(), 'mastra.db')}` };
  }

  if (url.startsWith('file:')) {
    if (platform) throw new Error('Mastra Platform cannot use local file storage.');
    if (authToken) throw new Error('Do not use a Turso token with local file storage.');
    return { url };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('TURSO_DATABASE_URL must be a valid URL.');
  }

  if (
    !['libsql:', 'https:', 'wss:'].includes(parsed.protocol) ||
    !parsed.hostname || parsed.username || parsed.password || parsed.hash
  ) {
    throw new Error('TURSO_DATABASE_URL must be a secure remote database endpoint.');
  }
  if (!authToken) throw new Error('TURSO_AUTH_TOKEN is required for remote Turso.');

  return { url, authToken };
}

export function createRuntimeStorage(environment: StorageEnvironment = process.env): LibSQLStore {
  return new LibSQLStore({ id: 'mastra-runtime-storage', ...resolveRuntimeStorage(environment) });
}
