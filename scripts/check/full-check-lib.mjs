export const FULL_CHECK_LANES = Object.freeze([
  lane('test:tooling'),
  lane('build'),
  lane('typecheck'),
  lane('lint'),
  lane('test:unit:prebuilt'),
  lane('test:integration:prebuilt'),
  lane('test:backend:db:worker'),
]);

export function buildFullCheckLanes() {
  return FULL_CHECK_LANES.map((entry) => ({ ...entry, pnpmArgs: [...entry.pnpmArgs] }));
}

export async function runFullCheckLanes({ lanes, runLane, onResult = () => {} }) {
  const results = [];
  for (const laneEntry of lanes) {
    const result = await runLane(laneEntry);
    results.push(result);
    await onResult(result);
    if (result.status !== 'pass') {
      break;
    }
  }
  return results;
}

export function buildFullCheckEvidence({ lanes, results }) {
  const firstFailure = results.find((result) => result.status !== 'pass');
  return {
    plannedLanes: lanes.map((laneEntry) => ({ name: laneEntry.id, repro: laneEntry.repro })),
    notRun: firstFailure
      ? lanes.slice(results.length).map((laneEntry) => ({
          name: laneEntry.id,
          status: 'not_run',
          reason: 'stopped_after_first_failure',
          stoppedAfter: firstFailure.name,
          repro: laneEntry.repro,
        }))
      : [],
  };
}

export function buildFullCheckLaneResult({ lane, exitCode, durationMs, output, artifacts = {} }) {
  return {
    name: lane.id,
    status: exitCode === 0 ? 'pass' : 'fail',
    exitCode,
    durationMs,
    signal: output,
    repro: lane.repro,
    artifacts,
  };
}

function lane(script) {
  return Object.freeze({
    id: script,
    pnpmArgs: Object.freeze([script]),
    repro: `pnpm ${script}`,
  });
}
