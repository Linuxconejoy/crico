import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWindowsSystemControlPowerShellScript,
  resolveSystemTargetCandidate,
  validateVirtualDesktopPoint
} from "../src/main/systemControl.js";

test("buildWindowsSystemControlPowerShellScript embeds Windows input automation primitives", () => {
  const script = buildWindowsSystemControlPowerShellScript(Buffer.from("{}").toString("base64"));

  assert.equal(script.includes("SetCursorPos"), true);
  assert.equal(script.includes("SendInput"), true);
  assert.equal(script.includes("Start-Process"), true);
  assert.equal(script.includes("TypeText"), true);
  assert.equal(script.includes("LeftButtonDown"), true);
  assert.equal(script.includes("PressVirtualKeys"), true);
  assert.equal(script.includes("ActivateWindow"), true);
  assert.equal(script.includes("CloseWindow"), true);
  assert.equal(script.includes("$normalizedKeyName.Length -le 3"), true);
});

test("resolveSystemTargetCandidate keeps names untouched and resolves path-like targets from the workspace root", () => {
  assert.equal(resolveSystemTargetCandidate("notepad", "D:/Developer/Clicky"), "notepad");
  assert.equal(
    resolveSystemTargetCandidate("./notes/todo.txt", "D:/Developer/Clicky"),
    "D:\\Developer\\Clicky\\notes\\todo.txt"
  );
  assert.equal(
    resolveSystemTargetCandidate("README.md", "D:/Developer/Clicky"),
    "D:\\Developer\\Clicky\\README.md"
  );
});

test("validateVirtualDesktopPoint rejects points outside the virtual desktop", () => {
  const acceptedPoint = validateVirtualDesktopPoint({
    x: 10,
    y: 20,
    virtualDesktopBounds: {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    }
  });
  const rejectedPoint = validateVirtualDesktopPoint({
    x: 2000,
    y: 20,
    virtualDesktopBounds: {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    }
  });

  assert.equal(acceptedPoint.ok, true);
  assert.equal(rejectedPoint.ok, false);
  assert.match(rejectedPoint.error, /outside the Windows virtual desktop bounds/);
});
