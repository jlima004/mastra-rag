import assert from 'node:assert/strict';
import test from 'node:test';
import { documentId, sha256 } from '../contracts/ids.ts';
import { SOURCE_MANIFEST } from '../contracts/manifest.ts';
import type { FetchedDocument } from '../contracts/types.ts';
import { decodeFetchedDocument } from './decode.ts';
import {
  DOU_HTML_LIMITS, DouHtmlCandidateError, extractDouHtmlCandidate,
  type DouHtmlCandidateErrorCode, type DouHtmlDiagnostics,
} from './dou-html.ts';
import { RagProcessingError } from './errors.ts';
import { extractHtmlBlocks } from './html.ts';

const actHeader = '<p class="identifica">RESOLUÇÃO FICTÍCIA Nº 1</p>';
const abstract = '<p class="ementa">Ementa da oficina imaginária.</p>';
const article = '<p class="dou-paragraph">Art. 1º Oficina de papel.</p>';
const minimum = actHeader + abstract + article;

function region(contents: string, classes = 'texto-dou', head = ''): string {
  return `<div class="${classes}"><html><head>${head}</head><body>${contents}</body></html></div>`;
}

function page(contents = minimum, options: Readonly<{
  head?: string;
  actHead?: string;
  before?: string;
  after?: string;
  extraRegion?: string;
  classes?: string;
}> = {}): string {
  return '<!DOCTYPE html><html><head>' + (options.head ?? '') + '</head><body>' +
    (options.before ?? '') + '<main><article id="materia"><div>' +
    region(contents, options.classes, options.actHead) + (options.extraRegion ?? '') +
    '</div></article></main>' + (options.after ?? '') + '</body></html>';
}

const unsupported = 'DOU_CANDIDATE_UNSUPPORTED_STRUCTURE';
const incomplete = 'DOU_CANDIDATE_STRUCTURAL_INCOMPLETE';
const ambiguous = 'DOU_CANDIDATE_REJECTED_AMBIGUOUS_CONTAINER';
const resource = 'DOU_CANDIDATE_RESOURCE_LIMIT_EXCEEDED';
const entity = 'DOU_CANDIDATE_UNSUPPORTED_ENTITY';

function rejects(
  html: string,
  code: DouHtmlCandidateErrorCode,
  inspect?: (diagnostics: DouHtmlDiagnostics) => void,
): void {
  assert.throws(() => extractDouHtmlCandidate(html), (error: unknown) => {
    if (!(error instanceof DouHtmlCandidateError)) return false;
    assert.equal(error.message, code);
    assert.equal(error.code, code);
    assert.equal(error.diagnostics.unsupportedElements, code === unsupported ? 1 : 0);
    inspect?.(error.diagnostics);
    return true;
  });
}

test('T1 C2/C3: only legacy rejects CDATA in an inert script under head', () => {
  const c2 = page(minimum, {
    head: '<script>// <![CDATA[\nconst sample = 7;\n// ]]>\n</script>',
  });
  const c3 = c2.replace('<![CDATA[', '');
  assert.throws(() => extractHtmlBlocks(c2), (error: unknown) =>
    error instanceof RagProcessingError && error.code === 'EXTRACT_UNSUPPORTED_HTML');
  assert.equal(extractHtmlBlocks(c3).length, 3);
  assert.deepEqual(extractDouHtmlCandidate(c2), extractDouHtmlCandidate(c3));
});

test('T1 scans contextual case-insensitive raw text through fake closers and long ignored bodies', () => {
  const large = 'x'.repeat(DOU_HTML_LIMITS.tagUtf16 + 1);
  const raw = '<ScRiPt>// <![CDATA[\n' + large + '\nconst fake = "</script-near> <p>falso</p>";\n' +
    '// <![CDATA[\n</sCrIpT\t >';
  const nested = minimum + '<p>Texto anterior <style>p:before { content: "</stylex> <h1>"; }</StYlE>' +
    raw + ' texto posterior.</p>';
  const result = extractDouHtmlCandidate(page(nested, {
    before: '<nav>' + raw + '</nav>',
    actHead: '<title><div class=texto-dou>falso</div></title>' + raw,
  }));
  assert.equal(result.blocks.at(-1)?.text, 'Texto anterior texto posterior.');
  assert.equal(result.diagnostics.exclusions.script, 3);
  assert.equal(result.diagnostics.exclusions.style, 1);
  assert.equal(result.diagnostics.admissibleContainers, 1);
});

test('T1 supports regular escaped script data and rejects double-escaping or malformed closing boundaries', () => {
  const escaped = '<script><!-- \nconst example = "<script-error> <p>";\n--></script>';
  const quick = '<script><!--> const example = "<script>"; </script>';
  assert.deepEqual(extractDouHtmlCandidate(page(minimum, { head: escaped + quick })).blocks,
    extractDouHtmlCandidate(page()).blocks);
  for (const head of [
    '<script><!-- <script> </script> </script>',
    '<script>x</script class="ambígua">',
    '<script>x</script/>',
    '<script>x</scriptx>',
    '<style>x</style-near>',
    '<script />',
    '<style>estilo sem fechamento',
  ]) rejects(page(minimum, { head }), unsupported);
});

test('T2 selects exact decoded class tokens and a single admissible article', () => {
  const baseline = extractDouHtmlCandidate(page());
  const expanded = page(minimum, { classes: 'prefixo\ttexto&#45;dou\nsufixo' })
    .replace('id="materia"', 'ID="&#109;ateria"');
  assert.deepEqual(extractDouHtmlCandidate(expanded), baseline);
  rejects(page(minimum, { classes: 'pré-texto-dou texto-douish' }), incomplete);
  rejects(page(minimum, { extraRegion: region(minimum) }), ambiguous, diagnostic => {
    assert.equal(diagnostic.admissibleContainers, 2);
  });
  rejects(page().replace('<main>', '<article id="materia"></article><main>'), ambiguous);
  rejects(page(minimum + region(minimum)), ambiguous);
  rejects(page().replace('<article id="materia"><div>', '<article id="materia"><div><div>')
    .replace('</div></article>', '</div></div></article>'), ambiguous);
});

test('T2 ignores fake selectors in lexically inert and excluded subtrees', () => {
  const fake = '<article id="materia"><div>' + region(minimum) + '</div></article>';
  const result = extractDouHtmlCandidate(page(minimum, {
    before: '<!-- ' + fake + ' --><template>' + fake + '</template><div hidden>' + fake +
      '</div><form>' + fake + '</form><script>const fake = "<article id=materia>";</script>',
    after: '<footer>Art. 99º Navegação editorial.</footer>',
  }));
  assert.equal(result.diagnostics.admissibleContainers, 1);
  assert.equal(result.diagnostics.exclusions.templates, 1);
  assert.equal(result.diagnostics.exclusions.hidden, 1);
  assert.equal(result.diagnostics.exclusions.comments, 1);
  assert.equal(result.blocks.length, 3);
  rejects(page().replace('<article id="materia">', '<article id="materia" hidden>'), incomplete);
});

test('T2 associates first in-body heading and ementa, with editorial heading excluded', () => {
  const result = extractDouHtmlCandidate(page(minimum, {
    before: '<h2>RESOLUÇÃO DO CABEÇALHO EDITORIAL</h2>',
  }));
  assert.equal(result.diagnostics.headerAssociation, 'associated');
  assert.deepEqual(result.blocks.map(({ text }) => text), [
    'RESOLUÇÃO FICTÍCIA Nº 1', 'Ementa da oficina imaginária.', 'Art. 1º Oficina de papel.',
  ]);
  rejects(page(abstract + article), incomplete, diagnostic => {
    assert.equal(diagnostic.headerAssociation, 'missing');
  });
  rejects(page('<p class="identifica"> </p>' + abstract + article), incomplete);
  rejects(page('<p class="identifica">Título sem vínculo estrutural</p>' + abstract + article), incomplete,
    diagnostic => assert.equal(diagnostic.headerAssociation, 'ambiguous'));
  rejects(page(minimum + actHeader), incomplete, diagnostic => {
    assert.equal(diagnostic.headerAssociation, 'ambiguous');
  });
  rejects(page(actHeader + article), incomplete);
  rejects(page(minimum + abstract), incomplete);
  rejects(page(actHeader + abstract), incomplete);
  rejects(page().replace('<html><head></head><body>' + minimum, '<html><body>' + minimum), unsupported);
});

test('T2 detects leading legal markers in visible blocks anywhere outside the chosen body', () => {
  for (const html of [
    page(minimum, { before: '<p><b>Art.</b> 2º Texto fora da região.</p>' }),
    page(minimum, { after: '<p>Art. 2º Texto fora da região.</p>' }),
    page(minimum, { extraRegion: '<p>§ 9º Texto fora da região.</p>' }),
  ]) rejects(html, incomplete, diagnostic => assert.equal(diagnostic.outsideNormativeBlocks, 1));
  rejects(page(minimum, { classes: 'outro', after: '<p>Art. 1º Sem fallback.</p>' }), incomplete);
});

test('T3 preserves normative block order, titles, article markers, annotations, and annex scopes', () => {
  const content = actHeader + abstract + '<p>A associação imaginária resolve:</p>' +
    '<p>CAPÍTULO I</p><p>DAS OFICINAS</p><p>Seção I</p><p>Da ferramenta</p>' +
    '<p>Art. 1º Arte <strong>em</strong> papel.</p><p>§ 1º Sobre a dobra.</p>' +
    '<p>I – Dobrar.</p><p>a) Marcar.</p><p>Art. 2º (Revogado).</p>' +
    '<p>A revogação tem data. (Redação dada por alteração fictícia)</p>' +
    '<p class="assina">Autoria Fictícia</p><p class="cargo">Editora</p>' +
    '<p class="anexo">ANEXO ÚNICO</p><p>Art. 1º A nova dobra.</p>';
  const { blocks, diagnostics } = extractDouHtmlCandidate(page(content));
  assert.deepEqual(blocks.slice(2).map(({ text }) => text), [
    'A associação imaginária resolve:', 'CAPÍTULO I', 'DAS OFICINAS', 'Seção I',
    'Da ferramenta', 'Art. 1º Arte em papel.', '§ 1º Sobre a dobra.',
    'I – Dobrar.', 'a) Marcar.', 'Art. 2º (Revogado).',
    'A revogação tem data. (Redação dada por alteração fictícia)',
    'Autoria Fictícia', 'Editora', 'ANEXO ÚNICO', 'Art. 1º A nova dobra.',
  ]);
  assert.deepEqual(blocks.filter(b => b.role).map(b => b.role),
    ['heading-subtitle', 'heading-subtitle', 'signature', 'office', 'annex']);
  assert.deepEqual(diagnostics.structuralCounts, {
    actHeadings: 1, ementas: 1, signatures: 1, positions: 1, articles: 3, paragraphs: 1,
    incisos: 1, alineas: 1, titles: 0, chapters: 1, sections: 1, subsections: 0,
    annexes: 1, headingSubtitles: 2, otherBlocks: 2, revokedPlaceholders: 1,
  });
  const second = extractDouHtmlCandidate(page(content));
  assert.equal(sha256(JSON.stringify(second.blocks)), sha256(JSON.stringify(blocks)));
  assert.deepEqual(second.blocks, blocks);
});

test('T3 preserves inline text and explicit line boundaries while excluding scoped editorial and struck text', () => {
  const result = extractDouHtmlCandidate(page(minimum +
    '<p class="formato-desconhecido">Parte <span hidden>omitida</span><s>antiga</s>' +
    '<del>riscada</del><span style="text-decoration-line: line-through;">obsoleta</span>' +
    '<span aria-hidden="true">escondida</span><span style="DISPLAY: none !important">invisível</span>' +
    '<span>visível</span><br>Outra linha.</p>' +
    '<div class="social-share">Partilha.</div><nav>Menu.</nav><form>Formulário.</form>' +
    '<template><p>Modelo.</p></template>'));
  assert.deepEqual(result.blocks.slice(-2).map(b => b.text), ['Parte visível', 'Outra linha.']);
  assert.equal(result.diagnostics.exclusions.hidden, 3);
  assert.equal(result.diagnostics.exclusions.struck, 3);
  assert.equal(result.diagnostics.exclusions.editorial, 2);
  assert.equal(result.diagnostics.exclusions.forms, 1);
  assert.equal(result.diagnostics.exclusions.templates, 1);
});

test('T3 fails closed on layouts and notes with unsupported structure inside the act', () => {
  for (const block of [
    '<ol><li>Lista de itens</li></ol>', '<ul><li>I – Item explícito</li></ul>',
    '<table><tbody><tr><td>Unidade</td></tr></tbody></table>',
    '<figure>Legenda substantiva.</figure>', '<p class="nota">Nota sobre a oficina.</p>',
    '<p>Nota editorial: pedido de alteração.</p>', '<p>Primeiro<p>Parágrafo encaixado</p></p>',
    '<p><a href="/a"><a href="/b">Ligação aninhada.</a></a></p>',
    '<p style="display:/* comentário */none">Ocultação ambígua.</p>',
    '<p style="display:none;display:block">Disputa de regras.</p>',
    '<p style="display :none">Espaço estranho em CSS.</p>',
    '<p style="d\\69splay:none">Propriedade com escape.</p>',
  ]) rejects(page(minimum + block), unsupported);
  rejects(page().replace('<main>', '<main style="visibility:var(--condicao)">'), unsupported);
});

test('T3 rejects a revoked placeholder assigned a mandatory or explicit structural role', () => {
  for (const contents of [
    actHeader + '<p class="ementa"> (Revogada) </p>' + article,
    minimum + '<p class="anexo">Art. 9º (Revogado).</p>',
    minimum + '<h3>(Revogado)</h3>',
  ]) rejects(page(contents), incomplete, diagnostic => {
    assert.equal(diagnostic.structuralCounts.revokedPlaceholders, 1);
  });
});

test('T3 recovers exactly an editorial paragraph class on the explicit postlude end tag', () => {
  const result = extractDouHtmlCandidate(page(minimum, {
    after: '<p>Metadados editoriais.</p class="apresentacao">',
  }));
  assert.deepEqual(result.blocks, extractDouHtmlCandidate(page()).blocks);
  assert.equal(result.diagnostics.editorialEndTagRecoveries, 1);
  rejects(page(minimum, { before: '<p>Texto.</p class="antes">' }), unsupported);
  rejects(page(minimum + '<p>Texto.</p class="em-ato">'), unsupported);
  rejects(page(minimum, { after: '<p>Texto.</p id="outro">' }), unsupported);
  rejects(page(minimum, { after: '<p>Texto.</p class="x" id="y">' }), unsupported);
  rejects(page(minimum, { after: '<p>Art. 9º Fora.</p class="x">' }), incomplete);
});

function fetched(bytes: Uint8Array, charset = 'utf-8'): FetchedDocument {
  const source = SOURCE_MANIFEST[1];
  return {
    sourceId: source.sourceId,
    documentId: documentId(source.tenantId, source.sourceId, source.canonicalUri),
    canonicalUri: source.canonicalUri, finalUri: source.canonicalUri, httpStatus: 200,
    declaredMediaType: 'text/html; charset=' + charset, sniffedMediaType: 'text/html', charset,
    byteSize: bytes.byteLength, contentSha256: sha256(bytes),
    fetchedAt: '2026-11-26T12:00:00.000Z', bytes,
  };
}

test('T4 extracts supported UTF-8 and Windows-1252 through the strict decoder', () => {
  const source = SOURCE_MANIFEST[1];
  const utf8 = Buffer.from(page(minimum + '<p>Canção, preço e maçã. 😀</p>'));
  const decoded = decodeFetchedDocument(fetched(utf8), source);
  assert.equal(extractDouHtmlCandidate(decoded).blocks.at(-1)?.text, 'Canção, preço e maçã. 😀');

  const windows = Buffer.from(page(minimum + '<p>€</p>', {
    head: '<meta charset="windows-1252">',
  }).replace('€', '\x80'), 'latin1');
  const decodedWindows = decodeFetchedDocument(fetched(windows, 'windows-1252'), source);
  assert.equal(extractDouHtmlCandidate(decodedWindows).blocks.at(-1)?.text, '€');
  assert.throws(() => decodeFetchedDocument(fetched(windows), source),
    (error: unknown) => error instanceof RagProcessingError && error.code === 'DECODE_CHARSET_CONFLICT');

  const malformed = Buffer.from(page(minimum + '<p>\xff</p>'), 'latin1');
  assert.throws(() => decodeFetchedDocument(fetched(malformed), source),
    (error: unknown) => error instanceof RagProcessingError && error.code === 'DECODE_INVALID_CHARSET');
});

test('T4 preserves scalar Unicode and supported entities once, rejecting corrupt or unknown references', () => {
  const result = extractDouHtmlCandidate(page(minimum +
    '<p>Can&ccedil;&atilde;o &sect; 2&ordm;&nbsp;– &#225; &#x1F600; ' +
    '&lt;script&gt; &amp;lt; &#167; 漢字 e\u0301.</p>'));
  assert.equal(result.blocks.at(-1)?.text, 'Canção § 2º\u00a0– á 😀 <script> &lt; § 漢字 e\u0301.');
  for (const reference of ['&inventada;', '&amp', '&#0;', '&#xD800;', '&#x110000;', '&#128;', '&#12x;']) {
    rejects(page(minimum + '<p>' + reference + '</p>'), entity);
  }
  rejects(page(minimum + '<p>\uD800</p>'), unsupported);
  rejects(page(minimum + '<p>\u0000</p>'), unsupported);
});

test('T5 confines tags and comments, requires progress and sanitizes errors', () => {
  for (const invalid of [
    '<!-- sem fim', '<!--> falso -->', '<!---> falso -->', '<!-- falso --!> clausal -->',
    '<!-- outro <!-- comentário -->', '<?xml foo?>', '<![CDATA[falso]]>',
    '<p id="segredo" ID="duplicado">Texto.</p>', '<p title="sem fim>Texto.</p>',
    '<p>Texto.</div>', '<div classe="privada"sufixo="x"></div>', '<plaintext>Texto.</plaintext>',
  ]) rejects(page(minimum, { before: invalid }), unsupported);
  const direct = extractDouHtmlCandidate(page(minimum +
    '<p title="A > B">A &lt; B, e A < B; << C.</p>'));
  assert.equal(direct.blocks.at(-1)?.text, 'A < B, e A < B; << C.');
});

test('T5 enforces decoded, tag, attribute, depth, element, iteration, text, block and heading bounds', () => {
  const limits = DOU_HTML_LIMITS;
  for (const input of [
    'x'.repeat(limits.decodedUtf16 + 1),
    page(minimum, { before: '<div class="' + 'x'.repeat(limits.tagUtf16) + '"></div>' }),
    page(minimum, { before: '<div ' + Array.from({ length: limits.attributes + 1 }, (_, i) => 'data-a' + i).join(' ') + '></div>' }),
    page(minimum, { before: '<div>'.repeat(limits.depth) + '</div>'.repeat(limits.depth) }),
    page(minimum, { before: '<br>'.repeat(limits.elements + 1) }),
    page(minimum, { head: '<script>' + '< '.repeat(limits.iterations) + '</script>' }),
    page(minimum + '<p>' + 'x'.repeat(limits.textUtf16) + '</p>'),
    page(minimum + '<p>Outra frase.</p>'.repeat(limits.blocks)),
    page(minimum + '<h3>' + 'x'.repeat(limits.headingUtf16 + 1) + '</h3>'),
    page(minimum + '<p>CAPÍTULO IX</p><p>DAS ' + 'X'.repeat(limits.headingUtf16) + '</p>'),
  ]) rejects(input, resource);
});

test('T5 cooperatively checks elapsed time and never executes script or contacts resources', context => {
  let clockCalls = 0;
  const mockedClock = context.mock.method(performance, 'now', () =>
    clockCalls++ === 0 ? 0 : DOU_HTML_LIMITS.elapsedMs + 1);
  rejects(page(), resource);
  mockedClock.mock.restore();

  let fetchedExternally = false;
  context.mock.method(globalThis, 'fetch', () => {
    fetchedExternally = true;
    throw new Error('UNEXPECTED_NETWORK');
  });
  const result = extractDouHtmlCandidate(page(minimum + '<p><a href="https://example.invalid/">Papel.</a></p>', {
    head: '<link rel="stylesheet" href="https://example.invalid/"><script src="https://example.invalid/">' +
      'fetch("https://example.invalid/"); throw new Error("UNEXPECTED_EXECUTION");</script>',
  }));
  assert.equal(result.blocks.at(-1)?.text, 'Papel.');
  assert.equal(fetchedExternally, false);
});
