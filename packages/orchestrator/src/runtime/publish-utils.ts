import { resolveHeadingTheme as resolveHeadingThemeShared } from '@esl-pipeline/shared-infrastructure';

import type { PresetMap } from '../config.js';

export function resolveHeadingTheme(
  preset?: PresetMap[string],
): { h2?: string; h3?: string } | undefined {
  return resolveHeadingThemeShared(preset);
}
