import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveSystemControlPolicy,
  shouldRequireApprovalForTool
} from "../src/shared/systemControlPolicy.js";

test("deriveSystemControlPolicy only enables system control for explicit voice requests", () => {
  const voicePolicy = deriveSystemControlPolicy({
    requestSource: "voice-session",
    userPrompt: "haz clic en el boton guardar y luego escribe hola"
  });
  const manualPolicy = deriveSystemControlPolicy({
    requestSource: "manual-session",
    userPrompt: "haz clic en el boton guardar y luego escribe hola"
  });

  assert.equal(voicePolicy.isVoiceRequest, true);
  assert.equal(voicePolicy.isSystemControlAllowed, true);
  assert.equal(voicePolicy.allowMouseControl, true);
  assert.equal(voicePolicy.allowKeyboardControl, true);
  assert.equal(voicePolicy.allowLaunchControl, false);
  assert.equal(voicePolicy.autonomyMode, "standard");

  assert.equal(manualPolicy.isVoiceRequest, false);
  assert.equal(manualPolicy.isSystemControlAllowed, false);
  assert.equal(manualPolicy.allowMouseControl, false);
  assert.equal(manualPolicy.allowKeyboardControl, false);
});

test("deriveSystemControlPolicy detects launch, close, switching, and file search intent", () => {
  const policy = deriveSystemControlPolicy({
    requestSource: "voice-session",
    userPrompt: "abre notepad, cambia a la otra ventana, cierra teams y busca archivo budget.xlsx"
  });

  assert.equal(policy.allowLaunchControl, true);
  assert.equal(policy.allowCloseControl, true);
  assert.equal(policy.allowWindowSwitching, true);
  assert.equal(policy.allowFileSearch, true);
  assert.deepEqual(policy.requestedCapabilities, ["launch", "close", "window-switch", "file-search"]);
});

test("deriveSystemControlPolicy recognizes shortcut requests that include spaces around the plus sign", () => {
  const policy = deriveSystemControlPolicy({
    requestSource: "voice-session",
    userPrompt: "presiona Ctrl + Shift + P y luego Alt + Tab"
  });

  assert.equal(policy.allowKeyboardControl, true);
  assert.equal(policy.allowWindowSwitching, true);
});

test("deriveSystemControlPolicy treats hands-on help requests as permission to operate the visible app", () => {
  const policy = deriveSystemControlPolicy({
    requestSource: "voice-session",
    userPrompt: "ayudame con photoshop, tengo problemas con las sombras y hazlo tu"
  });

  assert.equal(policy.isHandsOnAssistanceRequest, true);
  assert.equal(policy.isSystemControlAllowed, true);
  assert.equal(policy.allowMouseControl, true);
  assert.equal(policy.allowKeyboardControl, true);
  assert.equal(policy.allowLaunchControl, true);
  assert.equal(policy.allowWindowSwitching, true);
  assert.equal(policy.allowCloseControl, false);
  assert.equal(policy.allowFileSearch, true);
});

test("deriveSystemControlPolicy lets manual prompts drive system control in permissive dev mode", () => {
  const policy = deriveSystemControlPolicy({
    requestSource: "manual-session",
    userPrompt: "ayudame con burpsuite y hazlo tu",
    permissiveDevModeEnabled: true
  });

  assert.equal(policy.isVoiceRequest, false);
  assert.equal(policy.isPermissiveDevModeEnabled, true);
  assert.equal(policy.isSystemControlAllowed, true);
  assert.equal(policy.allowMouseControl, true);
  assert.equal(policy.allowKeyboardControl, true);
  assert.equal(policy.allowLaunchControl, true);
  assert.equal(policy.allowWindowSwitching, true);
});

test("deriveSystemControlPolicy carries hands-on intent across short retry follow-ups", () => {
  const policy = deriveSystemControlPolicy({
    requestSource: "manual-session",
    userPrompt: "Try again.",
    previousUserPrompt: "ayudame con burpsuite y hazlo tu",
    permissiveDevModeEnabled: true
  });

  assert.equal(policy.isContinuationRequest, true);
  assert.equal(policy.isSystemControlAllowed, true);
  assert.equal(policy.allowMouseControl, true);
  assert.equal(policy.allowKeyboardControl, true);
});

test("deriveSystemControlPolicy treats spanish retry phrasing as a continuation request", () => {
  const policy = deriveSystemControlPolicy({
    requestSource: "manual-session",
    userPrompt: "de nuevo",
    previousUserPrompt: "ayudame con burpsuite y hazlo tu",
    permissiveDevModeEnabled: true
  });

  assert.equal(policy.isContinuationRequest, true);
  assert.equal(policy.isSystemControlAllowed, true);
});

test("deriveSystemControlPolicy understands automatic and safe autonomy modes", () => {
  const automaticPolicy = deriveSystemControlPolicy({
    requestSource: "voice-session",
    userPrompt: "do it automatically and click the save button"
  });
  const safePolicy = deriveSystemControlPolicy({
    requestSource: "voice-session",
    userPrompt: "modo seguro, abre notepad y confirma cada paso"
  });

  assert.equal(automaticPolicy.autonomyMode, "auto");
  assert.equal(safePolicy.autonomyMode, "safe");
});

test("deriveSystemControlPolicy stays off for non-action prompts", () => {
  const policy = deriveSystemControlPolicy({
    requestSource: "voice-session",
    userPrompt: "explicame este error de typescript"
  });

  assert.equal(policy.hasExplicitRequest, false);
  assert.equal(policy.isSystemControlAllowed, false);
  assert.deepEqual(policy.requestedCapabilities, []);
});

test("shouldRequireApprovalForTool loosens only reversible ui actions in automatic mode", () => {
  const automaticPolicy = deriveSystemControlPolicy({
    requestSource: "voice-session",
    userPrompt: "hazlo automaticamente, cambia de ventana y mueve el cursor"
  });
  const safePolicy = deriveSystemControlPolicy({
    requestSource: "voice-session",
    userPrompt: "safe mode, cambia de ventana"
  });

  assert.equal(shouldRequireApprovalForTool("control_mouse", automaticPolicy), false);
  assert.equal(shouldRequireApprovalForTool("drag_mouse", automaticPolicy), false);
  assert.equal(shouldRequireApprovalForTool("keyboard_shortcut", automaticPolicy), false);
  assert.equal(shouldRequireApprovalForTool("switch_window", automaticPolicy), false);
  assert.equal(shouldRequireApprovalForTool("type_text", automaticPolicy), true);
  assert.equal(shouldRequireApprovalForTool("close_application", automaticPolicy), true);
  assert.equal(shouldRequireApprovalForTool("switch_window", safePolicy), true);
});

test("shouldRequireApprovalForTool disables approvals entirely in permissive dev mode", () => {
  const policy = deriveSystemControlPolicy({
    requestSource: "manual-session",
    userPrompt: "abre el archivo y arreglalo tu",
    permissiveDevModeEnabled: true
  });

  assert.equal(shouldRequireApprovalForTool("write_file", policy), false);
  assert.equal(shouldRequireApprovalForTool("run_command", policy), false);
  assert.equal(shouldRequireApprovalForTool("control_mouse", policy), false);
});
