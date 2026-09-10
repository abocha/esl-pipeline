const hostedComprehensiveRegressionRequirement = {
  id: 'CI gate',
  reason:
    'affected routing requires conservative broad validation; hosted PR CI owns comprehensive regression',
};

export function resolveAffectedCheckExecution({ plan, agentMode, broadRun }) {
  const deferredBroadFallback =
    agentMode && !broadRun && plan.fallback
      ? {
          lane: plan.fallback.lane,
          reason: plan.fallback.reason,
        }
      : null;

  return {
    executeLanes: deferredBroadFallback === null,
    deferredBroadFallback,
    ciRequirements: deferredBroadFallback
      ? addCiRequirement(plan.ciRequirements, hostedComprehensiveRegressionRequirement)
      : plan.ciRequirements,
  };
}

function addCiRequirement(requirements, required) {
  return requirements.some((requirement) => requirement.id === required.id)
    ? requirements
    : [...requirements, required];
}
