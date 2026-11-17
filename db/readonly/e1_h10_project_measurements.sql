-- E1/H10: project-only measurements. Pure SELECT; valid even before
-- E1 tables exist. This does NOT measure organization-wide Free quota,
-- physical disk/WAL, actual corpus sizes or multi-job reservations.
-- For a future separately approved operator only; never run in public routes.
SELECT json_build_object(
  'database_bytes', pg_database_size(current_database()),
  'rag_relation_bytes', (
    SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0)::bigint
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'rag' AND c.relkind IN ('r', 'm', 'p')
  )
)::text;
