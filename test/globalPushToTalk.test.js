import test from "node:test";
import assert from "node:assert/strict";

import { buildWindowsPushToTalkPowerShellScript } from "../src/main/globalPushToTalk.js";

test("buildWindowsPushToTalkPowerShellScript emits the ready and press signals", () => {
  const script = buildWindowsPushToTalkPowerShellScript();

  assert.equal(script.includes("READY"), true);
  assert.equal(script.includes("PTT_START"), true);
  assert.equal(script.includes("PTT_STOP"), true);
});

test("buildWindowsPushToTalkPowerShellScript uses a low-level keyboard hook", () => {
  const script = buildWindowsPushToTalkPowerShellScript();

  assert.equal(script.includes("WH_KEYBOARD_LL"), true);
  assert.equal(script.includes("SetWindowsHookEx"), true);
  assert.equal(script.includes("KBDLLHOOKSTRUCT"), true);
  assert.equal(script.includes("UpdateModifierState"), true);
  assert.equal(script.includes("IsModifierVirtualKey"), true);
  assert.equal(script.includes("VK_CONTROL"), true);
});
