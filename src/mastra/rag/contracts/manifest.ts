import type { SourceManifestEntry } from './types.ts';
import { validateSourceManifest } from './validation.ts';

/**
 * Fixed, operator-curated HTTPS sources. References below were checked against
 * the official ANPD regulations index on 2026-11-16. The DOU pages returned
 * HTTP 502 to the research client; accessibility and *current consolidated*
 * wording remain a separate Step C pre-ingestion gate. No HTTP access here.
 *
 * Resolutions 2/2022 and 19/2024 are NOT in the active manifest because they
 * have amendments / corrigenda that must be reconciled against current text.
 */
export const SOURCE_MANIFEST: readonly SourceManifestEntry[] = validateSourceManifest([
  {
    sourceId: 'br-planalto-lei-13709-2018',
    tenantId: 'public', kind: 'http',
    canonicalUri: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm',
    expectedMediaTypes: ['text/html'],
    extractor: 'planalto-html@1',
    title: 'Lei nº 13.709/2018 — Lei Geral de Proteção de Dados Pessoais',
    license: { kind: 'official-act-br', reference: 'Lei 9.610/1998, art. 8º, IV' },
    language: 'pt-BR',
  },
  {
    sourceId: 'br-anpd-res-15-2024',
    tenantId: 'public', kind: 'http',
    canonicalUri: 'https://www.in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-15-de-24-de-abril-de-2024-556243024',
    expectedMediaTypes: ['text/html'],
    extractor: 'dou-html@1',
    title: 'Resolução CD/ANPD nº 15/2024 — Comunicação de Incidente de Segurança',
    license: { kind: 'official-act-br', reference: 'Lei 9.610/1998, art. 8º, IV' },
    language: 'pt-BR',
  },
  {
    sourceId: 'br-anpd-res-18-2024',
    tenantId: 'public', kind: 'http',
    canonicalUri: 'https://www.in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-18-de-16-de-julho-de-2024-572632074',
    expectedMediaTypes: ['text/html'],
    extractor: 'dou-html@1',
    title: 'Resolução CD/ANPD nº 18/2024 — Atuação do Encarregado',
    license: { kind: 'official-act-br', reference: 'Lei 9.610/1998, art. 8º, IV' },
    language: 'pt-BR',
  },
]);
