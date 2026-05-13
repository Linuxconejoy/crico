import test from "node:test";
import assert from "node:assert/strict";

import { shouldUseAgentMode } from "../src/shared/agentModePolicy.js";

test("shouldUseAgentMode turns on the acting agent for either agent mode or permissive dev mode", () => {
  assert.equal(shouldUseAgentMode({ agentModeEnabled: true, permissiveDevModeEnabled: false }), true);
  assert.equal(shouldUseAgentMode({ agentModeEnabled: false, permissiveDevModeEnabled: true }), true);
  assert.equal(shouldUseAgentMode({ agentModeEnabled: false, permissiveDevModeEnabled: false }), false);
});
