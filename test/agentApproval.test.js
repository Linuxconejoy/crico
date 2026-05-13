import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAgentApprovalRequest,
  buildDeniedAgentToolResult,
  shouldRequestAgentApproval
} from "../src/panel/agentApproval.js";

test("shouldRequestAgentApproval only flags sensitive tools", () => {
  assert.equal(shouldRequestAgentApproval("write_file"), true);
  assert.equal(shouldRequestAgentApproval("open_path"), true);
  assert.equal(shouldRequestAgentApproval("run_command"), true);
  assert.equal(shouldRequestAgentApproval("search_system_files"), true);
  assert.equal(shouldRequestAgentApproval("control_mouse"), true);
  assert.equal(shouldRequestAgentApproval("drag_mouse"), true);
  assert.equal(shouldRequestAgentApproval("type_text"), true);
  assert.equal(shouldRequestAgentApproval("keyboard_shortcut"), true);
  assert.equal(shouldRequestAgentApproval("open_system_target"), true);
  assert.equal(shouldRequestAgentApproval("close_application"), true);
  assert.equal(shouldRequestAgentApproval("switch_window"), true);
  assert.equal(shouldRequestAgentApproval("read_file"), false);
});

test("shouldRequestAgentApproval honors the automatic autonomy mode for reversible ui actions", () => {
  const requestContext = {
    requestSource: "voice-session",
    userPrompt: "hazlo automaticamente, mueve el cursor y cambia a notepad"
  };

  assert.equal(shouldRequestAgentApproval("control_mouse", requestContext), false);
  assert.equal(shouldRequestAgentApproval("drag_mouse", requestContext), false);
  assert.equal(shouldRequestAgentApproval("keyboard_shortcut", requestContext), false);
  assert.equal(shouldRequestAgentApproval("switch_window", requestContext), false);
  assert.equal(shouldRequestAgentApproval("run_command", requestContext), true);
  assert.equal(shouldRequestAgentApproval("type_text", requestContext), true);
});

test("shouldRequestAgentApproval disables approvals in permissive dev mode", () => {
  const requestContext = {
    requestSource: "manual-session",
    userPrompt: "arreglalo tu en photoshop",
    permissiveDevModeEnabled: true
  };

  assert.equal(shouldRequestAgentApproval("write_file", requestContext), false);
  assert.equal(shouldRequestAgentApproval("run_command", requestContext), false);
  assert.equal(shouldRequestAgentApproval("search_system_files", requestContext), false);
  assert.equal(shouldRequestAgentApproval("control_mouse", requestContext), false);
  assert.equal(shouldRequestAgentApproval("open_system_target", requestContext), false);
});

test("buildAgentApprovalRequest creates a readable write preview", () => {
  const approvalRequest = buildAgentApprovalRequest({
    name: "write_file",
    input: {
      path: "src/app.js",
      content: "console.log('hello');"
    }
  });

  assert.equal(approvalRequest.toolName, "write_file");
  assert.match(approvalRequest.summary, /src\/app\.js/);
  assert.match(approvalRequest.preview, /console\.log/);
  assert.equal(approvalRequest.confirmLabel, "approve write");
});

test("buildAgentApprovalRequest truncates oversized write previews", () => {
  const longContent = "a".repeat(1200);
  const approvalRequest = buildAgentApprovalRequest({
    name: "write_file",
    input: {
      path: "src/app.js",
      content: longContent
    }
  });

  assert.match(approvalRequest.preview, /\[preview truncated\]$/);
  assert.ok(approvalRequest.preview.length < longContent.length);
});

test("buildDeniedAgentToolResult returns a blocked tool payload", () => {
  const deniedResult = buildDeniedAgentToolResult(
    { name: "open_path" },
    "User denied approval."
  );

  assert.deepEqual(deniedResult, {
    ok: false,
    blocked: true,
    requiresApproval: true,
    toolName: "open_path",
    error: "User denied approval."
  });
});

test("buildAgentApprovalRequest creates a readable command preview", () => {
  const approvalRequest = buildAgentApprovalRequest({
    name: "run_command",
    input: {
      command: "npm run check",
      cwd: "D:/Developer/clicky-main/windows-app",
      timeoutSeconds: 90
    }
  });

  assert.equal(approvalRequest.toolName, "run_command");
  assert.match(approvalRequest.summary, /npm run check/);
  assert.match(approvalRequest.detail, /90s/);
  assert.match(approvalRequest.preview, /cwd: D:\/Developer\/clicky-main\/windows-app/);
  assert.equal(approvalRequest.confirmLabel, "run command");
});

test("buildAgentApprovalRequest builds previews for system control tools", () => {
  const mouseApprovalRequest = buildAgentApprovalRequest({
    name: "control_mouse",
    input: {
      action: "left_click",
      x: 512,
      y: 384
    }
  });
  const keyboardApprovalRequest = buildAgentApprovalRequest({
    name: "type_text",
    input: {
      text: "hola mundo",
      pressEnterAfter: true
    }
  });
  const openApprovalRequest = buildAgentApprovalRequest({
    name: "open_system_target",
    input: {
      target: "notepad",
      arguments: ["D:/notes/todo.txt"]
    }
  });
  const dragApprovalRequest = buildAgentApprovalRequest({
    name: "drag_mouse",
    input: {
      startX: 100,
      startY: 200,
      endX: 700,
      endY: 500
    }
  });
  const shortcutApprovalRequest = buildAgentApprovalRequest({
    name: "keyboard_shortcut",
    input: {
      keys: ["ctrl", "shift", "p"]
    }
  });
  const closeApprovalRequest = buildAgentApprovalRequest({
    name: "close_application",
    input: {
      target: "notepad"
    }
  });

  assert.match(mouseApprovalRequest.summary, /left click/);
  assert.match(mouseApprovalRequest.preview, /x: 512/);
  assert.equal(mouseApprovalRequest.confirmLabel, "allow mouse action");

  assert.match(keyboardApprovalRequest.summary, /10 characters/);
  assert.match(keyboardApprovalRequest.preview, /hola mundo/);
  assert.equal(keyboardApprovalRequest.confirmLabel, "allow typing");

  assert.match(openApprovalRequest.summary, /notepad/);
  assert.match(openApprovalRequest.preview, /D:\/notes\/todo\.txt/);
  assert.equal(openApprovalRequest.confirmLabel, "allow open");

  assert.match(dragApprovalRequest.summary, /drag from \(100, 200\) to \(700, 500\)/);
  assert.equal(dragApprovalRequest.confirmLabel, "allow drag");

  assert.match(shortcutApprovalRequest.summary, /ctrl \+ shift \+ p/i);
  assert.equal(shortcutApprovalRequest.confirmLabel, "allow shortcut");

  assert.match(closeApprovalRequest.summary, /close notepad/);
  assert.equal(closeApprovalRequest.confirmLabel, "allow close");
});
