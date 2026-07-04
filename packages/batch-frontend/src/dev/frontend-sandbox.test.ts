import { describe, expect, it } from 'vitest';

import { FRONTEND_SANDBOX_MODE, isFrontendSandboxEnabled } from './frontend-sandbox';

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
});
