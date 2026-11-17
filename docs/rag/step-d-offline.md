# RAG10 — Step D embedding contracts and offline evidence

**Status:** PR #10 Draft, offline code only. **No paid calls, no DB writes, no deployment approval.**

## Scope

The implementation is isolated in [src/mastra/rag/embeddings](../../src/mastra/rag/embeddings/).
It is NOT registered in `src/mastra/index.ts`, any public/internal HTTP route,
Mastra Agent, Tool or Workflow. Nothing automatically constructs or calls the
model during normal application startup or tests.

| Capability | Offline contract | Evidence boundary |
| --- | --- | --- |
| Space registry | `chunks_te3s_1536_v1`, OpenAI text-embedding-3-small, 1,536 dimensions, cosine/vector/version 1; status `building` | In-memory registry only, not an active PgVector space or published pointer |
| Native Mastra adapter | Lazy dynamic import/constructor of `ModelRouterEmbeddingModel`, `doEmbed({ values, abortSignal })`; fake model injected in tests | **Real provider calls disabled by default**; no API key or paid usage |
| Validation | Number of vectors equals input count, every vector exactly 1,536 finite numbers, valid integer token usage | Rejects entire invalid batch before any persistence |
| Planning | Deterministic missing-ID filtering, ≤128 inputs per call, 2,000 chunk cap; pure preflight | Real resume queries and mandatory namespace belong to Step E2 |
| Cost envelope | UTF-8 byte count + 8 per input; job and caller-supplied daily cap ≤2M; upfront reservation for initial batches + 3 possible retries | **Not** a real `cl100k_base` token count, nor a verified billing ceiling |
| Retries | Four attempts globally per job, not four per batch; exponential backoff with full jitter, `Retry-After` support and 30s cap | Fake 429/5xx and injected sleep only; long provider-mandated delays fail closed |
| Safety | Abort before/between calls, sanitized fixed error codes, no raw upstream causes or chunk text logs | No production call path or database mutations |

### Exact bounds and semantics

For `B = ceil(missing_chunks / min(provider.maxInputsPerCall, 128))`,
the offline executor performs at most **B + 3** provider calls in one
in-memory execution (the three retries are **global**, not per batch).
Before starting, it checks the token reservation

`sum(batch_byte_envelopes) + 3 × max(batch_byte_envelope)`

against the job limit and remaining daily allowance, then reserves again
on **every** attempt, even if the provider returns 429 or 5xx.
If there are no missing chunks, no call or budget reservation occurs.
The response reports integer token usage, attempted calls and reserved
budget separately. No partially validated result is made available on failure.

The byte envelope is intentionally conservative relative to typical byte-pair
encoding but is **not an independently proven bound on provider accounting**.
Real embeddings must remain blocked until H9 approves exact tokenizer
semantics and H11 approves provider-side hard limits, retry budget and account.

### Security

The default adapter raises `EMBED_PAID_NOT_AUTHORIZED` before importing
Mastra's router and before touching any secret. Tests inject a local
`doEmbed` object. A future live caller must opt in explicitly after H11,
and must never register a public embedding endpoint.
Any raw upstream exception is converted to a stable error code; it is not
attached as `cause` or logged.

The repository's authenticated Supabase-readiness and Turso-durability
smoke tests must continue to run with **no OPENAI_API_KEY**.

## Outstanding human gates

1. **H11 billing/production spending:** approve provider account, hard
   provider-side ceiling, daily cap and evaluation allowance; do not
   infer permission from the adapter's ability to opt in.
2. **H9 tokenizer:** approve an exact installed tokenizer and measure tokens
   against approved legal fixtures; reject inputs above provider per-item
   limits. No tokenizer package installed in this PR.
3. **Step C official source:** verify current LGPD/ANPD snapshots and parser
   compatibility before embedding legally meaningful documents.
4. **H4/H5/H6/H10 and Step E:** review and apply catalog/space migrations
   and secrets/role restrictions separately. No DDL/upsert in Step D.
5. **PR review and human merge:** obtain exact-HEAD CI, independent Codex
   review with no open P0/P1/P2, and explicit owner authorization.

No credentials, billed usage, API calls, Supabase/Turso writes or deployment
are authorized by this document.
