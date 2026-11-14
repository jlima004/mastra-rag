import { SimpleAuth } from '@mastra/core/server';

export type AuthEnvironment = Readonly<{
  RAG_SERVER_API_TOKEN?: string;
  MASTRA_PROJECT_ID?: string;
  MASTRA_ENVIRONMENT_ID?: string;
}>;

export function isMastraPlatform(environment: AuthEnvironment): boolean {
  return Boolean(environment.MASTRA_PROJECT_ID || environment.MASTRA_ENVIRONMENT_ID);
}

export function resolveServerToken(environment: AuthEnvironment = process.env): string | undefined {
  const token = environment.RAG_SERVER_API_TOKEN;
  if (token && (token !== token.trim() || token.length < 32)) {
    throw new Error('RAG_SERVER_API_TOKEN must have at least 32 characters and no surrounding whitespace.');
  }
  if (isMastraPlatform(environment) && !token) {
    throw new Error('Configure RAG_SERVER_API_TOKEN before starting on Mastra Platform.');
  }
  return token;
}

/** No anonymous fallback: a missing local token maps to zero valid credentials. */
export function createServerAuth(environment: AuthEnvironment = process.env) {
  const token = resolveServerToken(environment);
  return new SimpleAuth({
    tokens: token ? { [token]: { id: 'rag-operator', name: 'RAG operator', role: 'admin' } } : {},
  });
}
