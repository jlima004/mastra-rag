# H11-OPS — Primeira ingestão vetorial controlada

A CLI usa o catálogo E2, o perfil S512 e o endpoint fixo `POST https://api.openai.com/v1/embeddings` com `text-embedding-3-small`, 1536 dimensões e até 128 entradas. O primeiro comando pago aceita somente `br-anpd-res-18-2024`, com uma tentativa e zero retries. O responsável deve aprovar separadamente a credencial, a ativação e esta execução.

## Projeto OpenAI e credencial

Na organização correta, abra o projeto **Rag-Mastra → Limits**. Confirme **USD 2/mês** com **Limit enforced**, alertas de **50%, 80%, 95%** e permissão apenas para **text-embedding-3-small**. Confirme **Pay as you go** e **Auto-reload OFF** em Billing. A configuração foi evidenciada pelo proprietário em 23/11/2026. Alertas notificam. O limite aplicado pode retornar 429 após atingir o gasto contabilizado, com atraso de propagação que permite pequeno excesso. Confirme também preço e limites atuais antes da chamada. As referências consultadas em 27/11/2026 indicam USD 0,02 por milhão de tokens e limites de 8.192 por entrada, 2.048 entradas e 300.000 tokens por requisição. [Modelo](https://developers.openai.com/api/docs/models/text-embedding-3-small) · [Embeddings](https://developers.openai.com/api/reference/resources/embeddings/methods/create) · [Limites](https://developers.openai.com/api/docs/guides/spend-limits).

Após aprovação, crie uma chave no projeto **Rag-Mastra**, preferencialmente de uma conta de serviço do projeto, com permissão **Restricted**, escrita somente para Embeddings e demais permissões em **None**. Confira o projeto escolhido na tela de criação. Guarde em cofre aprovado. Injete `OPENAI_API_KEY` exclusivamente no ambiente do processo operador. Use uma sessão privada e desabilite tracing de shell. Evite chat, argumentos, histórico, arquivos versionados, CI, logs e bundle. O preflight informa apenas se a credencial está presente. A identidade vem da custódia do projeto e a atribuição de uso será conferida depois da chamada. [Chaves e permissões de projeto](https://help.openai.com/en/articles/9186755-managing-your-work-in-platform-with-projects).

## Preflight e dry-run

Use o checkout revisado, Node **22.13+** ou **24**, e dependências do lockfile. Na sessão privada, disponibilize `POSTGRES_CONNECTION_STRING` com o [session pooler TLS da role rag_app](e1-runtime-dsn-readonly.md) e `SUPABASE_CA_CERT_BASE64` do projeto. Use verificação TLS e ambiente sem proxy nativo habilitado no Node. Confirme o project ref em Supabase → **Rag-Mastra → Connect** e exporte `H11_SUPABASE_PROJECT_REF` com esse valor. Defina `H11_SNAPSHOT_DIR` com o diretório privado que contém os dois pares originais.

```sh
npm run rag:h11:ops -- preflight
npm run rag:h11:ops -- dry-run "$H11_SNAPSHOT_DIR"
```

As duas operações usam consultas de leitura. O dry-run valida recibos, hashes, identidades e contexto renderizado, consulta a projeção e estima reserva e custo com a posição atual do ledger. Em um banco vazio, espere 40 chunks / 9.863 tokens / 39.452 reservados para a Resolução 15, e 25 / 5.034 / 20.136 para a Resolução 18. `building` e chave ausente são pendências operacionais. Investigue orçamento indisponível, tentativa ambígua, overage, job bloqueado e divergência do catálogo antes de continuar.

## Ativação administrativa

Após aprovação específica, confirme em **Connect → Direct connection** o projeto `mastra-rag`, o host `db.lmocjhpajhxegzobydau.supabase.co`, o banco `postgres` e a porta 5432. Obtenha a CA desse projeto, confira o histórico aplicado (incluindo `20261127135647`) e use um host operador com acesso à conexão direta. A sessão administrativa usa a CA local indicada por `H11_SUPABASE_CA_FILE` e prompt privado de senha.

```sh
env -u PGHOSTADDR PGSSLMODE=verify-full PGSSLROOTCERT="$H11_SUPABASE_CA_FILE" \
  psql -X -W -h db.lmocjhpajhxegzobydau.supabase.co -p 5432 -U postgres -d postgres \
  -f db/operator/h11_activate_embedding_space_candidate.sql
```

O SQL confirma a conexão, a migração, as políticas, a projeção e a ausência de outro espaço ativo. O único resultado do postflight deve ser `chunks_te3s_1536_v1`, OpenAI, `text-embedding-3-small`, versão 1, 1536, `cosine`, `vector`, `active`. Em seguida rode novamente o preflight e o dry-run como `rag_app`.

## Primeira execução paga

Após autorização humana específica, confirme espaço `active`, credencial presente, orçamento disponível, ausência de tentativas ambíguas e Resolução 18 com **25 chunks ausentes**, **5.034 tokens**, **1 lote** e **20.136 tokens reservados**. A estimativa da chamada é **USD 0,00010068** e a da reserva é **USD 0,00040272**, antes do arredondamento em micro-USD.

```sh
npm run rag:h11:ops -- execute br-anpd-res-18-2024 "$H11_SNAPSHOT_DIR" \
  --confirm-paid-openai --max-provider-calls=1
```

A CLI refaz o preflight, e o E2 registra a reserva e a tentativa antes do dispatch. A reserva conserva a margem H11. Para esta operação o E2 termina após a primeira tentativa, mesmo diante de 429 ou 5xx. O processo pode falhar depois de enviar a requisição. Em caso de falha, inspecione o ledger antes de nova ação.

## Postflight e reconciliação

- Confirme `published` no resultado e o mesmo `documentId`, `chunkSetId` e `jobId` no catálogo. Use o acesso de leitura aprovado para verificar `rag.ingestion_job` em `succeeded`, `rag.index_build` em `published` com `embedded_count=25` e um apontador `rag.document_publication` para o chunk set.
- Confirme uma tentativa `succeeded` para o job em `rag.embedding_attempt`, com `attempt_number=1`, modelo por meio de `rag.embedding_reservation.model_id`, usage reportado e `reported_tokens <= reserved_tokens` da tentativa. A reserva deve estar fechada e manter o consumo contabilizado em `exposure_tokens` e `held_tokens`. Na projeção, conte 25 `vector_id` distintos do chunk set, todos em `public` e com `extensions.vector_dims(embedding)=1536`.
- Correlacione a janela UTC, projeto **Rag-Mastra**, chave provisionada, modelo e uso no painel de Usage da OpenAI quando seus registros estiverem atualizados. Se a atribuição permanecer incerta, suspenda o segundo documento. A confirmação exige evidência do provedor. [Painel de Usage](https://help.openai.com/en/articles/10478918-api-usage-dashboard).
- Para timeout, abort, erro de persistência, resultado ambíguo ou overage, preserve o job e a tentativa. Não reenvie a primeira chamada. Compare usage e exposição preservada e encaminhe ao operador administrativo, que pode encerrar um claim expirado e reconciliar pelo E2 quando houver evidência de consumo confirmado. Dados do upstream, chave e arquivos privados ficam no ambiente operador. [Contrato E2](../specs/SPEC-rag-ingestion.md#116-e2-mvp-local-execution).
