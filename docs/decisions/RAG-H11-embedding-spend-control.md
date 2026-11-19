# H11 — Embedding spend controls (operator decision package)

**Prepared 2026-11-19; baseline:** `master@58268ece070293143a76ffdda4edce56160cf33e` (H7 PR #30 merged, CI/deploy verified). **State:** `H11_OFFLINE_BUDGET_CONTRACT_READY / BILLING_ACCOUNT_UNVERIFIED / OWNER_NUMBERS_UNRATIFIED / NO_PAID_USE`. The owner requested execution of H11; this authorizes preparation of a Draft PR and offline regressions **only**, not billing changes, purchases, paid embeddings, H12 GC, E2 ingestion or production API key provisioning.

## 1. Technical baseline and boundaries

- Step D already implements `EmbeddingProvider`, lazy `ModelRouterEmbeddingModel('openai/text-embedding-3-small')`, `allowPaidCalls` false by default, per-job token planning and caller-supplied `remainingDailyTokens`. This is **not** a persistent daily quota: independent callers could reset it. The adapter is not registered in `src/mastra/index.ts` or an HTTP route, and hosted `OPENAI_API_KEY` is absent.
- The existing `UTF-8 bytes + 8 per input` envelope is an experimental proxy and is **not** a proved tokenizer count or provider-billing upper bound (H9 open). The existing up-front worst-case reservation includes initial batches plus three possible retries for the entire job, at most 128 chunks/request and `MAX_TOKENS_PER_JOB=2_000_000` hard code ceiling. No E2 durable reservation ledger exists.
- Published **2026-11-19** official model list quotes `text-embedding-3-small` at **USD 0.02 per 1,000,000 input tokens** (non-batch pricing): [model reference](https://developers.openai.com/api/docs/models/text-embedding-3-small). Pure quotes convert exact integer token amounts into micro-USD using bigint arithmetic and round upward. Prices can change; owner reconfirms prior to paid use.
- Official OpenAI [project spend limits](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform): an owner can set monthly spend limits and **Enforce a hard limit** in project Limits. Spend alerts alone do **not** stop traffic. Hard-limit enforcement may lag billing and **is not a zero-overrun guarantee**. Organization/project quotas and rate limits are separate. **Verify the actual charge path first:** the Mastra model router/gateway may select account/provider differently than a raw OpenAI API request. An OpenAI project limit does not prove protection for a different billing route.

## 2. Budget decision proposal — owner must explicitly ratify or adjust

These values are **proposals**, not default production configuration or consent to spend.

| Control | Proposed MVP bound | Semantics |
| --- | --- | --- |
| Billing identity | Dedicated **OpenAI API project** for `text-embedding-3-small`, if this is the actual billed path; otherwise individually adjudicate Mastra gateway billing | Verify own project, payment route and key scope before enabling |
| Provider hard spend limit | **USD 2.00 per calendar month** with **Enforce a hard limit = ON** | Independent provider safety net, approximate enforcement |
| Application project monthly budget | **USD 1.00** projected *embeddings* only | Conservative app budget below provider cap, does not cover unrelated provider usage |
| Application monthly reservation | **5,000,000 token-envelope units** | Durable E2 counter for ingestion + evaluation |
| Daily reservation | **250,000 token-envelope units** | Durable server-side counter, UTC date boundary |
| Per-job reservation | **150,000 token-envelope units**, including worst-case three global retries | Below immutable `MAX_TOKENS_PER_JOB=2,000,000`; refuse oversized jobs upfront |
| Evaluation reservation | **100,000 token-envelope units/month** | Separate sub-budget, also counts toward global monthly/daily limits |
| Alerts | **50%, 80%, 95%** on provider project, if supported | Notification only; not a substitute for hard limit |
| Other models | **Disabled** until separate pricing and model gate | No Google fallback in paid MVP without authorization |

At the published price 5 million tokens would cost about **USD 0.10** for this embedding model, *if* billed at that price. Dollar budget exceeds estimated embedding cost intentionally to accommodate measurement error and other project spend, but is **not an accurate forecast** until the exact tokenizer, billing route, and all key consumers are reconciled.

Owner ratification must identify the billed project and separate (a) configuration of limits, (b) provision of an API key in a private server-side secret, and (c) authorization of each first paid smoke/ingestion action. Approving the Draft PR alone does none of these.

## 3. Offline implementation scope (this PR)

- `src/mastra/rag/embeddings/spend-policy.ts`: **pure quote only** for the single approved model; explicit positive policy fields (no budget defaults), validated snapshot values, worst-case token reservation, daily/monthly/evaluation checks and upward-rounded integer micro-USD conversion. Uses existing sanitized `EMBED_INVALID_INPUT` / `EMBED_BUDGET_EXCEEDED` codes; neither imports the provider nor reads credentials.
- `spend-policy.test.ts`: price arithmetic, inclusive boundaries, invalid policy/snapshot/space, daily/monthly/evaluation compartment, zero work, cost and token independent ceilings.
- Tests are offline. The quote **neither reserves any database resource nor verifies provider settings**, and using a caller-provided snapshot in production would be insecure. No new dependency, API endpoint, secret or paid-call opt-in is added.

## 4. Required future durable E2 admission (not implemented here)

Before *any* paid call, design a hosted atomic ledger with one server-authoritative budget scope and UTC day/month epochs. The caller MUST NOT provide `remainingDailyTokens` as authoritative capacity. Required protocol:

1. Verify the dedicated billed project, provider-enforced hard limit and permitted model/pricing; application owner must have separately authorized a paid operation and current provider spend status.
2. After H9 tokenizer calibration, compute preflight missing-chunk set and reserve the **whole job's** initial + worst-case retry envelope; reject when *any* daily, monthly, evaluation or dollar bound would overflow. Serialize across concurrent jobs (transactional lock/advisory lock + ledger in PostgreSQL/Turso with explicit ownership). Request identity/idempotency prevents duplicate reservations.
3. Persist reservation **before** calling the provider. On success/failure, record attempt count and usage; treat unknown/billed-on-error usage conservatively and reconcile with provider reports. Do not auto-release uncertain charges; handle crash/restart as a pending reservation requiring operator inspection.
4. Require provider key only server-side and only after explicit human paid-call authorization; never log raw content, key, token or upstream error. Abort on cap/429/5xx without bypassing `Retry-After`.
5. Query and evaluation costs must share the correct same ledger; hard provider limit protects billing across all processes. Persist UTC periods and retained reservations so process restarts cannot reset budget.
6. Evidence: concurrent admission tests, replay/crash recovery, 429 billed-unknown and bounded retry tests against fake provider, provider/project hard-limit screenshots or owner-verified receipt **without keys**. No CI live calls. Optional manual paid smoke requires another explicit approval.

The **current H11 PR does not implement these requirements** and therefore must not be used to open E2.

## 5. Owner operational handoff (no secret sharing)

- Open [OpenAI API projects](https://platform.openai.com/settings/organization/projects) and identify the dedicated project; in its Limits page inspect Monthly spend limit, **Enforce a hard limit**, and usage alerts. Never infer hard limit from a soft budget screenshot.
- If Mastra gateway is the actual payer, inspect **Mastra Gateway spend limits and charge ownership** instead. Do not install a new secret or configure the wrong provider based on model names alone.
- Do not reintroduce `OPENAI_API_KEY` to Mastra production until project, hard cap, owner ratification and billing path are confirmed. Keep `allowPaidCalls` false and no embedding route registered.
- Record in the PR only: project alias (non-secret), billable provider, currency, hard-limit amount and enabled/disabled state, daily/monthly quotas, date/time of operator verification; **never** account IDs or key values unless specifically approved.
- Stop if cap controls unsupported, unknown organization vs gateway payer, H9 tokenizer still uncalibrated, source texts still unverified, or pending H12 retention.

**Required next decision:** owner reviews/ratifies numeric H11 budget and selects verified billing route; deploy/provider configuration and first paid call remain distinct execution gates. **State:** `H11_OFFLINE_PREPARATION / PROVIDER_CAP_NOT_VERIFIED / H9_PENDING / H12_PENDING / E2_BLOCKED`.
