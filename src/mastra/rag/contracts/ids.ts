import { createHash } from 'node:crypto';
import { RagContractError } from './errors.ts';

/** Reproducible SHA-256 over exact source bytes, not decoded or re-encoded text. */
export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function requireHashComponent(value: string): string {
  if (
    typeof value !== 'string' || value.length === 0 ||
    /[\r\n\0]/.test(value) || hasUnpairedSurrogate(value)
  ) {
    throw new RagContractError('INVALID_HASH_COMPONENT');
  }
  return value;
}

/** Includes a domain tag in every call to prevent cross-entity collisions. */
function fingerprint(...components: string[]): string {
  return sha256(components.map(requireHashComponent).join('\n'));
}

function serializeCanonical(value: unknown, visiting: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    if (hasUnpairedSurrogate(value)) throw new RagContractError('INVALID_CANONICAL_JSON');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new RagContractError('INVALID_CANONICAL_JSON');
    }
    return JSON.stringify(value);
  }
  if (typeof value !== 'object' || visiting.has(value)) {
    throw new RagContractError('INVALID_CANONICAL_JSON');
  }
  visiting.add(value);
  try {
    if (Array.isArray(value)) {
      // Array.map skips holes, which would collide with another JSON array.
      // Reject holes, accessor properties and non-index own keys before hashing.
      if (value.length > 10_000 || Object.keys(value).length !== value.length ||
          Object.getOwnPropertySymbols(value).length > 0) {
        throw new RagContractError('INVALID_CANONICAL_JSON');
      }
      const parts: string[] = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor)) {
          throw new RagContractError('INVALID_CANONICAL_JSON');
        }
        parts.push(serializeCanonical(descriptor.value, visiting));
      }
      return '[' + parts.join(',') + ']';
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new RagContractError('INVALID_CANONICAL_JSON');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new RagContractError('INVALID_CANONICAL_JSON');
    }
    const keys = Object.keys(value).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const parts: string[] = [];
    for (const key of keys) {
      if (hasUnpairedSurrogate(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) {
        throw new RagContractError('INVALID_CANONICAL_JSON');
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) {
        throw new RagContractError('INVALID_CANONICAL_JSON');
      }
      parts.push(JSON.stringify(key) + ':' + serializeCanonical(descriptor.value, visiting));
    }
    return '{' + parts.join(',') + '}';
  } finally {
    visiting.delete(value);
  }
}

/** Deterministic canonical JSON: recursive key ordering and no implicit coercion. */
export function canonicalJson(value: unknown): string {
  return serializeCanonical(value, new Set());
}

export function documentId(tenantId: string, sourceId: string, canonicalUri: string): string {
  return fingerprint('rag:document:v1', tenantId, sourceId, canonicalUri);
}
export function documentVersionId(id: string, contentSha256: string): string {
  return fingerprint('rag:version:v1', id, contentSha256);
}
export function pipelineProfileId(profile: unknown): string {
  return fingerprint('rag:profile:v1', canonicalJson(profile));
}
export function chunkSetId(versionId: string, profileId: string): string {
  return fingerprint('rag:chunkset:v1', versionId, profileId);
}
export function chunkId(chunkSet: string, ordinal: number): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new RagContractError('INVALID_HASH_COMPONENT');
  }
  return fingerprint('rag:chunk:v1', chunkSet, String(ordinal));
}
export function ingestionIdempotencyKey(
  id: string, contentSha256: string, profileId: string, spaceId: string,
): string {
  return fingerprint('rag:job:v1', 'ingest', id, contentSha256, profileId, spaceId);
}

/**
 * E1-pending durable ingestion identity. Unlike historical rag:job:v1, v2
 * binds the ACTUAL rendered chunk-set identity produced by Step C.
 * Compute only after deterministic rendering, then persist job ownership
 * before any provider call/upsert. This function has no side effects.
 */
export function renderedIngestionIdempotencyKey(
  id: string, renderedChunkSetId: string, spaceId: string,
): string {
  if (!/^[0-9a-f]{64}$/.test(id) || !/^[0-9a-f]{64}$/.test(renderedChunkSetId) ||
      !/^chunks_[a-z0-9_]{1,33}$/.test(spaceId)) {
    throw new RagContractError('INVALID_HASH_COMPONENT');
  }
  return fingerprint('rag:job:v2', 'ingest', id, renderedChunkSetId, spaceId);
}
