export const FRONTEND_SANDBOX_MODE = 'mock-auth';
export const FRONTEND_SANDBOX_ACCESS_TOKEN = 'sandbox-access-token';

export type FrontendSandboxScenario =
  | 'default'
  | 'step-one-no-recent'
  | 'step-one-resume-states'
  | 'step-one-resume-error'
  | 'step-one-no-learners'
  | 'step-one-learner-error'
  | 'student-availability'
  | 'step-one-slow';

const frontendSandboxScenarios = new Set<FrontendSandboxScenario>([
  'default',
  'step-one-no-recent',
  'step-one-resume-states',
  'step-one-resume-error',
  'step-one-no-learners',
  'step-one-learner-error',
  'student-availability',
  'step-one-slow',
]);

export interface FrontendSandboxEnv {
  DEV?: boolean;
  PROD?: boolean;
  VITE_BATCH_FRONTEND_SANDBOX?: unknown;
}

function currentViteEnv(): FrontendSandboxEnv {
  return ((import.meta as { env?: FrontendSandboxEnv }).env ?? {}) as FrontendSandboxEnv;
}

export function isFrontendSandboxEnabled(env: FrontendSandboxEnv = currentViteEnv()): boolean {
  return (
    env.DEV === true &&
    env.PROD !== true &&
    env.VITE_BATCH_FRONTEND_SANDBOX === FRONTEND_SANDBOX_MODE
  );
}

export function readFrontendSandboxScenario(search: string): FrontendSandboxScenario {
  const scenario = new URLSearchParams(search).get('sandboxScenario');
  return scenario && frontendSandboxScenarios.has(scenario as FrontendSandboxScenario)
    ? (scenario as FrontendSandboxScenario)
    : 'default';
}

export function getFrontendSandboxUser() {
  return {
    id: 'sandbox-tutor',
    email: 'sandbox.tutor@example.test',
    role: 'user' as const,
    isActive: true,
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
  };
}
