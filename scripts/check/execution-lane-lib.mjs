const turboBuildLaneId = 'turbo:build';
const broadBuildLaneId = 'build';
const routingLaneId = 'test:check-routing';

export function buildExecutionLanes(currentPlan) {
  const preTurboLanes = currentPlan.triggeredLanes.filter(
    (lane) => !lane.id.startsWith('backend:'),
  );
  const postTurboLanes = currentPlan.triggeredLanes.filter((lane) =>
    lane.id.startsWith('backend:'),
  );
  const lanes = [...preTurboLanes.map((lane) => ({ ...lane, kind: 'pnpm' }))];
  if (currentPlan.turbo) {
    lanes.push(
      ...currentPlan.turbo.taskGroups.map((group) => ({
        id: group.id,
        pnpmArgs: group.args,
        reason: `affected workspace package ${group.task} graph`,
        repro: group.repro,
        kind: 'pnpm',
      })),
    );
  }
  lanes.push(...postTurboLanes.map((lane) => ({ ...lane, kind: 'pnpm' })));

  const hasTurboBuildLane = lanes.some((lane) => lane.id === turboBuildLaneId);
  const hasBroadBuildLane = lanes.some((lane) => lane.id === broadBuildLaneId);
  const hasRoutingLane = lanes.some((lane) => lane.id === routingLaneId);
  return lanes.map((lane) => ({
    ...lane,
    dependsOn: resolveDependencies({
      laneId: lane.id,
      hasTurboBuildLane,
      hasBroadBuildLane,
      hasRoutingLane,
    }),
  }));
}

export function resolveLaneDisposition(lane, priorResults) {
  const resultByName = new Map(priorResults.map((result) => [result.name, result]));
  const blockedBy = (lane.dependsOn ?? []).filter(
    (dependency) => resultByName.get(dependency)?.status !== 'pass',
  );
  return blockedBy.length > 0 ? { action: 'block', blockedBy } : { action: 'run' };
}

export function buildBlockedLaneResult(lane, blockedBy) {
  return {
    name: lane.id,
    status: 'blocked',
    exitCode: null,
    durationMs: 0,
    signal: `blocked by failed prerequisite: ${blockedBy.join(', ')}`,
    blockedBy,
    repro: lane.repro,
    artifacts: {},
  };
}

export async function runExecutionLanes({ lanes, runLane, onResult = () => {} }) {
  const results = [];
  for (const lane of lanes) {
    const disposition = resolveLaneDisposition(lane, results);
    const result =
      disposition.action === 'block'
        ? buildBlockedLaneResult(lane, disposition.blockedBy)
        : await runLane(lane);
    results.push(result);
    await onResult(result);
  }
  return results;
}

function isPrebuiltConsumer(laneId) {
  return laneId === 'turbo:test:unit:prebuilt' || laneId.startsWith('backend:test:');
}

function resolveDependencies({ laneId, hasTurboBuildLane, hasBroadBuildLane, hasRoutingLane }) {
  const dependencies = [];
  if (hasTurboBuildLane && isPrebuiltConsumer(laneId)) {
    dependencies.push(turboBuildLaneId);
  }
  if (hasBroadBuildLane && laneId === 'test:unit:prebuilt:fast') {
    dependencies.push(broadBuildLaneId);
  }
  if (
    hasRoutingLane &&
    (laneId === 'turbo:test:unit:prebuilt' || laneId === 'test:unit:prebuilt:fast')
  ) {
    dependencies.push(routingLaneId);
  }
  return dependencies;
}
