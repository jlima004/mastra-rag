import type { RawLegalBlock } from './html.ts';

export const DOU_EXTRACTOR_CANDIDATE = 'dou-html@2';

export const DOU_HTML_LIMITS = Object.freeze({
  decodedUtf16: 5_000_000,
  tagUtf16: 8_192,
  iterations: 250_000,
  elements: 50_000,
  depth: 128,
  attributes: 128,
  textUtf16: 1_000_000,
  headingUtf16: 2_048,
  blocks: 10_000,
  elapsedMs: 10_000,
});

export type DouRawLegalBlock = RawLegalBlock & Readonly<{
  role?: 'annex' | 'signature' | 'office' | 'heading-subtitle';
}>;

const EXCLUSIONS = Object.freeze({
  comments: 0, script: 0, style: 0, head: 0, editorial: 0, forms: 0,
  templates: 0, hidden: 0, struck: 0, embedded: 0,
});
const COUNTS = Object.freeze({
  actHeadings: 0, ementas: 0, signatures: 0, positions: 0, articles: 0,
  paragraphs: 0, incisos: 0, alineas: 0, titles: 0, chapters: 0, sections: 0,
  subsections: 0, annexes: 0, headingSubtitles: 0, otherBlocks: 0, revokedPlaceholders: 0,
});
type Counters<T> = { -readonly [K in keyof T]: number };
type Exclusions = Counters<typeof EXCLUSIONS>;
type Counts = Counters<typeof COUNTS>;

export type DouHtmlDiagnostics = Readonly<{
  admissibleContainers: number;
  headerAssociation: 'associated' | 'missing' | 'ambiguous';
  exclusions: Readonly<Exclusions>;
  unsupportedElements: number;
  structuralCounts: Readonly<Counts>;
  extractedUtf16: number;
  outsideNormativeBlocks: number;
  editorialEndTagRecoveries: number;
}>;

export type DouHtmlCandidateErrorCode =
  | 'DOU_CANDIDATE_REJECTED_AMBIGUOUS_CONTAINER'
  | 'DOU_CANDIDATE_STRUCTURAL_INCOMPLETE'
  | 'DOU_CANDIDATE_UNSUPPORTED_STRUCTURE'
  | 'DOU_CANDIDATE_RESOURCE_LIMIT_EXCEEDED'
  | 'DOU_CANDIDATE_UNSUPPORTED_ENTITY';

export class DouHtmlCandidateError extends Error {
  readonly code: DouHtmlCandidateErrorCode;
  readonly diagnostics: DouHtmlDiagnostics;

  constructor(code: DouHtmlCandidateErrorCode, diagnostics: DouHtmlDiagnostics) {
    super(code);
    this.code = code;
    this.diagnostics = diagnostics;
    this.name = 'DouHtmlCandidateError';
  }
}

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
const RAW = new Set(['script', 'style', 'title', 'textarea', 'iframe', 'noscript', 'xmp', 'noembed', 'noframes']);
const EDITORIAL = new Set(['nav', 'header', 'footer', 'aside']);
const FORMS = new Set(['form', 'input', 'button', 'select', 'option', 'optgroup', 'textarea']);
const EMBEDDED = new Set(['iframe', 'noscript', 'xmp', 'noembed', 'noframes', 'svg', 'object', 'figure', 'audio', 'video', 'canvas']);
const STRUCK = new Set(['s', 'strike', 'del']);
const AMBIGUOUS_HTML = new Set(['plaintext', 'frameset', 'frame', 'math']);
const ARTICLE_ANCESTORS = new Set(['html', 'body', 'main', 'div', 'section']);
const INLINE = new Set(['span', 'a', 'b', 'strong', 'em', 'i', 'u', 'small', 'sup', 'sub', 'mark', 'abbr', 'cite']);
const OUTSIDE_BOUNDARY = new Set([
  'article', 'div', 'section', 'p', 'li', 'br', 'table', 'td', 'th', 'dt', 'dd',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);
const SVG_CHILDREN = new Set([
  'a', 'circle', 'clippath', 'defs', 'desc', 'ellipse', 'g', 'line', 'lineargradient',
  'mask', 'path', 'pattern', 'polygon', 'polyline', 'radialgradient', 'rect', 'stop',
  'symbol', 'title', 'use',
]);
const EDITORIAL_CLASSES = new Set(['share', 'share-buttons', 'sharing', 'social-share']);
const NOTE_CLASSES = new Set(['nota', 'note', 'editorial', 'nota-editorial', 'editorial-note']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
type ClassRole = 'actHeadings' | 'ementas' | 'signatures' | 'positions' | 'annexes';
const ROLE_CLASSES: ReadonlyMap<string, ClassRole> = new Map([
  ['identifica', 'actHeadings'], ['ementa', 'ementas'], ['assina', 'signatures'],
  ['cargo', 'positions'], ['anexo', 'annexes'],
]);
type BlockRole = ClassRole | 'ordinary';
type Zone = 'outside' | 'excluded' | 'container' | 'envelope' | 'act-body' | 'block' | 'inline';
type Frame = Readonly<{
  name: string; zone: Zone; materia: boolean; foreign: boolean; unmodeledStyle: boolean;
}>;
type Work = Readonly<{ step: () => void; unsupported: () => never; limit: () => never; entity: () => never }>;

const ASCII_SPACE = /[\t\n\f\r ]/;
const SPACE_ONLY = /^[\t\n\f\r ]*$/;
const HTML_SPACE = /[\t\n\f\r ]+/g;
const NAME = /[A-Za-z][A-Za-z0-9:-]*/y;
const ATTR_NAME = /[A-Za-z_:][A-Za-z0-9_.:@-]*/y;
const ATTR_UNQUOTED = /[^\t\n\f\r "'=<>`]+/y;
const ENTITY = /&(#(?:[xX][0-9a-fA-F]+|[0-9]+)|[A-Za-z][A-Za-z0-9]*);/y;
const NAMED: Readonly<Record<string, string>> = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  ordm: 'º', ordf: 'ª', sect: '§', ndash: '–', mdash: '—', hellip: '…',
  laquo: '«', raquo: '»', bull: '•', copy: '©', reg: '®',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  acirc: 'â', ecirc: 'ê', ocirc: 'ô', atilde: 'ã', otilde: 'õ', ccedil: 'ç',
  agrave: 'à', egrave: 'è', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó',
  Uacute: 'Ú', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô', Atilde: 'Ã', Otilde: 'Õ',
  Ccedil: 'Ç', Agrave: 'À',
});

function entities(value: string, work: Work): string {
  let from = 0;
  const parts: string[] = [];
  for (let amp = value.indexOf('&'); amp >= 0; amp = value.indexOf('&', from)) {
    work.step();
    parts.push(value.slice(from, amp));
    ENTITY.lastIndex = amp;
    const match = ENTITY.exec(value);
    if (!match) {
      if (/[A-Za-z#]/.test(value[amp + 1] ?? '')) work.entity();
      parts.push('&');
      from = amp + 1;
      continue;
    }
    const ref = match[1];
    from = ENTITY.lastIndex;
    if (!ref.startsWith('#')) {
      if (!Object.hasOwn(NAMED, ref)) work.entity();
      parts.push(NAMED[ref]);
      continue;
    }
    const hex = ref[1]?.toLowerCase() === 'x';
    const scalar = Number.parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!Number.isSafeInteger(scalar) || scalar === 0 || scalar > 0x10ffff ||
        (scalar < 32 && ![9, 10, 12, 13].includes(scalar)) ||
        (scalar >= 0x7f && scalar <= 0x9f) ||
        (scalar >= 0xd800 && scalar <= 0xdfff) ||
        (scalar >= 0xfdd0 && scalar <= 0xfdef) || (scalar & 0xfffe) === 0xfffe) work.entity();
    parts.push(String.fromCodePoint(scalar));
  }
  if (!parts.length) return value;
  parts.push(value.slice(from));
  return parts.join('');
}

type Tag = Readonly<{
  name: string; attrs: ReadonlyMap<string, string>; closing: boolean;
  selfClosing: boolean; end: number; editorialEndRecovery?: true;
}>;

function parseTag(html: string, start: number, work: Work, allowEditorialParagraphEnd = false): Tag {
  // Locate the quoted tag boundary before lexing attributes. The temporary
  // token and all attribute scans stay within the per-tag bound.
  let quote: string | undefined;
  let end = start + 1;
  for (; end < html.length; end++) {
    if (end - start >= DOU_HTML_LIMITS.tagUtf16) work.limit();
    const ch = html[end];
    if (quote) {
      if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') break;
    else if (ch === '<') work.unsupported();
  }
  if (end === html.length) work.unsupported();
  const token = html.slice(start + 1, end);
  const closing = token.startsWith('/');
  NAME.lastIndex = closing ? 1 : 0;
  const name = NAME.exec(token)?.[0].toLowerCase() ?? work.unsupported();
  let pos = NAME.lastIndex;
  const attrs = new Map<string, string>();
  let selfClosing = false;
  const space = (): void => {
    while (pos < token.length && ASCII_SPACE.test(token[pos])) pos++;
  };
  while (pos < token.length) {
    const beforeSpace = pos;
    space();
    if (pos === token.length) break;
    if (!closing && pos === token.length - 1 && token[pos] === '/') {
      selfClosing = true;
      break;
    }
    // Both archived shells contain this one postlude form. The HTML
    // tokenizer discards the class on the explicit paragraph end tag.
    if (closing && allowEditorialParagraphEnd && name === 'p' && beforeSpace !== pos &&
        /^class[\t\n\f\r ]*=[\t\n\f\r ]*(?:"[^"<>]*"|'[^'<>]*'|[A-Za-z0-9_-]+)[\t\n\f\r ]*$/i.test(token.slice(pos))) {
      return { name, attrs, closing, selfClosing, end: end + 1, editorialEndRecovery: true };
    }
    if (closing || beforeSpace === pos) work.unsupported();
    work.step();
    if (attrs.size >= DOU_HTML_LIMITS.attributes) work.limit();
    ATTR_NAME.lastIndex = pos;
    const key = ATTR_NAME.exec(token)?.[0].toLowerCase() ?? work.unsupported();
    if (attrs.has(key)) work.unsupported();
    pos = ATTR_NAME.lastIndex;
    const afterName = pos;
    space();
    let value = '';
    if (token[pos] === '=') {
      pos++;
      space();
      const delimiter = token[pos];
      if (delimiter === '"' || delimiter === "'") {
        const close = token.indexOf(delimiter, pos + 1);
        if (close < 0) work.unsupported();
        value = token.slice(pos + 1, close);
        pos = close + 1;
      } else {
        ATTR_UNQUOTED.lastIndex = pos;
        value = ATTR_UNQUOTED.exec(token)?.[0] ?? work.unsupported();
        pos = ATTR_UNQUOTED.lastIndex;
      }
    } else pos = afterName;
    attrs.set(key, value);
  }
  return { name, attrs, closing, selfClosing, end: end + 1 };
}

function nameBoundary(ch: string | undefined): boolean {
  return ch === '>' || ch === '/' || ASCII_SPACE.test(ch ?? '');
}

function rawEnd(html: string, start: number, name: string, work: Work): number {
  let escaped = false;
  let between = start;
  for (let pos = html.indexOf('<', start); pos >= 0; pos = html.indexOf('<', pos + 1)) {
    work.step();
    if (name === 'script') {
      // See WHATWG script data escaped / double escape start states.
      // Each gap between successive '<' candidates is examined at most once.
      if (escaped && html.slice(between, pos).includes('-->')) escaped = false;
      between = pos + 1;
      if (!escaped && html.startsWith('<!--', pos)) {
        escaped = true;
        between = pos + 2;
        continue;
      }
      if (escaped && html.slice(pos + 1, pos + 7).toLowerCase() === 'script' &&
          nameBoundary(html[pos + 7])) work.unsupported();
    }
    if (html[pos + 1] === '/' && html.slice(pos + 2, pos + 2 + name.length).toLowerCase() === name &&
        nameBoundary(html[pos + 2 + name.length])) return parseTag(html, pos, work).end;
  }
  return work.unsupported();
}

function lexicalRole(text: string): keyof Counts {
  const value = text.normalize('NFC').trim();
  if (/^Art\.\s*\d{1,4}(?:\s*[-–]\s*[A-Z])?(?:[.º°o])?(?=\s|[.,:;]|$)/iu.test(value)) return 'articles';
  if (/^(?:§\s*\d|Par[aá]grafo\s+[uú]nico\b)/iu.test(value)) return 'paragraphs';
  if (/^[IVXLCDM]+\s*[-–—]\s+/iu.test(value)) return 'incisos';
  if (/^[a-z]\)\s+/iu.test(value)) return 'alineas';
  if (/^T[IÍ]TULO\s+/iu.test(value)) return 'titles';
  if (/^CAP[IÍ]TULO\s+/iu.test(value)) return 'chapters';
  if (/^SE[CÇ][AÃ]O\s+/iu.test(value)) return 'sections';
  if (/^SUBSE[CÇ][AÃ]O\s+/iu.test(value)) return 'subsections';
  if (/^ANEXO(?:\s|$)/iu.test(value)) return 'annexes';
  return 'otherBlocks';
}

export function isDouHeadingSubtitle(marker: string, candidate: string): boolean {
  return /^(?:T[IÍ]TULO|CAP[IÍ]TULO|SE[CÇ][AÃ]O|SUBSE[CÇ][AÃ]O)\s+[IVXLCDM]{1,15}\.?$/iu.test(marker.normalize('NFC')) &&
    /^(?:(?:D[AO]S?|D[EO])\s|DISPOSI[CÇ][OÕ]ES\s)/iu.test(candidate.normalize('NFC'));
}

function revokedPlaceholder(text: string): boolean {
  return /^\(?Revogad[oa]\)?[.;]?$/i.test(text) ||
    /^Art\.\s*\d+(?:-[A-Z])?\s*[ºo.]?\s*\(Revogad[oa]\)[.;]?$/i.test(text);
}

function inlineStyle(value: string | undefined): 'hidden' | 'struck' | 'unmodeled' | undefined {
  const style = value?.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
  if (!style) return undefined;
  if (/^(?:display[\t\n\f\r ]*:[\t\n\f\r ]*none|visibility[\t\n\f\r ]*:[\t\n\f\r ]*(?:hidden|collapse))[\t\n\f\r ]*(?:![\t\n\f\r ]*important[\t\n\f\r ]*)?;?$/i.test(style)) return 'hidden';
  if (/^text-decoration(?:-line)?[\t\n\f\r ]*:[\t\n\f\r ]*line-through[\t\n\f\r ]*(?:![\t\n\f\r ]*important[\t\n\f\r ]*)?;?$/i.test(style)) return 'struck';
  return 'unmodeled';
}

function exclusion(
  name: string,
  attrs: ReadonlyMap<string, string>,
  classes: readonly string[],
  style: ReturnType<typeof inlineStyle>,
  work: Work,
): keyof Exclusions | undefined {
  if (name === 'script' || name === 'style' || name === 'head') return name;
  if (name === 'template') return 'templates';
  if (FORMS.has(name)) return 'forms';
  if (EDITORIAL.has(name) || classes.some(value => EDITORIAL_CLASSES.has(value))) return 'editorial';
  if (EMBEDDED.has(name)) return 'embedded';
  const ariaHidden = entities(attrs.get('aria-hidden') ?? '', work).trim().toLowerCase() === 'true';
  if (attrs.has('hidden') || ariaHidden || style === 'hidden') return 'hidden';
  if (STRUCK.has(name) || style === 'struck') return 'struck';
  return undefined;
}

/** An inert extractor for the explicitly balanced DOU article layout. */
export function extractDouHtmlCandidate(html: string): Readonly<{
  blocks: readonly DouRawLegalBlock[];
  diagnostics: DouHtmlDiagnostics;
}> {
  const exclusions: Exclusions = { ...EXCLUSIONS };
  const structuralCounts: Counts = { ...COUNTS };
  let admissibleContainers = 0;
  let headerAssociation: DouHtmlDiagnostics['headerAssociation'] = 'missing';
  let unsupportedElements = 0;
  let extractedUtf16 = 0;
  let outsideNormativeBlocks = 0;
  let editorialEndTagRecoveries = 0;
  const diagnostics = (): DouHtmlDiagnostics => Object.freeze({
    admissibleContainers, headerAssociation, unsupportedElements, extractedUtf16,
    outsideNormativeBlocks, editorialEndTagRecoveries,
    structuralCounts: Object.freeze({ ...structuralCounts }), exclusions: Object.freeze({ ...exclusions }),
  });
  const fail = (code: DouHtmlCandidateErrorCode): never => {
    throw new DouHtmlCandidateError(code, diagnostics());
  };
  const started = performance.now();
  let iterations = 0;
  const time = (): void => {
    if (performance.now() - started > DOU_HTML_LIMITS.elapsedMs) work.limit();
  };
  const work: Work = {
    step() {
      if (++iterations > DOU_HTML_LIMITS.iterations) work.limit();
      if (iterations % 1024 === 0) time();
    },
    unsupported() {
      unsupportedElements++;
      return fail('DOU_CANDIDATE_UNSUPPORTED_STRUCTURE');
    },
    limit: () => fail('DOU_CANDIDATE_RESOURCE_LIMIT_EXCEEDED'),
    entity: () => fail('DOU_CANDIDATE_UNSUPPORTED_ENTITY'),
  };
  const incomplete = (): never => fail('DOU_CANDIDATE_STRUCTURAL_INCOMPLETE');
  const ambiguous = (): never => fail('DOU_CANDIDATE_REJECTED_AMBIGUOUS_CONTAINER');
  if (typeof html !== 'string') work.unsupported();
  if (html.length > DOU_HTML_LIMITS.decodedUtf16) work.limit();
  if (/[\u0000\uD800-\uDFFF]/u.test(html)) work.unsupported();

  const stack: Frame[] = [];
  const blocks: DouRawLegalBlock[] = [];
  let elements = 0;
  let materia = 0;
  let seenDoctype = false;
  let headerElements = 0;
  let ementaElements = 0;
  let envelopeStage: 'html' | 'head' | 'body' | 'closed' = 'html';
  let blockRole: BlockRole = 'ordinary';
  let explicitHeading = false;
  let blockParts: string[] = [];
  let blockStart = 0;
  let textBudget = 0;
  let outsidePrefix = '';

  const flushOutside = (): void => {
    if (!outsidePrefix) return;
    // Outside text is scanned only for leading legal markers. The sample
    // boundary may fall in the middle of an entity in editorial prose.
    const sample = outsidePrefix.length === 256 ?
      outsidePrefix.replace(/&(?:#?[A-Za-z0-9]*)$/, '') : outsidePrefix;
    if (lexicalRole(entities(sample, work)) !== 'otherBlocks') outsideNormativeBlocks++;
    outsidePrefix = '';
  };
  const append = (text: string): void => {
    const decoded = entities(text, work);
    textBudget += decoded.length;
    if (textBudget > DOU_HTML_LIMITS.textUtf16) work.limit();
    blockParts.push(decoded);
  };
  const flushBlock = (): void => {
    const text = blockParts.join('').replace(HTML_SPACE, ' ').replace(/^ | $/g, '');
    blockParts = [];
    if (!text.trim()) {
      if (blockRole === 'actHeadings' || blockRole === 'ementas') incomplete();
      return;
    }
    if (blocks.length === DOU_HTML_LIMITS.blocks) work.limit();
    if (/^nota\s+editorial\b/iu.test(text)) work.unsupported();
    if (blockRole === 'actHeadings') {
      if (blocks.length || !/^RESOLU[ÇC][ÃA]O\s/iu.test(text.normalize('NFC'))) {
        headerAssociation = 'ambiguous';
        incomplete();
      }
      headerAssociation = 'associated';
    } else if (blockRole === 'ementas') {
      if (blocks.length !== 1 || headerAssociation !== 'associated') incomplete();
    } else if (blocks.length < 2) incomplete();

    const lexical = blockRole === 'ordinary' ? lexicalRole(text) : blockRole;
    const previous = blocks.at(-1);
    const role = lexical === 'otherBlocks' && !explicitHeading && blocks.length === blockStart &&
      previous?.kind === 'heading' &&
      isDouHeadingSubtitle(previous.text, text) ? 'headingSubtitles' : lexical;
    structuralCounts[role]++;
    if (revokedPlaceholder(text.normalize('NFC').replace(/\s+/gu, ' ').trim())) {
      structuralCounts.revokedPlaceholders++;
      if (blockRole !== 'ordinary' || explicitHeading) incomplete();
    }
    const heading = explicitHeading || role === 'actHeadings' || role === 'annexes' ||
      role === 'titles' || role === 'chapters' || role === 'sections' || role === 'subsections' || role === 'headingSubtitles';
    const hint = role === 'annexes' ? 'annex' : role === 'signatures' ? 'signature' :
      role === 'positions' ? 'office' : role === 'headingSubtitles' ? 'heading-subtitle' : undefined;
    if (heading && text.length > DOU_HTML_LIMITS.headingUtf16) work.limit();
    const kind = heading ? 'heading' : 'text';
    blocks.push(Object.freeze(hint ? { kind, text, role: hint } : { kind, text }));
    extractedUtf16 += text.length;
  };

  for (let cursor = 0; cursor < html.length;) {
    work.step();
    const parent = stack.at(-1);
    const parentZone = parent?.zone ?? 'outside';
    if (html.startsWith('<!--', cursor)) {
      const end = html.indexOf('-->', cursor + 4);
      if (end < 0) work.unsupported();
      const comment = html.slice(cursor + 4, end);
      if (comment.startsWith('>') || comment.startsWith('->') ||
          comment.endsWith('<!-') || comment.includes('<!--') || comment.includes('--!>')) work.unsupported();
      exclusions.comments++;
      cursor = end + 3;
      continue;
    }
    if (html[cursor] !== '<' || !/[A-Za-z!/?]/.test(html[cursor + 1] ?? '')) {
      const next = html.indexOf('<', cursor + (html[cursor] === '<' ? 1 : 0));
      const end = next < 0 ? html.length : next;
      const text = html.slice(cursor, end);
      if (parentZone === 'block' || parentZone === 'inline') append(text);
      else if (parentZone === 'outside') {
        if (outsidePrefix.length < 256) {
          const segment = outsidePrefix ? text : text.trimStart();
          outsidePrefix += segment.slice(0, 256 - outsidePrefix.length);
        }
      } else if (parentZone !== 'excluded' && !SPACE_ONLY.test(text)) work.unsupported();
      cursor = end;
      continue;
    }
    if (html[cursor + 1] === '!') {
      const match = /^<!doctype[\t\n\f\r ]+html[\t\n\f\r ]*>/i.exec(html.slice(cursor, cursor + DOU_HTML_LIMITS.tagUtf16));
      if (seenDoctype || elements || !match) work.unsupported();
      seenDoctype = true;
      cursor += match!.length;
      continue;
    }
    if (html[cursor + 1] === '?') work.unsupported();

    const allowEditorialParagraphEnd = envelopeStage === 'closed' && parent?.name === 'p' &&
      (parentZone === 'outside' || parentZone === 'excluded');
    const { name, attrs, closing, selfClosing, end, editorialEndRecovery } =
      parseTag(html, cursor, work, allowEditorialParagraphEnd);
    if (editorialEndRecovery) editorialEndTagRecoveries++;
    cursor = end;
    if (closing) {
      if (parent?.name !== name) work.unsupported();
      if (parentZone === 'block') flushBlock();
      if (parentZone === 'outside' && OUTSIDE_BOUNDARY.has(name)) flushOutside();
      if (parentZone === 'act-body') {
        if (!blocks.length || structuralCounts.ementas !== 1 || !structuralCounts.articles) incomplete();
        envelopeStage = 'closed';
      }
      if (parentZone === 'container' && envelopeStage !== 'closed') incomplete();
      stack.pop();
      continue;
    }
    if (++elements > DOU_HTML_LIMITS.elements || stack.length === DOU_HTML_LIMITS.depth) work.limit();

    const foreign = name === 'svg' || parent?.foreign === true;
    if ((parent?.foreign && !SVG_CHILDREN.has(name)) || AMBIGUOUS_HTML.has(name)) work.unsupported();
    const isVoid = !foreign && VOID.has(name);
    if (selfClosing && !isVoid && !foreign) work.unsupported();
    const ignored = parentZone === 'excluded';
    const classes = ignored ? [] : entities(attrs.get('class') ?? '', work).split(HTML_SPACE).filter(Boolean);
    const style = ignored ? undefined : inlineStyle(attrs.get('style'));
    const category = ignored ?
      (name === 'script' || name === 'style' ? name : undefined) : exclusion(name, attrs, classes, style, work);
    if (category) exclusions[category]++;
    const inBody = parentZone === 'act-body' || parentZone === 'block' || parentZone === 'inline';
    if (inBody && (category === 'embedded' || category === 'head' || name === 'title' ||
        (!category && style === 'unmodeled'))) work.unsupported();

    let zone: Zone = 'outside';
    let isMateria = false;
    if (ignored) zone = 'excluded';
    else if (parentZone === 'container') {
      if (name !== 'html' || category || style === 'unmodeled' || envelopeStage !== 'html') work.unsupported();
      zone = 'envelope';
      envelopeStage = 'head';
    } else if (parentZone === 'envelope') {
      if (name === 'head' && envelopeStage === 'head') {
        zone = 'excluded';
        envelopeStage = 'body';
      } else if (name === 'body' && !category && style !== 'unmodeled' && envelopeStage === 'body') zone = 'act-body';
      else work.unsupported();
    } else if (category) zone = 'excluded';
    else if (name === 'div' && classes.includes('texto-dou')) {
      flushOutside();
      const withinArticle = parent?.name === 'div' && parent.zone === 'outside' && stack.at(-2)?.materia;
      if (withinArticle) admissibleContainers++;
      if (!withinArticle || admissibleContainers !== 1) ambiguous();
      if (style === 'unmodeled' || stack.some(frame => frame.unmodeledStyle)) work.unsupported();
      zone = 'container';
    } else if (name === 'article' && entities(attrs.get('id') ?? '', work) === 'materia') {
      if (++materia > 1 || stack.some(frame => !ARTICLE_ANCESTORS.has(frame.name))) ambiguous();
      zone = 'outside';
      isMateria = true;
    } else if (parentZone === 'act-body') {
      if (name !== 'p' && !HEADINGS.has(name)) work.unsupported();
      if (classes.some(value => NOTE_CLASSES.has(value))) work.unsupported();
      const roles = new Set(classes.map(value => ROLE_CLASSES.get(value)).filter(role => role !== undefined));
      if (roles.size > 1 || (name !== 'p' && roles.size)) work.unsupported();
      blockRole = roles.values().next().value ?? 'ordinary';
      if (blockRole === 'actHeadings' && ++headerElements > 1) {
        headerAssociation = 'ambiguous';
        incomplete();
      }
      if (blockRole === 'ementas' && ++ementaElements > 1) incomplete();
      explicitHeading = HEADINGS.has(name);
      blockStart = blocks.length;
      zone = 'block';
    } else if (parentZone === 'block' || parentZone === 'inline') {
      if (name === 'br' && blockRole === 'ordinary' && !explicitHeading) flushBlock();
      else if (!INLINE.has(name) || classes.some(value => NOTE_CLASSES.has(value)) ||
          (name === 'a' && stack.some(frame => frame.name === 'a'))) work.unsupported();
      zone = 'inline';
    } else if (OUTSIDE_BOUNDARY.has(name)) flushOutside();

    if (RAW.has(name) && !foreign) {
      cursor = rawEnd(html, cursor, name, work);
      continue;
    }
    if (!isVoid && !selfClosing) stack.push({
      name, zone, materia: isMateria, foreign, unmodeledStyle: style === 'unmodeled',
    });
  }
  time();
  if (stack.length) work.unsupported();
  flushOutside();
  if (admissibleContainers !== 1 || outsideNormativeBlocks) incomplete();
  return Object.freeze({ blocks: Object.freeze(blocks), diagnostics: diagnostics() });
}
