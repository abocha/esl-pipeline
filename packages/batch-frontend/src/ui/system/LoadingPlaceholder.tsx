import './LoadingPlaceholder.css';

export function LoadingPlaceholder({
  label,
  kind = 'rows',
  count = 3,
}: {
  label: string;
  kind?: 'rows' | 'lines' | 'roster' | 'form' | 'inline';
  count?: number;
}) {
  return (
    <div
      className={`loading-placeholder loading-placeholder--${kind}`}
      role="status"
      aria-label={label}
    >
      <span className="loading-placeholder__label">{label}</span>
      <div className="loading-placeholder__shapes" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <div className="loading-placeholder__row" key={index}>
            <span />
            <span />
          </div>
        ))}
      </div>
    </div>
  );
}

const pageTitles = {
  overview: 'Overview',
  learning: 'Learning',
  history: 'History',
  schedule: 'Schedule',
  billing: 'Billing',
  day: 'Your day',
  assignments: 'Assignments',
  students: 'Students',
  business: 'Business',
} as const;

export function PageLoading({ page, label }: { page?: keyof typeof pageTitles; label?: string }) {
  const title = page && pageTitles[page];
  return (
    <section className={`page-loading${page ? ` page-loading--${page}` : ''}`}>
      {title && (
        <header className="page-loading__heading">
          <h2>{title}</h2>
          <span className="page-loading__action" aria-hidden="true" />
        </header>
      )}
      {page === 'learning' || page === 'assignments' || page === 'history' ? (
        <div className="page-loading__toolbar" aria-hidden="true">
          <span />
          <span />
        </div>
      ) : null}
      <div className="page-loading__body">
        <div>
          {page === 'schedule' || page === 'billing' || page === 'overview' ? (
            <div className="page-loading__summary" aria-hidden="true">
              <span />
              <span />
            </div>
          ) : null}
          <LoadingPlaceholder label={label ?? (title ? `Loading ${title}` : 'Loading workspace')} />
        </div>
        {page === 'overview' && (
          <aside className="page-loading__glance" aria-hidden="true">
            <span />
            <span />
            <span />
          </aside>
        )}
      </div>
    </section>
  );
}
