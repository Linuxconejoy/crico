import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBehaviorHint,
  detectModeFromProcessAndTitle,
  detectRuntimeEnvironment
} from "../src/main/foregroundApp.js";

test("detectModeFromProcessAndTitle recognizes Burp Suite as a security tool", () => {
  const detectedMode = detectModeFromProcessAndTitle({
    processName: "mstsc",
    windowTitle: "Burp Suite Professional - Repeater"
  });

  assert.equal(detectedMode, "security");
});

test("detectRuntimeEnvironment recognizes Ubuntu and WSL-hosted apps", () => {
  assert.equal(
    detectRuntimeEnvironment({
      processName: "ubuntu",
      windowTitle: "Burp Suite Professional",
      executablePath: "C:\\Program Files\\WSL\\ubuntu.exe"
    }),
    "wsl-linux"
  );

  assert.equal(
    detectRuntimeEnvironment({
      processName: "Code",
      windowTitle: "clicky-main",
      executablePath: "C:\\Users\\dev\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"
    }),
    "windows-native"
  );
});

test("buildBehaviorHint adds a WSL-specific warning against assuming localhost APIs", () => {
  const behaviorHint = buildBehaviorHint("security", "wsl-linux");

  assert.match(behaviorHint, /Security tool mode/i);
  assert.match(behaviorHint, /ubuntu or wsl on windows/i);
  assert.match(behaviorHint, /localhost REST API/i);
});
