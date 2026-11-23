# H11 — Embedding spend controls (operator decision package)

**Prepared 2026-11-19; baseline:** `master@58268ece070293143a76ffdda4edce56160cf33e` (H7 PR #30 merged, CI/deploy verified). H11 was originally prepared as an **offline-only Draft PR** with no permission to call a paid provider. **Later decisions:** the owner ratified the numerical policy and approved paid embeddings **charged directly to their OpenAI API account** on 2026-11-19; on 2026-11-23, the owner supplied UI evidence of a dedicated project, active billing and provider controls (tracked in [Issue #32](https://github.com/jlima004/mastra-rag/issues/32)). Neither decision enables paid execution without the remaining application gates. **Current state:** `H11_NUMERICS_RATIFIED / PROVIDER_SETUP_OWNER_UI_VERIFIED / BILLING_ROUTE_UNPROVEN / H9_H12_E2_PENDING / PAID_EXECUTION_BLOCKED`.

## 1. Technical baseline and boundaries

- Step D already implements `EmbeddingProvider`, lazy `ModelRouterEmbeddingModel('openai/text-embedding-3-small')`, `allowPaidCalls` false by default, per-job token planning and caller-supplied `remainingDailyTokens`. This is **not** a persistent daily quota: independent callers could reset it. The adapter is not registered in `src/mastra/index.ts` or an HTTP route; no production key provisioning is established by this PR (the original H11 preparation recorded hosted `OPENAI_API_KEY` as absent).
- The existing `UTF-8 bytes + 8 per input` envelope is an experimental proxy and is **not** a proved tokenizer count or provider-billing upper bound (H9 open). The existing up-front worst-case reservation includes initial batches plus three possible retries for the entire job, at most 128 chunks/request and `MAX_TOKENS_PER_JOB=2_000_000` hard code ceiling. No E2 durable reservation ledger exists.
- Published **2026-11-19** official model list quotes `text-embedding-3-small` at **USD 0.02 per 1,000,000 input tokens** (non-batch pricing): [model reference](https://developers.openai.com/api/docs/models/text-embedding-3-small). Pure quotes convert exact integer token amounts into micro-USD using bigint arithmetic and round upward. Prices can change; owner reconfirms prior to paid use.
- Official OpenAI [project spend limits](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform): an owner can set monthly spend limits and **Enforce a hard limit** in project Limits. Spend alerts alone do **not** stop traffic. Hard-limit enforcement may lag billing and **is not a zero-overrun guarantee**. Organization/project quotas and rate limits are separate. **Verify the actual charge path first:** the Mastra model router/gateway may select account/provider differently than a raw OpenAI API request. An OpenAI project limit does not prove protection for a different billing route.

## 2. Owner-ratified MVP budget — 2026-11-19

**All numerical values below were explicitly ratified by the owner on 2026-11-19**, along with paid-embedding consent for their **directly billed OpenAI API account**. This is a financial decision, **not** executable production configuration or permission to bypass live-call gates. Provider controls listed as verified were confirmed by **owner-supplied UI evidence on 2026-11-23**, not by a live API request. See [H11-OPS Issue #32](https://github.com/jlima004/mastra-rag/issues/32).

| Control | Ratified MVP bound | Semantics |
| --- | --- | --- |
| Billing identity | Dedicated owner-controlled **OpenAI API project `Rag-Mastra`**, direct OpenAI API billing only, `text-embedding-3-small` | Project existence verified by owner UI; **actual Mastra runtime billing route and scoped API key still unproven**. Mastra Gateway charges are not authorized. |
| Provider hard spend limit | **USD 2.00 per calendar month**, **Limit enforced** | Verified by owner UI on 2026-11-23; independent provider safety net with noninstantaneous enforcement, **not** a strict zero-overrun guarantee |
| Application project monthly budget | **USD 1.00** projected *embeddings* only | Conservative app budget below provider cap, does not cover unrelated provider usage |
| Application monthly reservation | **5,000,000 token-envelope units** | Durable E2 counter for ingestion + evaluation |
| Daily reservation | **250,000 token-envelope units** | Durable server-side counter, UTC date boundary |
| Per-job reservation | **150,000 token-envelope units**, including worst-case three global retries | Below immutable `MAX_TOKENS_PER_JOB=2,000,000`; refuse oversized jobs upfront |
| Evaluation reservation | **100,000 token-envelope units/month** | Separate sub-budget, also counts toward global monthly/daily limits |
| Alerts | **50%, 80%, 95%** on the dedicated OpenAI API project | Configured and verified by owner UI on 2026-11-23; notification only, not enforcement |
| Other models | **Blocked** at project allowlist; only `text-embedding-3-small` allowed | Verified by owner UI on 2026-11-23; no other paid model or Google fallback approved |

At the published price 5 million tokens would cost about **USD 0.10** for this embedding model, *if* billed at that price. Dollar budget exceeds estimated embedding cost intentionally to accommodate measurement error and other project spend, but is **not an accurate forecast** until the exact tokenizer, billing route, and all key consumers are reconciled.

The owner's **budget and paid-use consent is recorded**, and the project limit, model allowlist, alerts, and active **Pay as you go** billing with **auto-reload OFF** were evidenced in the owner UI on 2026-11-23. Do not publish balance/payment details or project identifiers. Remaining distinct gates are (a) proving the exact billed runtime route, (b) privately provisioning a project-scoped server-side key with separate release approval, (c) H9/H12 and durable E2 enforcement, and (d) separately scoping the **first live paid smoke**. No such operation is authorized merely by merging this PR.

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

- **Completed (owner UI, 2026-11-23):** [OpenAI API project](https://platform.openai.com/settings/organization/projects) `Rag-Mastra` exists; its Limits page shows **USD 2/month, Limit enforced**, 50/80/95% alerts and the single-model allowlist; organization billing shows active **Pay as you go**, **auto-reload OFF**. These screenshots prove displayed settings, **not** billable runtime routing or atomic app limits.
- **Not completed:** independently verify that the pinned Mastra model router and actual deployed runtime use the project-scoped OpenAI API credential and are billed **directly to the approved OpenAI API project**. Reject Mastra Gateway billing, unknown aliases, alternative base URLs and fallback instead of silently changing the authorized payer.
- Do not provision `OPENAI_API_KEY` to Mastra production until **direct billing route, scoped key custody and the separate controlled release** are approved. Keep `allowPaidCalls` false and no embedding route registered. Provider settings alone do not unlock E2, H9, H12 or the first paid smoke.
- Record only non-sensitive project alias, chosen provider, currency, limits and owner-UI verification date in PR/Issue #32; **never** account IDs, payment details, balances, raw secret values or screenshots containing private data.
- Stop if cap controls unsupported, unknown organization vs gateway payer, H9 tokenizer still uncalibrated, source texts still unverified, or pending H12 retention.

**Remaining gates:** prove direct OpenAI API billing via the pinned runtime and scoped key, satisfy H9 measured tokenizer/source validation, ratify H12 retention/erasure, implement/test E2 atomic durable quotas, and separately authorize credential provisioning and the first bounded paid smoke. **State:** `H11_NUMERICS_RATIFIED / PROVIDER_SETUP_OWNER_UI_VERIFIED / BILLING_ROUTE_UNPROVEN / APPLICATION_BUDGET_NOT_DURABLE / H9_H12_E2_PENDING / PAID_EXECUTION_BLOCKED`. **No paid call, merge or deploy is implied.**
