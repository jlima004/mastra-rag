import { RagProcessingError } from './errors.ts';

export type RawLegalBlock = Readonly<{ kind: 'heading' | 'text'; text: string }>;

const BLOCK_TAGS = new Set(['p','div','li','tr','td','th','article','section','h1','h2','h3','h4','h5','h6','br']);
const SKIP_TAGS = new Set([
  'head','script','style','nav','header','footer','aside','iframe','form',
  's','strike','del','figure','svg','template','noscript',
]);
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', ordm: 'º', ordf: 'ª', sect: '§', ndash: '–',
  mdash: '—', hellip: '…', laquo: '«', raquo: '»', bull: '•',
  copy: '©', reg: '®',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  acirc: 'â', ecirc: 'ê', ocirc: 'ô',
  atilde: 'ã', otilde: 'õ', ccedil: 'ç',
  agrave: 'à', egrave: 'è',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô', Atilde: 'Ã', Otilde: 'Õ',
  Ccedil: 'Ç', Agrave: 'À',
};

function decodeEntityText(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]+);/gi, (_, key: string) => {
    if (key[0] === '#') {
      const number = /^#x/i.test(key) ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
      if (!Number.isSafeInteger(number) || number === 0 || number > 0x10ffff ||
          (number >= 0xd800 && number <= 0xdfff)) {
        throw new RagProcessingError('EXTRACT_UNSUPPORTED_ENTITY');
      }
      return String.fromCodePoint(number);
    }
    if (!Object.hasOwn(NAMED_ENTITIES, key)) throw new RagProcessingError('EXTRACT_UNSUPPORTED_ENTITY');
    return NAMED_ENTITIES[key];
  });
}

/**
 * Deliberately restricted, deterministic fixture parser: never executes HTML.
 * No claim of full real-world Planalto/DOU compatibility until H9 approval.
 * Rejects malformed tags/entities and caps the number/size of tokens.
 */
export function extractHtmlBlocks(html: string): readonly RawLegalBlock[] {
  if (typeof html !== 'string' || html.length > 5_000_000) {
    throw new RagProcessingError('EXTRACT_UNSUPPORTED_HTML');
  }
  const blocks: RawLegalBlock[] = [];
  let buffer = '';
  let heading = false;
  let ignoredTag: string | null = null;
  let ignoredDepth = 0;
  let cursor = 0;
  let tokens = 0;
  const started = Date.now();

  const flush = (): void => {
    const text = buffer.replace(/\s+/gu, ' ').trim();
    if (text) blocks.push({ kind: heading ? 'heading' : 'text', text });
    buffer = '';
    heading = false;
  };

  while (cursor < html.length) {
    if (++tokens > 250_000 || (tokens % 1024 === 0 && Date.now() - started > 10_000)) {
      throw new RagProcessingError('EXTRACT_UNSUPPORTED_HTML');
    }
    if (html.startsWith('<!--', cursor)) {
      const end = html.indexOf('-->', cursor + 4);
      if (end < 0) throw new RagProcessingError('EXTRACT_UNSUPPORTED_HTML');
      cursor = end + 3;
      continue;
    }
    if (html[cursor] !== '<') {
      const next = html.indexOf('<', cursor);
      const stop = next < 0 ? html.length : next;
      if (!ignoredTag) buffer += decodeEntityText(html.slice(cursor, stop));
      cursor = stop;
      continue;
    }
    if (!/^<(?:[A-Za-z!/]|\?)/.test(html.slice(cursor, cursor + 2))) {
      if (!ignoredTag) buffer += '<';
      cursor++;
      continue;
    }
    // Find tag end without mistaking '>' inside a quoted attribute for a close.
    let quote: string | null = null;
    let end = cursor + 1;
    for (; end < html.length && end - cursor <= 8192; end++) {
      const char = html[end];
      if (quote) { if (char === quote) quote = null; }
      else if (char === "'" || char === '"') quote = char;
      else if (char === '>') break;
    }
    if (end >= html.length || end - cursor > 8192 || quote) {
      throw new RagProcessingError('EXTRACT_UNSUPPORTED_HTML');
    }
    const tag = html.slice(cursor + 1, end).trim();
    cursor = end + 1;
    if (/^(?:!doctype|\?xml)\b/i.test(tag)) continue;
    const parsed = /^(\/?)\s*([A-Za-z][A-Za-z0-9-]*)(?:\s|\/|$)/.exec(tag);
    if (!parsed) throw new RagProcessingError('EXTRACT_UNSUPPORTED_HTML');
    const closing = !!parsed[1];
    const name = parsed[2].toLowerCase();
    if (ignoredTag) {
      if (name === ignoredTag) {
        if (closing) {
          ignoredDepth--;
          if (!ignoredDepth) ignoredTag = null;
        } else if (!tag.endsWith('/')) ignoredDepth++;
      }
      continue;
    }
    if (!closing && SKIP_TAGS.has(name)) {
      ignoredTag = name;
      ignoredDepth = 1;
      continue;
    }
    if (BLOCK_TAGS.has(name)) {
      if (!closing && /^h[1-6]$/.test(name)) { flush(); heading = true; }
      else if (name === 'br') flush();
      else if (closing) flush();
      else if (buffer.trim()) flush();
    }
  }
  if (ignoredTag) throw new RagProcessingError('EXTRACT_UNSUPPORTED_HTML');
  flush();
  if (!blocks.length) throw new RagProcessingError('EXTRACT_EMPTY');
  return blocks;
}

export function extractTextBlocks(text: string, media: 'text/plain' | 'text/markdown'): readonly RawLegalBlock[] {
  const normalizedLineEndings = text.replace(/\r\n?/g, '\n');
  const parts = normalizedLineEndings.split(/\n\s*\n/g);
  const result: RawLegalBlock[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const mdHeading = media === 'text/markdown' && /^#{1,6}\s+/.test(trimmed);
    result.push({
      kind: mdHeading ? 'heading' : 'text',
      text: mdHeading ? trimmed.replace(/^#{1,6}\s+/, '') : trimmed,
    });
  }
  if (!result.length) throw new RagProcessingError('EXTRACT_EMPTY');
  return result;
}
