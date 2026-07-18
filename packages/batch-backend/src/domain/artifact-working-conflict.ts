export class ArtifactWorkingConflictError<TLatest> extends Error {
  readonly code = 'ARTIFACT_WORKING_CONFLICT';

  constructor(readonly latest: TLatest) {
    super('The artifact working copy changed before this update could be saved.');
    this.name = 'ArtifactWorkingConflictError';
  }
}
