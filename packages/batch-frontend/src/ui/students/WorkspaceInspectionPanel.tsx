import type {
  JobProvenanceResponse,
  PromptPackageLineageResponse,
  StudentMemoryOverviewResponse,
} from '../../utils/api';

export interface WorkspaceInspectionSelection {
  jobId: string;
  promptPackageId: string | null;
}

export interface WorkspaceInspectionPanelProps {
  selectedJob: WorkspaceInspectionSelection | null;
  jobProvenanceLoading: boolean;
  jobProvenanceError: string | null;
  jobProvenance: JobProvenanceResponse | null;
  memoryOverviewLoading: boolean;
  memoryOverviewError: string | null;
  memoryOverview: StudentMemoryOverviewResponse | null;
  lineageLoading: boolean;
  lineageError: string | null;
  lineage: PromptPackageLineageResponse | null;
  formatDateTime: (value?: string | null) => string;
}

export function WorkspaceInspectionPanel({
  selectedJob,
  jobProvenanceLoading,
  jobProvenanceError,
  jobProvenance,
  memoryOverviewLoading,
  memoryOverviewError,
  memoryOverview,
  lineageLoading,
  lineageError,
  lineage,
  formatDateTime,
}: WorkspaceInspectionPanelProps) {
  return (
    <article className="workspace-card card">
      <header>
        <h2>Lineage & Provenance</h2>
        <p>Inspect selected assignment provenance and pinned prompt lineage.</p>
      </header>

      {selectedJob ? (
        <p className="workspace-muted">
          Inspecting job <code>{selectedJob.jobId}</code>
        </p>
      ) : (
        <p className="workspace-muted">Select an assignment from history first.</p>
      )}

      {jobProvenanceLoading ? <p className="workspace-muted">Loading job provenance...</p> : null}
      {jobProvenanceError ? <p className="workspace-error">{jobProvenanceError}</p> : null}

      {jobProvenance ? (
        <div className="workspace-meta">
          <span>
            <strong>Source job:</strong> {jobProvenance.job.sourceJobId ?? 'none'}
          </span>
          <span>
            <strong>Recording:</strong> {jobProvenance.recording?.id ?? 'n/a'}
          </span>
          <span>
            <strong>Prompt package:</strong> {jobProvenance.promptPackage?.id ?? 'n/a'}
          </span>
          <span>
            <strong>Draft:</strong> {jobProvenance.draft?.id ?? 'n/a'}
          </span>
          <span>
            <strong>Action audit:</strong> {jobProvenance.actions.length}
          </span>
        </div>
      ) : null}

      {(jobProvenance?.pronunciationWarnings ?? []).length ? (
        <div className="workspace-list">
          <div className="workspace-list-item workspace-list-item-stack">
            <div>
              <strong>Audio notices</strong>
              <div className="workspace-muted">
                This rerun completed with fallback audio resolution details worth checking.
              </div>
            </div>
            <div>
              {(jobProvenance?.pronunciationWarnings ?? []).map((warning) => (
                <div key={warning.code} className="workspace-muted">
                  {warning.message}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {jobProvenance?.actions.length ? (
        <div className="workspace-list">
          {jobProvenance.actions.slice(0, 8).map((action) => (
            <div key={action.id} className="workspace-list-item">
              <div>
                <strong>{action.actionType}</strong>
                <div className="workspace-muted">
                  {new Date(action.requestedAt).toLocaleString()} by{' '}
                  {action.requestedBy ?? 'unknown'}
                </div>
              </div>
              <span>{action.outcome}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <h3>Student Memory</h3>
        <p className="workspace-muted">
          Latest snapshot summary plus the recent lesson and homework memory used to build
          continuity over time.
        </p>

        {memoryOverviewLoading ? (
          <p className="workspace-muted">Loading student memory...</p>
        ) : null}
        {memoryOverviewError ? <p className="workspace-error">{memoryOverviewError}</p> : null}

        {memoryOverview?.latestReadyStudentMemorySnapshot ? (
          <>
            <div className="workspace-meta">
              <span>
                <strong>Latest snapshot:</strong>{' '}
                {memoryOverview.latestReadyStudentMemorySnapshot.id}
              </span>
              <span>
                <strong>Status:</strong> {memoryOverview.latestReadyStudentMemorySnapshot.status}
              </span>
              <span>
                <strong>Generated:</strong>{' '}
                {formatDateTime(memoryOverview.latestReadyStudentMemorySnapshot.generatedAt)}
              </span>
            </div>
            <p>
              {memoryOverview.latestReadyStudentMemorySnapshot.snapshotSummary ??
                'No snapshot summary available.'}
            </p>
          </>
        ) : !memoryOverviewLoading && !memoryOverviewError ? (
          <p className="workspace-muted">No ready student-memory snapshot available yet.</p>
        ) : null}

        <div>
          <strong>Unresolved issues</strong>
          {memoryOverview?.unresolvedIssues.length ? (
            <div className="workspace-list">
              {memoryOverview.unresolvedIssues.map((issue) => (
                <div key={`${issue.issueType}:${issue.label}`} className="workspace-list-item">
                  <div>
                    <strong>{issue.label}</strong>
                    <div className="workspace-muted">{issue.note}</div>
                  </div>
                  <span>
                    {issue.issueType} · {issue.priority}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="workspace-muted">No unresolved issues recorded in the latest snapshot.</p>
          )}
        </div>

        <div>
          <strong>Recent lesson memory</strong>
          {memoryOverview?.recentReadyLessonMemory.length ? (
            <div className="workspace-list">
              {memoryOverview.recentReadyLessonMemory.map((entry) => (
                <div key={entry.id} className="workspace-list-item">
                  <div>
                    <strong>{entry.lessonSummary ?? 'Lesson memory entry'}</strong>
                    <div className="workspace-muted">
                      {entry.topicsDiscussed
                        .slice(0, 2)
                        .map((topic) => topic.topic)
                        .join(', ') || 'No topics recorded'}
                    </div>
                  </div>
                  <span>{formatDateTime(entry.generatedAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="workspace-muted">No recent lesson-memory entries available.</p>
          )}
        </div>

        <div>
          <strong>Recent homework memory</strong>
          {memoryOverview?.recentReadyHomeworkMemory.length ? (
            <div className="workspace-list">
              {memoryOverview.recentReadyHomeworkMemory.map((entry) => (
                <div key={entry.id} className="workspace-list-item">
                  <div>
                    <strong>{entry.topic ?? 'Homework memory entry'}</strong>
                    <div className="workspace-muted">
                      {entry.homeworkSummary ?? entry.communicativeOutcome ?? 'No summary recorded'}
                    </div>
                  </div>
                  <span>{formatDateTime(entry.publishedAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="workspace-muted">No recent homework-memory entries available.</p>
          )}
        </div>
      </div>

      {lineageLoading ? <p className="workspace-muted">Loading prompt lineage...</p> : null}
      {lineageError ? <p className="workspace-error">{lineageError}</p> : null}

      {lineage ? (
        <>
          <div className="workspace-meta">
            <span>
              <strong>Profile revision:</strong> {lineage.profile.snapshot.revisionId ?? 'n/a'}
            </span>
            <span>
              <strong>Template revision:</strong> {lineage.template.snapshot.revisionId ?? 'n/a'}
            </span>
            <span>
              <strong>Profile drift:</strong> {lineage.profile.drift?.reason ?? 'none'}
            </span>
            <span>
              <strong>Template drift:</strong> {lineage.template.drift?.reason ?? 'none'}
            </span>
            <span>
              <strong>Binding at creation:</strong> {lineage.bindingAtCreation?.profileId ?? 'n/a'}
            </span>
          </div>

          <div>
            <h3>Assignment Memory Provenance</h3>
            <div className="workspace-meta">
              <span>
                <strong>Snapshot at creation:</strong>{' '}
                {lineage.memory.studentMemorySnapshotId ?? 'none'}
              </span>
              <span>
                <strong>Snapshot hash:</strong> {lineage.memory.studentMemorySnapshotHash ?? 'none'}
              </span>
              <span>
                <strong>Retrieval policy:</strong> {lineage.memory.retrievalPolicyVersion ?? 'none'}
              </span>
            </div>

            <div className="workspace-meta">
              <span>
                <strong>Selected lesson memory IDs:</strong>{' '}
                {lineage.memory.selectedLessonMemoryIds.length > 0
                  ? lineage.memory.selectedLessonMemoryIds.join(', ')
                  : 'none'}
              </span>
              <span>
                <strong>Selected homework memory IDs:</strong>{' '}
                {lineage.memory.selectedHomeworkMemoryIds.length > 0
                  ? lineage.memory.selectedHomeworkMemoryIds.join(', ')
                  : 'none'}
              </span>
            </div>

            <div className="workspace-list">
              <div className="workspace-list-item">
                <strong>Layer availability</strong>
                <span>snapshot {lineage.memory.layerAvailability.studentMemorySnapshot}</span>
              </div>
              <div className="workspace-list-item">
                <strong>Recent lesson memory</strong>
                <span>{lineage.memory.layerAvailability.recentLessonMemory}</span>
              </div>
              <div className="workspace-list-item">
                <strong>Recent homework memory</strong>
                <span>{lineage.memory.layerAvailability.recentHomeworkMemory}</span>
              </div>
              <div className="workspace-list-item">
                <strong>Retrieval policy</strong>
                <span>{lineage.memory.layerAvailability.retrievalPolicy}</span>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </article>
  );
}
