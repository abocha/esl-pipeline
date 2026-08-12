const coverageTargets = [
  { key: 'batch-frontend', packageName: '@esl-pipeline/batch-frontend' },
  { key: 'batch-backend', packageName: '@esl-pipeline/batch-backend' },
  { key: 'orchestrator', packageName: '@esl-pipeline/orchestrator' },
  { key: 'tts-elevenlabs', packageName: '@esl-pipeline/tts-provider-elevenlabs' },
];

export function buildCoreCoveragePlan() {
  const preparationArgs = ['exec', 'turbo', 'run', 'build'];
  for (const target of coverageTargets) {
    preparationArgs.push('--filter', target.packageName);
  }

  return {
    preparation: { args: preparationArgs },
    coverage: coverageTargets.map((target) => ({
      ...target,
      args: [
        '--filter',
        target.packageName,
        'run',
        'test:unit:prebuilt',
        '--coverage.enabled',
        '--coverage.reporter=json-summary',
        '--coverage.reporter=json',
        `--coverage.reportsDirectory=../../tmp/coverage/${target.key}`,
      ],
    })),
  };
}
