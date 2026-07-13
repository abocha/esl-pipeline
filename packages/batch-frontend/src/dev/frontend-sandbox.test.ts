import { describe, expect, it } from 'vitest';

import {
  FRONTEND_SANDBOX_MODE,
  isFrontendSandboxEnabled,
  readFrontendSandboxScenario,
} from './frontend-sandbox';

describe('frontend sandbox mode', () => {
  it('enables mock auth only for the explicit dev sandbox flag', () => {
    expect(
      isFrontendSandboxEnabled({
        DEV: true,
        PROD: false,
        VITE_BATCH_FRONTEND_SANDBOX: FRONTEND_SANDBOX_MODE,
      }),
    ).toBe(true);
  });

  it('stays disabled without the explicit sandbox flag', () => {
    expect(isFrontendSandboxEnabled({ DEV: true, PROD: false })).toBe(false);
    expect(
      isFrontendSandboxEnabled({
        DEV: true,
        PROD: false,
        VITE_BATCH_FRONTEND_SANDBOX: 'real-backend',
      }),
    ).toBe(false);
  });

  it('stays disabled for production-like env even when the sandbox flag is present', () => {
    expect(
      isFrontendSandboxEnabled({
        DEV: false,
        PROD: true,
        VITE_BATCH_FRONTEND_SANDBOX: FRONTEND_SANDBOX_MODE,
      }),
    ).toBe(false);
  });

  it.each([
    ['', 'default'],
    ['?sandboxScenario=step-one-no-recent', 'step-one-no-recent'],
    ['?sandboxScenario=step-one-resume-states', 'step-one-resume-states'],
    ['?sandboxScenario=step-one-resume-error', 'step-one-resume-error'],
    ['?sandboxScenario=step-one-no-learners', 'step-one-no-learners'],
    ['?sandboxScenario=step-one-learner-error', 'step-one-learner-error'],
    ['?sandboxScenario=step-one-slow', 'step-one-slow'],
    ['?sandboxScenario=unknown', 'default'],
  ] as const)('normalizes %s to the allow-listed %s scenario', (search, scenario) => {
    expect(readFrontendSandboxScenario(search)).toBe(scenario);
  });
});
