export function shouldUseAgentMode(config = {}) {
  return Boolean(config?.agentModeEnabled || config?.permissiveDevModeEnabled);
}
