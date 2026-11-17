# E1 — Pacote operacional H5/H6/H10 (preparação local)

**Data:** 2026-11-17  
**Origem normativa:** [ratificação H5/H6/H10](../decisions/RAG-E1-H5-H6-H10-owner-ratification.md), [decisão H10 sem backup](../decisions/RAG-H10-mvp-no-backup.md).  
**Escopo da PR:** ferramentas/scripts de prova em PostgreSQL 17 descartável, migrações versionadas, testes unitários, evidências de CLI e documentação. **Nenhuma execução remota autorizada**.

## Resultado e fronteiras

| Gate | Artefato | Status esperado |
| --- | --- | --- |
| H5 | `supabase/migrations/20261113233720_enable_pgvector_create_private_rag_schema.sql` | Espelho **exato** do SQL em `supabase_migrations.schema_migrations.statements`; **já aplicado** na produção, **nunca reaplicar** |
| H5 | `supabase/migrations/20261117213614_rag_catalog.sql` | Nome gerado por `supabase migration new rag_catalog` via CLI v3.1.0 no [CI #44181461137](https://github.com/jlima004/mastra-rag/actions/runs/44181461137); SQL idêntico byte a byte a `db/migrations/0001_rag_catalog.up.sql`; **NÃO aplicado** |
| H5 | `scripts/check-e1-cli-offline.sh` + `e1-operator-cli` no CI | Verifica pin 3.1.0, `--help`/target explícito e geração local sem credencial nem conexão remota |
| H6 | `db/local/0004_e1_operator_privilege_proofs.sql` | RLS, ausência de privilégios de DDL/BYPASSRLS, grants de catálogos e espaço vetorial |
| H6 | `scripts/test-e1-operator-local.sh` | Reprodução em banco descartável separado das permissões iniciais de `public.rls_auto_enable()` e regressão isolada de revogação `EXECUTE` |
| H10 | `scripts/e1-capacity-policy.ts` + testes | Regra *pura* de admissão projetada, não integrada a runtime: faltas de métrica e limites bloqueiam; **não comprova enforcement em E2** |
| H10 | `db/readonly/e1_h10_project_measurements.sql` | SELECT de uso do banco e relações `rag`, testado somente na instância descartável; **não fornece quota da organização nem disco/WAL** |

A migração original só foi consultada de maneira **read-only** no projeto `lmocjhpajhxegzobydau`; foi registrado um único item, versão `20261113233720`, com quatro comandos SQL que instalam pgvector em `extensions`, criam `rag` e retiram acessos de `public`, `anon` e `authenticated`. O espelho no repositório é para reconciliação de histórico: **não é solicitação de reaplicação**. SHA-256 da instrução hospedada, obtido por consulta SQL **read-only**: `9c36f409c82917f523f6c034ab576409a0e3ee6711901c4b09bcc04e3b2e4e13` (**183 bytes, sem LF final**); o script de CLI compara esse valor com o arquivo local. Não foi executado `migration repair` nem `db push`.

## H5 — procedimento de confirmação antes de qualquer SQL hospedado

1. **Versão pinada:** `supabase/setup-cli@v3` com `version: '3.1.0'` é usado em CI sem chaves. Em sessão humana futura, obter o mesmo binário exato, registrar `supabase --version` e verificar `supabase migration list --help`, `migration fetch --help`, `migration new --help`, `db push --help`. CLI v3 é local por padrão; **não assumir que ausência de `--remote` aponta para o hospedado**. O operador deve verificar a sintaxe real na versão pinada.
2. **Histórico:** comparar somente por acesso read-only o ledger `supabase_migrations.schema_migrations` e os dois arquivos locais; esperar **exactamente** a entrada `20261113233720` aplicada e `20261117213614` ainda ausente. Qualquer outra entrada inesperada é **STOP** até reconciliação independente. Nunca inventar/editar versões ou `migration repair` para mascarar divergência.
3. **Identidade SQL:** provar `sha256sum db/migrations/0001_rag_catalog.up.sql supabase/migrations/20261117213614_rag_catalog.sql` igual, conferir SQL linha a linha e transações `BEGIN`/`COMMIT` em ensaio descartável. Se o SQL mudar, review e novo hash obrigatórios.
4. **Ordem:** fundação já existente → criação privilegiada e verificação de `rag_app` + `USAGE` em `extensions` (**autorização separada**) → migração de catálogo sob ledger (**outra autorização**) → espaço `flat` pelo operador e políticas/grants (**outra autorização**) → DSN do app e tráfego/ingestão (**outras autorizações**).
5. **Pré/pós-flight:** confirmar project ref, hostname, porta, banco, versão PostgreSQL, `rag` sem tabelas inesperadas, vetor instalado, SQL SHA-256, roles, histórico, grants e RLS antes/depois. Sem backup no MVP; **não operar `down`, `DROP` ou rollback destrutivo** como fuga de erro.
6. **Não executar a partir do CI:** o CI não possui credenciais do Supabase, jamais executa comandos `--remote`, nem publica migrações. A PR por si só não libera aplicação remota.

### H5 — pontos que ainda exigem verificação

A transição ao ledger versionado tem a fundação SQL espelhada, mas **não há autorização para empurrar os dois arquivos remotamente**. Antes de qualquer `db push` futuro, um operador humano deve demonstrar a comparação local↔hosted e o plano de execução. A edição de `schema_migrations` é proibida sem nova decisão explícita.

## H6 — procedimento futuro (somente proposta, não executar)

O contrato da role é `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, sem role membership privilegiada, sem propriedade de `rag` ou `extensions` e sem `CREATE` nesses schemas. A criação deve ser feita pelo operador PostgreSQL em **sessão interativa protegida**, usando `\password rag_app` dentro de `psql` (não SQL Editor, não `PASSWORD '...'`, não `psql -c` com segredo). Após a autorização da criação, conceder somente `USAGE ON SCHEMA extensions` antes de executar o SQL do catálogo. O catálogo concede `USAGE ON SCHEMA rag`, somente `SELECT` em `embedding_space` e DML escopado nas demais tabelas. O espaço `chunks_te3s_1536_v1` requer `SELECT/INSERT/UPDATE` mais RLS para `ON CONFLICT DO UPDATE`, sem ownership do runtime.

O runtime não pode usar credencial `postgres` nem `service_role`, nem gerar espaço automaticamente (`disableInit:true`); não registrar rota pública de vetores. **O procedimento não cria role/DSN nesta PR.** Testes locais de role/namespace e catálogo não substituem ensaio autorizado no Supabase.

### Segurança `public.rls_auto_enable()`

Avisos prévios: permissão de execução a `anon` e `authenticated` em função `SECURITY DEFINER` de retorno `event_trigger`, pertencente a `postgres` e vinculada ao evento `ensure_rls`. Em banco **separado e descartável**, o script reproduz grants, valida RLS em `CREATE TABLE`, verifica recusa de invocação SQL direta e testa que **revogar EXECUTE** não impede a execução por evento. **Isso não prova nem descarta exploração via PostgREST RPC**, que não é emulado neste ensaio. Um security gate independente deve decidir se revoga os grants em produção ou aceita formalmente risco residual. **Nada é alterado na função hospedada.**

## H10 — política de admissão (pré-E2, sem backup)

| Métrica | Aviso | Hard stop |
| --- | ---: | ---: |
| Vetores ativos | — | **2.000** |
| Espaços extras de rebuild/retiring | — | **1** |
| Relações privadas `rag`, incluindo índices e TOAST | **80 MiB** | **100 MiB** |
| Banco `mastra-rag` | **250 MiB** | **300 MiB** |
| Uso total de banco na organização `Alquem.io` | **350 MB** | **400 MB** |
| Disco físico (não `pg_database_size`) | Telemetria independente obrigatória | Rejeitar novos trabalhos sob uso crítico (candidato conservador **≥95%**, não um novo SLO aprovado) |

O avaliador `assessE1H10Capacity()` recebe medições e projeções explícitas; não faz SQL. Rejeita campos ausentes, negativos, fracionários, overflow, uso organizacional não verificado, disco/WAL não verificado, somatório organizacional inconsistente, projeções subestimadas e estouros dos limites. **Não faz reserva transacional, locking, serialização concorrente, busca de métricas, medição real ou bloqueio de jobs E2.** Consequentemente, um resultado `admitted: true` **não constitui permissão para persistência**.

Os dados da organização Free são agregados entre projetos; os dois outros projetos da `Alquem.io` estavam inativos no último exame, e sua contribuição de quota segue desconhecida. `pg_database_size` mede o banco atual, não disco/WAL nem organização. Confirmar os três domínios de telemetria de forma independente, inclusive a origem da estimativa de crescimento em reconstrução/segundo espaço. Se forem desconhecidos, **fail closed**. Contrato de admissão/concurrency/GC será integrado somente após H7/H11/H12 e aprovação de E2.

### Leituras SQL propostas para futuro operador (não executadas no hospedado)

O arquivo [SQL somente-leitura](../../db/readonly/e1_h10_project_measurements.sql) integra o ensaio PostgreSQL descartável e só fornece métricas de **um projeto**. Não o tratar como evidência de cota organizacional ou disco/WAL.

```sql
SELECT pg_database_size(current_database()) AS database_bytes;
SELECT coalesce(sum(pg_total_relation_size(c.oid)), 0) AS rag_relation_bytes
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'rag' AND c.relkind IN ('r','m','p');
```

Uso agregado `Alquem.io` e disco físico devem vir do painel/telemetria autorizada do Supabase; **nunca inferir** esses valores a partir do banco `mastra-rag`. Nenhum backup ou RPO/RTO será implementado no MVP.

## Gates restantes antes de executar no hospedado

- [ ] CI no HEAD final + Codex Review independente sem findings materiais; aprovação humana para merge e deploy desta PR.
- [ ] Prova humana do ledger remoto em CLI v3.1.0 e reconciliação de histórico, versão/hash SQL e ausência de drift.
- [ ] Autorização humana **separada** para criar/validar `rag_app`; sem senhas em comando/chat/CI.
- [ ] Autorização humana **separada** para aplicar catálogo, vetor `flat`, configuração DSN e dados de teste.
- [ ] Adjudicar avisos de `rls_auto_enable()` com revisão de segurança e decisão de revogação ou risco aceito.
- [ ] Medir quota organizacional, disco/WAL, custo e tamanho do corpus; integrar métricas, locking e fail-closed admission antes de E2.
- [ ] Ratificar H7, H11 e H12; aprovar limites de gasto, acesso, retenção/GC e escopo de ingestão antes do primeiro documento real.

**Estado:** `RAG-E1 / OPERATOR_PACKAGE_LOCAL / H5_CLI_PINNED / H6_SECURITY_ISOLATED_ONLY / H10_ADMISSION_PURE_ONLY / HOSTED_WRITES_BLOCKED`.
