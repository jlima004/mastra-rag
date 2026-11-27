import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RagEmbeddingError } from './errors.ts';

const KEY = 'synthetic-h11-credential';
const MODEL = 'text-embedding-3-small';
const URL = 'https://api.openai.com/v1/embeddings';
const signal = new AbortController().signal;
const options = { signal, purpose: 'document' } as const;
const vector = Array<number>(1536).fill(0.125);
const row = (index: number, values = vector) => ({ object: 'embedding', index, embedding: values });
const payload = (data: unknown[] = [row(0)], tokens = 3) => ({
  object: 'list', model: MODEL, data, usage: { prompt_tokens: tokens, total_tokens: tokens },
});

test('direct OpenAI transport contract', async t => {
  const original = process.env.OPENAI_API_KEY;
  const oldBase = process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_API_KEY;
  t.after(() => {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
    if (oldBase === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = oldBase;
  });

  let calls = 0;
  let reply: (request: RequestInit) => Promise<Response> = async () => assert.fail('unexpected fetch');
  t.mock.method(globalThis, 'fetch', async (url: string, request: RequestInit & { duplex: string }) => {
    calls++;
    assert.equal(url, URL);
    assert.equal(request.method, 'POST');
    assert.equal(request.redirect, 'error');
    assert.equal(request.duplex, 'half');
    assert.equal(new Headers(request.headers).get('authorization'), `Bearer ${KEY}`);
    assert.ok(request.body instanceof ReadableStream);
    return reply(request);
  });

  const { createOpenAIEmbeddingProvider, hasOpenAIEmbeddingCredential } = await import('./openai.ts');
  const disabled = createOpenAIEmbeddingProvider();
  const provider = createOpenAIEmbeddingProvider({ allowPaidCalls: true });
  assert.equal(hasOpenAIEmbeddingCredential(), false);
  await assert.rejects(provider.embed(['synthetic'], options), { code: 'EMBED_CREDENTIAL_UNAVAILABLE' });
  process.env.OPENAI_API_KEY = KEY;
  process.env.OPENAI_BASE_URL = 'https://must-not-be-used.invalid';
  assert.equal(hasOpenAIEmbeddingCredential(), true);
  await assert.rejects(disabled.embed(['synthetic'], options), { code: 'EMBED_PAID_NOT_AUTHORIZED' });
  await assert.rejects(provider.embed([' input'.repeat(513)], options), { code: 'EMBED_INVALID_INPUT' });
  await assert.rejects(provider.embed(['a'], { ...options, signal: AbortSignal.abort() }), { code: 'EMBED_ABORTED' });
  assert.equal(calls, 0);

  reply = async request => {
    assert.deepEqual(await new Response(request.body).json(), {
      model: MODEL, input: ['first', 'second'], dimensions: 1536, encoding_format: 'float',
    });
    return Response.json(payload([row(1, vector.map(value => -value)), row(0)]));
  };
  const result = await provider.embed(['first', 'second'], options);
  assert.deepEqual(result, { vectors: [vector, vector.map(value => -value)], usage: { tokens: 3 } });
  assert.equal(calls, 1);

  for (const [response, code, known, retryAfter] of [
    [Response.json(payload([row(0, [1])])), 'EMBED_DIMENSION_MISMATCH', 3, null],
    [new Response(JSON.stringify(payload()).replace('0.125', '1e999')), 'EMBED_NONFINITE_VECTOR', 3, null],
    [Response.json(payload([row(1)])), 'EMBED_PROVIDER_FAILURE', 3, null],
    [Response.json({ ...payload(), model: 'other' }), 'EMBED_PROVIDER_FAILURE', 3, null],
    [Response.json({ ...payload(), usage: undefined }), 'EMBED_USAGE_INVALID', null, null],
    [Response.json(payload(undefined, 0)), 'EMBED_USAGE_INVALID', null, null],
    [new Response('invalid JSON and credential ' + KEY), 'EMBED_PROVIDER_FAILURE', null, null],
    [new Response('x'.repeat(8 * 1024 * 1024 + 1)), 'EMBED_PROVIDER_FAILURE', null, null],
    [new Response(KEY, { status: 401 }), 'EMBED_PROVIDER_FAILURE', null, null],
    [new Response(KEY, { status: 403 }), 'EMBED_PROVIDER_FAILURE', null, null],
    [new Response(null, { status: 302, headers: { location: 'https://never.invalid/' } }), 'EMBED_PROVIDER_FAILURE', null, null],
    [new Response(null, { status: 421 }), 'EMBED_PROVIDER_FAILURE', null, null],
    [new Response(KEY, { status: 429, headers: { 'Retry-After': '2' } }), 'EMBED_PROVIDER_TRANSIENT', null, 2000],
    [Response.json({ error: { code: 'project_spend_limit_exceeded' } }, { status: 429 }), 'EMBED_PROVIDER_FAILURE', null, null],
    [new Response(KEY, { status: 503, headers: { 'Retry-After': '1' } }), 'EMBED_PROVIDER_TRANSIENT', null, 1000],
  ] as const) {
    const before: number = calls;
    reply = async () => response;
    await assert.rejects(provider.embed(['fixture'], options), (error: unknown) => {
      assert.ok(error instanceof RagEmbeddingError);
      assert.equal(error.code, code);
      assert.equal(error.message, code);
      assert.equal(error.retryAfterMs, retryAfter);
      assert.equal(error.reportedTokens, known);
      assert.doesNotMatch(JSON.stringify(error), /synthetic-h11-credential/);
      return true;
    });
    assert.equal(calls, before + 1);
  }

  reply = async () => { throw new Error(KEY); };
  await assert.rejects(provider.embed(['a'], options), { code: 'EMBED_PROVIDER_FAILURE', message: 'EMBED_PROVIDER_FAILURE' });
  await assert.rejects(provider.embed(new Array(129).fill('a'), options), { code: 'EMBED_INVALID_INPUT' });

  reply = async () => Response.json(payload([row(0), row(0)]));
  await assert.rejects(provider.embed(['a', 'b'], options), { code: 'EMBED_PROVIDER_FAILURE', reportedTokens: 3 });

  const caller = new AbortController();
  reply = async () => {
    caller.abort(KEY);
    return Response.json(payload());
  };
  await assert.rejects(provider.embed(['a'], { ...options, signal: caller.signal }), { code: 'EMBED_ABORTED' });

  const timeout = new AbortController();
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    assert.equal(ms, 25_000);
    return timeout.signal;
  });
  reply = async request => {
    timeout.abort(KEY);
    request.signal?.throwIfAborted();
    assert.fail('timeout was ignored');
  };
  await assert.rejects(provider.embed(['a'], options), { code: 'EMBED_ABORTED' });
});


test('installed legacy Router accepts an endpoint override with the same bearer token', async t => {
  const previous = process.env;
  process.env = {
    ...previous, OPENAI_API_KEY: KEY, MASTRA_GATEWAY_API_KEY: 'synthetic-unused-gateway-key',
    MASTRA_GATEWAY_URL: 'https://unused-gateway.invalid',
  };
  delete process.env.OPENAI_BASE_URL;
  t.after(() => { process.env = previous; });
  const observed: string[] = [];
  let status = 200;
  t.mock.method(globalThis, 'fetch', async (url: string, request: RequestInit) => {
    observed.push(url);
    assert.equal(new Headers(request.headers).get('authorization'), `Bearer ${KEY}`);
    return status === 200 ? Response.json(payload()) : Response.json({ error: {} }, { status });
  });
  const { ModelRouterEmbeddingModel } = await import('@mastra/core/llm');
  const direct = new ModelRouterEmbeddingModel('openai/text-embedding-3-small');
  const result = await direct.doEmbed({ values: ['fixture'] });
  assert.equal(result.usage?.tokens, 3);
  status = 429;
  await assert.rejects(direct.doEmbed({ values: ['fixture'] }));
  assert.deepEqual(observed, [URL, URL]);
  status = 200;
  process.env.OPENAI_BASE_URL = 'https://synthetic-override.invalid/v1';
  const override = new ModelRouterEmbeddingModel('openai/text-embedding-3-small');
  await override.doEmbed({ values: ['fixture'] });
  delete process.env.OPENAI_API_KEY;
  assert.throws(() => new ModelRouterEmbeddingModel('openai/text-embedding-3-small'), /OPENAI_API_KEY/);
  assert.deepEqual(observed, [URL, URL, 'https://synthetic-override.invalid/v1/embeddings']);
});

test('native fetch sends the non-replayable request once on 421 and refuses redirects', async t => {
  const { createServer } = await import('node:http');
  const { once } = await import('node:events');
  const nativeFetch = fetch;
  const hits: string[] = [];
  let status = 421;
  const server = createServer(async (req, res) => {
    hits.push(req.url!);
    for await (const _ of req) { /* Drain only the test body. */ }
    res.writeHead(status, { location: '/redirect-target' });
    res.end();
  }).listen(0, '127.0.0.1');
  t.after(() => { server.close(); server.closeAllConnections(); });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.mock.method(globalThis, 'fetch', (url: string, request: RequestInit) => {
    assert.equal(url, URL);
    return nativeFetch(`http://127.0.0.1:${address.port}/embeddings`, request);
  });
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = KEY;
  t.after(() => {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  });
  const { createOpenAIEmbeddingProvider } = await import('./openai.ts');
  const provider = createOpenAIEmbeddingProvider({ allowPaidCalls: true });
  await assert.rejects(provider.embed(['fixture'], options), { code: 'EMBED_PROVIDER_FAILURE' });
  assert.deepEqual(hits, ['/embeddings']);
  status = 307;
  await assert.rejects(provider.embed(['fixture'], options), { code: 'EMBED_PROVIDER_FAILURE' });
  assert.deepEqual(hits, ['/embeddings', '/embeddings']);

  const previous = process.env.NODE_USE_ENV_PROXY;
  process.env.NODE_USE_ENV_PROXY = '1';
  t.after(() => {
    if (previous === undefined) delete process.env.NODE_USE_ENV_PROXY;
    else process.env.NODE_USE_ENV_PROXY = previous;
  });
  await assert.rejects(provider.embed(['fixture'], options), { code: 'EMBED_TRANSPORT_CONFIG_INVALID' });
  assert.deepEqual(hits, ['/embeddings', '/embeddings']);
});
