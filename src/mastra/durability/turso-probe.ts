import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const DURABILITY_PROBE_RESOURCE = '__mastra-rag-turso-durability__';
const PREFIX = 'mastra-rag-durability-';
const PROBE_ID_PATTERN =
  /^mastra-rag-durability-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ProbeThread = {
  id: string;
  resourceId: string;
  title?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type ProbeMemoryStore = {
  saveThread(args: { thread: ProbeThread }): Promise<ProbeThread>;
  getThreadById(args: { threadId: string; resourceId?: string }): Promise<ProbeThread | null>;
  deleteThread(args: { threadId: string }): Promise<void>;
};

export type ProbeReceipt = Readonly<{
  probeId: string;
  fingerprint: string;
  createdAt: string;
}>;

export function isProbeEnabled(
  environment: Readonly<{ TURSO_DURABILITY_PROBE_ENABLED?: string; TURSO_DATABASE_URL?: string }> = process.env,
): boolean {
  return (
    environment.TURSO_DURABILITY_PROBE_ENABLED === 'true' &&
    /^(?:libsql|https|wss):\/\//.test(environment.TURSO_DATABASE_URL ?? '')
  );
}

export function isProbeId(value: unknown): value is string {
  return typeof value === 'string' && PROBE_ID_PATTERN.test(value);
}

function checksum(marker: string): string {
  return createHash('sha256').update(marker).digest('hex');
}

function receipt(thread: ProbeThread): ProbeReceipt | null {
  if (
    !isProbeId(thread.id) ||
    thread.resourceId !== DURABILITY_PROBE_RESOURCE ||
    thread.metadata?.durabilityProbeVersion !== 1 ||
    typeof thread.metadata?.marker !== 'string' ||
    !/^[0-9a-f]{64}$/.test(thread.metadata.marker)
  ) {
    return null;
  }
  const date = new Date(thread.createdAt);
  if (Number.isNaN(date.valueOf())) return null;
  return {
    probeId: thread.id,
    fingerprint: checksum(thread.metadata.marker),
    createdAt: date.toISOString(),
  };
}

export class DurabilityProbeCreationError extends Error {
  readonly probeId: string;
  readonly cleanupConfirmed: boolean;

  constructor(probeId: string, cleanupConfirmed: boolean) {
    super('Durability probe creation could not be verified.');
    this.name = 'DurabilityProbeCreationError';
    this.probeId = probeId;
    this.cleanupConfirmed = cleanupConfirmed;
  }
}

/** Write only a generated test thread into the standard Mastra memory domain. */
export async function createDurabilityProbe(memory: ProbeMemoryStore): Promise<ProbeReceipt> {
  const now = new Date();
  const thread: ProbeThread = {
    id: PREFIX + randomUUID(),
    resourceId: DURABILITY_PROBE_RESOURCE,
    title: 'Temporary Mastra RAG storage durability assay',
    metadata: {
      durabilityProbeVersion: 1,
      marker: randomBytes(32).toString('hex'),
    },
    createdAt: now,
    updatedAt: now,
  };
  try {
    await memory.saveThread({ thread });
    // Read-after-write confirms that the backing store accepted the record.
    const actual = await memory.getThreadById({ threadId: thread.id, resourceId: DURABILITY_PROBE_RESOURCE });
    const written = actual && receipt(actual);
    const expected = receipt(thread);
    if (!written || written.fingerprint !== expected?.fingerprint) {
      throw new Error('Probe verification did not match.');
    }
    return written;
  } catch {
    // saveThread can have succeeded even if the confirmation read failed.
    // Best-effort deletion only targets this newly generated random UUID.
    let cleanupConfirmed = false;
    try {
      await memory.deleteThread({ threadId: thread.id });
      cleanupConfirmed =
        (await memory.getThreadById({ threadId: thread.id, resourceId: DURABILITY_PROBE_RESOURCE })) === null;
    } catch {
      // Leave an operator-accessible recovery ID; do not disclose driver errors.
    }
    throw new DurabilityProbeCreationError(thread.id, cleanupConfirmed);
  }
}

/** Read independently on a new process using only the server-side database. */
export async function readDurabilityProbe(
  memory: ProbeMemoryStore,
  probeId: string,
): Promise<ProbeReceipt | null> {
  if (!isProbeId(probeId)) return null;
  const thread = await memory.getThreadById({ threadId: probeId, resourceId: DURABILITY_PROBE_RESOURCE });
  return thread && receipt(thread);
}

/** Delete only a structurally verified test thread in our reserved namespace. */
export async function deleteDurabilityProbe(memory: ProbeMemoryStore, probeId: string): Promise<boolean> {
  if (!isProbeId(probeId)) return false;
  const existing = await memory.getThreadById({
    threadId: probeId,
    resourceId: DURABILITY_PROBE_RESOURCE,
  });
  // Cleanup must work for a partially-written probe, even if its metadata
  // is corrupt or incomplete. Never delete threads outside our owned resource.
  if (!existing || existing.id !== probeId || existing.resourceId !== DURABILITY_PROBE_RESOURCE) {
    return false;
  }
  await memory.deleteThread({ threadId: probeId });
  const remaining = await memory.getThreadById({
    threadId: probeId,
    resourceId: DURABILITY_PROBE_RESOURCE,
  });
  if (remaining !== null) throw new Error('Durability probe cleanup could not be verified.');
  return true;
}
