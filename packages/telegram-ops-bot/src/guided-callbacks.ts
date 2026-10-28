export type GuidedActionName = 'backup' | 'integrity';
export type JobsViewKey =
  | 'gr'
  | 'gf'
  | 'gn'
  | 'gs'
  | 'ta'
  | 'tf'
  | 'tn'
  | 'tw'
  | 'ts'
  | `sr:${string}`
  | `sf:${string}`
  | `ss:${string}`
  | `q:${string}`;

export type GuidedCallbackAction =
  | { kind: 'home' }
  | { kind: 'status' }
  | { kind: 'today' }
  | { kind: 'finished' }
  | { kind: 'recent_ops' }
  | { kind: 'students_home' }
  | { kind: 'students_page'; offset: number }
  | { kind: 'jobs_view'; viewKey: JobsViewKey }
  | { kind: 'student'; studentId: string }
  | { kind: 'job'; jobId: string; backViewKey?: JobsViewKey }
  | { kind: 'op'; operationId: string }
  | { kind: 'job_links'; jobId: string }
  | { kind: 'job_share'; jobId: string }
  | { kind: 'action'; action: GuidedActionName }
  | { kind: 'confirm'; action: GuidedActionName };

const CALLBACK_VERSION = 'a4';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function compactJobId(id: string): string {
  return UUID.test(id)
    ? `~${Buffer.from(id.replaceAll('-', ''), 'hex').toString('base64url')}`
    : id;
}
function expandJobId(id: string): string | null {
  if (!id.startsWith('~')) return id;
  if (!/^~[A-Za-z0-9_-]{22}$/.test(id)) return null;
  const bytes = Buffer.from(id.slice(1), 'base64url');
  if (bytes.length !== 16 || bytes.toString('base64url') !== id.slice(1)) return null;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function encodeGuidedCallback(action: GuidedCallbackAction): string {
  switch (action.kind) {
    case 'home': {
      return `${CALLBACK_VERSION}|h`;
    }
    case 'status': {
      return `${CALLBACK_VERSION}|s`;
    }
    case 'today': {
      return `${CALLBACK_VERSION}|t`;
    }
    case 'finished': {
      return `${CALLBACK_VERSION}|f`;
    }
    case 'recent_ops': {
      return `${CALLBACK_VERSION}|r`;
    }
    case 'students_home': {
      return `${CALLBACK_VERSION}|sh`;
    }
    case 'students_page': {
      return `${CALLBACK_VERSION}|sp|${action.offset}`;
    }
    case 'jobs_view': {
      return `${CALLBACK_VERSION}|v|${action.viewKey}`;
    }
    case 'student': {
      return `${CALLBACK_VERSION}|st|${action.studentId}`;
    }
    case 'job': {
      return action.backViewKey
        ? `${CALLBACK_VERSION}|j|${compactJobId(action.jobId)}|${action.backViewKey}`
        : `${CALLBACK_VERSION}|j|${action.jobId}`;
    }
    case 'op': {
      return `${CALLBACK_VERSION}|o|${action.operationId}`;
    }
    case 'job_links': {
      return `${CALLBACK_VERSION}|jl|${action.jobId}`;
    }
    case 'job_share': {
      return `${CALLBACK_VERSION}|js|${action.jobId}`;
    }
    case 'action': {
      return `${CALLBACK_VERSION}|a|${action.action}`;
    }
    case 'confirm': {
      return `${CALLBACK_VERSION}|c|${action.action}`;
    }
  }
}

export function decodeGuidedCallback(value: string): GuidedCallbackAction | null {
  const parts = value.split('|');
  const [version, kind, ...rest] = parts;
  if (version !== CALLBACK_VERSION || !kind) {
    return null;
  }

  switch (kind) {
    case 'h': {
      return { kind: 'home' };
    }
    case 's': {
      return { kind: 'status' };
    }
    case 't': {
      return rest.length === 0 ? { kind: 'today' } : null;
    }
    case 'f': {
      return { kind: 'finished' };
    }
    case 'r': {
      return { kind: 'recent_ops' };
    }
    case 'sh': {
      return rest.length === 0 ? { kind: 'students_home' } : null;
    }
    case 'sp': {
      if (rest.length !== 1) {
        return null;
      }
      const offset = Number(rest[0]);
      return Number.isInteger(offset) && offset >= 0 ? { kind: 'students_page', offset } : null;
    }
    case 'v': {
      if (rest.length !== 1) {
        return null;
      }
      const [viewKey] = rest;
      return viewKey && isJobsViewKey(viewKey) ? { kind: 'jobs_view', viewKey } : null;
    }
    case 'st': {
      return rest.length === 1 && rest[0] ? { kind: 'student', studentId: rest[0] } : null;
    }
    case 'j': {
      if (rest.length === 1 && rest[0]) {
        return { kind: 'job', jobId: rest[0] };
      }
      const [encodedJobId, backViewKey] = rest;
      const jobId = encodedJobId ? expandJobId(encodedJobId) : null;
      if (rest.length === 2 && jobId && backViewKey && isJobsViewKey(backViewKey)) {
        return { kind: 'job', jobId, backViewKey };
      }
      return null;
    }
    case 'o': {
      return rest.length === 1 && rest[0] ? { kind: 'op', operationId: rest[0] } : null;
    }
    case 'jl': {
      return rest.length === 1 && rest[0] ? { kind: 'job_links', jobId: rest[0] } : null;
    }
    case 'js': {
      return rest.length === 1 && rest[0] ? { kind: 'job_share', jobId: rest[0] } : null;
    }
    case 'a': {
      return rest.length === 1 && (rest[0] === 'backup' || rest[0] === 'integrity')
        ? { kind: 'action', action: rest[0] }
        : null;
    }
    case 'c': {
      return rest.length === 1 && (rest[0] === 'backup' || rest[0] === 'integrity')
        ? { kind: 'confirm', action: rest[0] }
        : null;
    }
    default: {
      return null;
    }
  }
}

function isJobsViewKey(value: string): value is JobsViewKey {
  return /^(gr|gf|gn|gs|ta|tf|tn|tw|ts|s[rfs]:[a-z0-9-]{1,16}|q:(?:[a-z0-9_-]{22}|[a-z0-9_-]{28}))$/i.test(
    value,
  );
}
