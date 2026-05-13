import { deriveSystemControlPolicy, shouldRequireApprovalForTool } from "../shared/systemControlPolicy.js";

const approvalRequiredToolNames = new Set([
  "open_path",
  "write_file",
  "run_command",
  "search_system_files",
  "control_mouse",
  "drag_mouse",
  "type_text",
  "keyboard_shortcut",
  "open_system_target",
  "close_application",
  "switch_window"
]);

const maxPreviewLength = 900;

export function shouldRequestAgentApproval(toolName, requestContext = {}) {
  const normalizedToolName = String(toolName || "").trim();
  if (!approvalRequiredToolNames.has(normalizedToolName)) {
    return false;
  }

  const systemControlPolicy = deriveSystemControlPolicy({
    requestSource: requestContext?.requestSource,
    userPrompt: requestContext?.userPrompt,
    previousUserPrompt: requestContext?.previousUserPrompt,
    permissiveDevModeEnabled: requestContext?.permissiveDevModeEnabled
  });

  return shouldRequireApprovalForTool(normalizedToolName, systemControlPolicy);
}

export function buildAgentApprovalRequest(toolUseBlock) {
  const toolName = String(toolUseBlock?.name || "").trim();
  const input = toolUseBlock?.input || {};

  if (toolName === "write_file") {
    const targetPath = String(input.path || "").trim() || "unknown file";
    const normalizedContent = String(input.content ?? "");
    const preview = truncatePreview(normalizedContent);

    return {
      toolName,
      title: "approval needed for file edit",
      summary: `clicky wants to write a workspace file: ${targetPath}`,
      detail: "review the destination and preview before allowing this agent action.",
      preview,
      confirmLabel: "approve write",
      denyLabel: "deny",
      path: targetPath
    };
  }

  if (toolName === "open_path") {
    const targetPath = String(input.path || "").trim() || "unknown path";

    return {
      toolName,
      title: "approval needed to open a path",
      summary: `clicky wants windows to open: ${targetPath}`,
      detail: "this can switch focus or reveal a file or folder outside the current panel.",
      preview: targetPath,
      confirmLabel: "approve open",
      denyLabel: "deny",
      path: targetPath
    };
  }

  if (toolName === "run_command") {
    const command = String(input.command || "").trim() || "unknown command";
    const workingDirectory = String(input.cwd || "").trim() || "(active workspace root)";
    const timeoutSeconds = Number.isFinite(Number(input.timeoutSeconds))
      ? `${Math.max(1, Math.floor(Number(input.timeoutSeconds)))}s`
      : "default timeout";

    return {
      toolName,
      title: "approval needed for command execution",
      summary: `clicky wants to run a system command: ${command}`,
      detail: `the command will run inside ${workingDirectory} with ${timeoutSeconds}. allow it only if this matches the task you asked for.`,
      preview: truncatePreview([
        `command: ${command}`,
        `cwd: ${workingDirectory}`,
        `timeout: ${timeoutSeconds}`
      ].join("\n")),
      confirmLabel: "run command",
      denyLabel: "deny",
      path: workingDirectory
    };
  }

  if (toolName === "control_mouse") {
    const action = String(input.action || "").trim() || "move";
    const x = Number.isFinite(Number(input.x)) ? Math.floor(Number(input.x)) : "?";
    const y = Number.isFinite(Number(input.y)) ? Math.floor(Number(input.y)) : "?";

    return {
      toolName,
      title: "approval needed for mouse control",
      summary: `clicky wants to ${action.replace(/_/g, " ")} at screen coordinates (${x}, ${y})`,
      detail: "this will move the real windows cursor and may click on the active desktop.",
      preview: truncatePreview([
        `action: ${action}`,
        `x: ${x}`,
        `y: ${y}`
      ].join("\n")),
      confirmLabel: "allow mouse action",
      denyLabel: "deny"
    };
  }

  if (toolName === "drag_mouse") {
    return {
      toolName,
      title: "approval needed for drag and drop",
      summary: `clicky wants to drag from (${input.startX ?? "?"}, ${input.startY ?? "?"}) to (${input.endX ?? "?"}, ${input.endY ?? "?"})`,
      detail: "this will hold the left mouse button and move the real windows cursor across the desktop.",
      preview: truncatePreview(JSON.stringify(input, null, 2)),
      confirmLabel: "allow drag",
      denyLabel: "deny"
    };
  }

  if (toolName === "type_text") {
    const text = String(input.text ?? "");
    const pressEnterAfter = Boolean(input.pressEnterAfter);

    return {
      toolName,
      title: "approval needed for keyboard input",
      summary: `clicky wants to type ${text.length} characters into the focused window`,
      detail: pressEnterAfter
        ? "the text will be typed into the focused window and then clicky will press enter."
        : "the text will be typed into the focused window.",
      preview: truncatePreview(text),
      confirmLabel: "allow typing",
      denyLabel: "deny"
    };
  }

  if (toolName === "keyboard_shortcut") {
    const shortcutPreview = Array.isArray(input.keys) ? input.keys.join(" + ") : "(unknown shortcut)";

    return {
      toolName,
      title: "approval needed for keyboard shortcut",
      summary: `clicky wants to press the shortcut: ${shortcutPreview}`,
      detail: "this will send the shortcut to the currently focused window.",
      preview: truncatePreview(shortcutPreview),
      confirmLabel: "allow shortcut",
      denyLabel: "deny"
    };
  }

  if (toolName === "open_system_target") {
    const target = String(input.target || "").trim() || "unknown target";
    const argumentsPreview = Array.isArray(input.arguments) && input.arguments.length > 0
      ? input.arguments.join(" ")
      : "(no arguments)";

    return {
      toolName,
      title: "approval needed to open an app or file",
      summary: `clicky wants to open: ${target}`,
      detail: "this can launch a windows application or open a system file or folder.",
      preview: truncatePreview([
        `target: ${target}`,
        `arguments: ${argumentsPreview}`
      ].join("\n")),
      confirmLabel: "allow open",
      denyLabel: "deny",
      path: target
    };
  }

  if (toolName === "close_application") {
    return {
      toolName,
      title: "approval needed to close an app",
      summary: `clicky wants to close ${String(input.target || input.index || "a visible window")}`,
      detail: "closing a window can discard unsaved work. only approve if this matches what you want.",
      preview: truncatePreview(JSON.stringify(input, null, 2)),
      confirmLabel: "allow close",
      denyLabel: "deny"
    };
  }

  if (toolName === "switch_window") {
    return {
      toolName,
      title: "approval needed to switch windows",
      summary: `clicky wants to switch to ${String(input.target || input.index || "another visible window")}`,
      detail: "this will bring a different application window to the foreground.",
      preview: truncatePreview(JSON.stringify(input, null, 2)),
      confirmLabel: "allow switch",
      denyLabel: "deny"
    };
  }

  return {
    toolName,
    title: "approval needed",
    summary: `clicky wants to run the tool ${toolName || "unknown"}.`,
    detail: "review the payload before allowing this action.",
    preview: truncatePreview(JSON.stringify(input, null, 2)),
    confirmLabel: "approve",
    denyLabel: "deny"
  };
}

export function buildDeniedAgentToolResult(toolUseBlock, reason = "User denied approval.") {
  return {
    ok: false,
    blocked: true,
    requiresApproval: true,
    toolName: String(toolUseBlock?.name || "").trim() || "unknown",
    error: reason
  };
}

function truncatePreview(text) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) {
    return "(no preview available)";
  }

  if (normalizedText.length <= maxPreviewLength) {
    return normalizedText;
  }

  return `${normalizedText.slice(0, maxPreviewLength)}\n\n[preview truncated]`;
}
