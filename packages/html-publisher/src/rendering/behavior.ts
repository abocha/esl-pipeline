import { buildPronunciationBehaviorScript } from './behavior-pronunciation.js';
import { buildTableBehaviorScript } from './behavior-tables.js';
import { buildUiBehaviorScript } from './behavior-ui.js';
import type { ResolvedFeatures } from './options.js';

export function buildBehaviorScript(features: ResolvedFeatures): string {
  return `<script>
(() => {
${buildUiBehaviorScript(features)}
${buildTableBehaviorScript()}
${buildPronunciationBehaviorScript()}
})();
</script>`;
}
