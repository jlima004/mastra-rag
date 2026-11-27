export type IngestionFailure =
  | 'E2_DATABASE_FAILURE'
  | 'E2_IDENTITY_CONFLICT'
  | 'E2_DOCUMENT_DELETED'
  | 'E2_JOB_BUSY'
  | 'E2_JOB_FENCED'
  | 'E2_JOB_BLOCKED'
  | 'E2_SPACE_INVALID'
  | 'E2_BUILD_INVALID'
  | 'E2_INPUT_INVALID'
  | 'E2_PROJECTION_PURGED';

export class IngestionError extends Error {
  readonly code: IngestionFailure;

  constructor(code: IngestionFailure) {
    super(code);
    this.code = code;
  }
}
