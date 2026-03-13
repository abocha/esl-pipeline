export type GuidedActionName = 'backup' | 'drill';

export type GuidedCallbackAction =
  | { kind: 'home' }
  | { kind: 'status' }
  | { kind: 'finished' }
  | { kind: 'recent_ops' }
  | { kind: 'job'; jobId: string }
  | { kind: 'op'; operationId: string }
  | { kind: 'job_links'; jobId: string }
  | { kind: 'job_share'; jobId: string }
  | { kind: 'action'; action: GuidedActionName }
  | { kind: 'confirm'; action: GuidedActionName };

const CALLBACK_VERSION = 'a4';

export function encodeGuidedCallback(action: GuidedCallbackAction): string {
  switch (action.kind) {
    case 'home':
      return `${CALLBACK_VERSION}|h`;
    case 'status':
      return `${CALLBACK_VERSION}|s`;
    case 'finished':
      return `${CALLBACK_VERSION}|f`;
    case 'recent_ops':
      return `${CALLBACK_VERSION}|r`;
    case 'job':
      return `${CALLBACK_VERSION}|j|${action.jobId}`;
    case 'op':
      return `${CALLBACK_VERSION}|o|${action.operationId}`;
    case 'job_links':
      return `${CALLBACK_VERSION}|jl|${action.jobId}`;
    case 'job_share':
      return `${CALLBACK_VERSION}|js|${action.jobId}`;
    case 'action':
      return `${CALLBACK_VERSION}|a|${action.action}`;
    case 'confirm':
      return `${CALLBACK_VERSION}|c|${action.action}`;
  }
}

export function decodeGuidedCallback(value: string): GuidedCallbackAction | null {
  const [version, kind, param, extra] = value.split('|');
  if (version !== CALLBACK_VERSION || !kind || extra) {
    return null;
  }

  switch (kind) {
    case 'h':
      return { kind: 'home' };
    case 's':
      return { kind: 'status' };
    case 'f':
      return { kind: 'finished' };
    case 'r':
      return { kind: 'recent_ops' };
    case 'j':
      return param ? { kind: 'job', jobId: param } : null;
    case 'o':
      return param ? { kind: 'op', operationId: param } : null;
    case 'jl':
      return param ? { kind: 'job_links', jobId: param } : null;
    case 'js':
      return param ? { kind: 'job_share', jobId: param } : null;
    case 'a':
      return param === 'backup' || param === 'drill' ? { kind: 'action', action: param } : null;
    case 'c':
      return param === 'backup' || param === 'drill'
        ? { kind: 'confirm', action: param }
        : null;
    default:
      return null;
  }
}
