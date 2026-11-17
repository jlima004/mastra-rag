import { RagContractError } from './errors.ts';

/** Pure publication candidates. The actual decision MUST be repeated under
 * the document publication advisory transaction lock in E2. Never use this
 * pure function as a stand-alone authorization to write a publication row. */
export type RenderedObservation = Readonly<{
  chunkSetId: string;
  fetchedAt: string;
}>;

export type PublishedRenderedSet = Readonly<{
  chunkSetId: string;
  versionFetchedAt: string;
}>;

export type RenderedPublicationAssessment = Readonly<{
  outcome: 'publish' | 'no_op' | 'stale';
  /** Only same-render no-ops are allowed to advance the watermark. */
  advanceWatermark: boolean;
}>;

const HASH_ID = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function timestamp(value: string): number {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) {
    throw new RagContractError('INVALID_HASH_COMPONENT');
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new RagContractError('INVALID_HASH_COMPONENT');
  }
  return time;
}

function validSetId(value: string): void {
  if (typeof value !== 'string' || !HASH_ID.test(value)) {
    throw new RagContractError('INVALID_HASH_COMPONENT');
  }
}

/**
 * Compare only effective RENDERED chunk-set IDs. Identical normalized text
 * from a different raw source version is never an automatic no-op.
 *
 * E2 must serialize, re-read publication and deleted-at under a DB lock and
 * re-evaluate these semantics before any persistence. This is not E2.
 */
export function assessRenderedPublication(
  current: PublishedRenderedSet | null,
  observed: RenderedObservation,
): RenderedPublicationAssessment {
  if (!observed) throw new RagContractError('INVALID_HASH_COMPONENT');
  validSetId(observed.chunkSetId);
  const observedTime = timestamp(observed.fetchedAt);
  if (current === null) {
    return Object.freeze({ outcome: 'publish', advanceWatermark: false });
  }
  if (!current) throw new RagContractError('INVALID_HASH_COMPONENT');
  validSetId(current.chunkSetId);
  const currentTime = timestamp(current.versionFetchedAt);

  if (current.chunkSetId === observed.chunkSetId) {
    return Object.freeze({
      outcome: 'no_op', advanceWatermark: observedTime > currentTime,
    });
  }
  if (observedTime < currentTime ||
      (observedTime === currentTime && observed.chunkSetId <= current.chunkSetId)) {
    return Object.freeze({ outcome: 'stale', advanceWatermark: false });
  }
  return Object.freeze({ outcome: 'publish', advanceWatermark: false });
}
