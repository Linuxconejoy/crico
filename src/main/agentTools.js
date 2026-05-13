import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { screen, shell } from "electron";
import { deriveSystemControlPolicy } from "../shared/systemControlPolicy.js";
import {
  executeWindowsSystemControl,
  resolveSystemTargetCandidate,
  validateVirtualDesktopPoint
} from "./systemControl.js";

const maxReadCharacters = 16000;
const maxWriteCharacters = 200000;
const maxCommandOutputCharacters = 12000;
const maxSearchResults = 30;
const maxSearchableFileSizeInBytes = 1024 * 1024;
const maxVisitedSearchEntries = 4000;
const maxVisitedSystemSearchEntries = 6000;
const maxCommandLength = 400;
const maxTypedTextCharacters = 4000;
const maxLaunchArguments = 12;
const maxShortcutKeys = 6;
const minimumDragSteps = 4;
const maximumDragSteps = 60;
const defaultCommandTimeoutSeconds = 45;
const minimumCommandTimeoutSeconds = 5;
const maximumCommandTimeoutSeconds = 180;
const allowedWorkspaceRootsEnvVar = "CLICKY_AGENT_ALLOWED_ROOTS";
const defaultDeveloperWorkspaceRoot = "D:\\Developer";
const blockedShellHostCommands = new Set([
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "wscript",
  "wscript.exe",
  "cscript",
  "cscript.exe",
  "mshta",
  "mshta.exe"
]);

const blockedCommandPatterns = [
  /\bremove-item\b/i,
  /\bdel(?:ete)?\b/i,
  /\berase\b/i,
  /\brmdir\b/i,
  /\bformat\b/i,
  /\bshutdown\b/i,
  /\bstop-computer\b/i,
  /\brestart-computer\b/i,
  /\bcopy-item\b/i,
  /\bmove-item\b/i,
  /\brename-item\b/i,
  /\bnew-item\b/i,
  /\bset-content\b/i,
  /\badd-content\b/i,
  /\bout-file\b/i,
  /\bsc\b/i,
  /\breg(?:\.exe)?\s+(?:add|delete|import)\b/i,
  /\bgit\s+reset\b/i,
  /\bgit\s+clean\b/i,
  /\bgit\s+checkout\s+--\b/i,
  /\bgit\s+restore\b.*\s+--source\b/i
];

const blockedCommandFragments = [
  {
    pattern: /[;&|><`]/,
    reason: "Command chaining, pipes, or redirection are blocked in agent mode."
  },
  {
    pattern: /\r|\n/,
    reason: "Multi-line commands are blocked. Run a single command instead."
  },
  {
    pattern: /\$\(|\$\{/,
    reason: "Shell expansion is blocked because it makes commands harder to audit safely."
  }
];

const readOnlyPowerShellCommands = new Set([
  "cat",
  "dir",
  "gci",
  "gc",
  "get-childitem",
  "get-command",
  "get-content",
  "get-item",
  "get-location",
  "gi",
  "ls",
  "pwd",
  "resolve-path",
  "select-string",
  "sls",
  "test-path",
  "type"
]);

const allowedSystemExecutables = new Set([
  "git",
  "node",
  "npm",
  "npm.cmd",
  "py",
  "python",
  "python.exe",
  "rg",
  "where",
  "where.exe"
]);

const blockedOpenFileExtensions = new Set([
  ".appref-ms",
  ".bat",
  ".cmd",
  ".com",
  ".exe",
  ".jar",
  ".lnk",
  ".msi",
  ".ps1",
  ".scr"
]);

const blockedWriteFileExtensions = new Set([
  ".appref-ms",
  ".bat",
  ".cmd",
  ".com",
  ".dll",
  ".exe",
  ".jar",
  ".lnk",
  ".msi",
  ".ps1",
  ".scr",
  ".sys"
]);

const permissiveDevModeWriteBlockedExtensions = new Set([
  ".appref-ms",
  ".dll",
  ".exe",
  ".jar",
  ".lnk",
  ".msi",
  ".scr",
  ".sys"
]);

export async function executeAgentToolCall({
  name,
  input,
  latestAppContext,
  requestContext
}) {
  const workspaceAccessContext = buildWorkspaceAccessContext(latestAppContext, requestContext);
  const systemControlPolicy = deriveSystemControlPolicy({
    requestSource: requestContext?.requestSource,
    userPrompt: requestContext?.userPrompt,
    previousUserPrompt: requestContext?.previousUserPrompt,
    permissiveDevModeEnabled: requestContext?.permissiveDevModeEnabled
  });

  switch (name) {
    case "get_app_context":
      return {
        ok: true,
        appContext: latestAppContext || null,
        activeWorkspaceRoot: workspaceAccessContext.activeWorkspaceRoot
      };

    case "open_path":
      return openPathOnWindows(input.path, workspaceAccessContext);

    case "list_directory":
      return listDirectoryEntries(input.path, workspaceAccessContext);

    case "search_text":
      return searchTextInsideFiles(input.path, input.query, workspaceAccessContext);

    case "read_file":
      return readFileFromDisk(input.path, input.startLine, input.endLine, workspaceAccessContext);

    case "write_file":
      return writeFileToDisk(input.path, input.content, workspaceAccessContext);

    case "run_command":
      return runSystemCommand(
        input.command,
        input.cwd,
        input.timeoutSeconds,
        workspaceAccessContext
      );

    case "control_mouse":
      return controlMousePointer(input, systemControlPolicy);

    case "drag_mouse":
      return dragMousePointer(input, systemControlPolicy);

    case "type_text":
      return typeTextIntoFocusedWindow(input, systemControlPolicy);

    case "keyboard_shortcut":
      return pressKeyboardShortcut(input, systemControlPolicy);

    case "open_system_target":
      return openSystemTarget(input, workspaceAccessContext, systemControlPolicy);

    case "close_application":
      return closeApplicationWindow(input, systemControlPolicy);

    case "switch_window":
      return switchToApplicationWindow(input, systemControlPolicy);

    case "search_system_files":
      return searchSystemFilesByName(input, workspaceAccessContext, systemControlPolicy);

    default:
      return {
        ok: false,
        error: `Unknown agent tool: ${name}`
      };
  }
}

async function controlMousePointer(input, systemControlPolicy) {
  const permissionResult = ensureSystemControlAllowed(systemControlPolicy, "mouse", "control_mouse");
  if (!permissionResult.ok) {
    return permissionResult;
  }

  const normalizedAction = String(input?.action || "").trim();
  if (!["move", "left_click", "double_click", "right_click"].includes(normalizedAction)) {
    return buildBlockedResponse(
      "control_mouse",
      "System control blocked control_mouse because the action must be move, left_click, double_click, or right_click."
    );
  }

  const x = Number.parseInt(input?.x, 10);
  const y = Number.parseInt(input?.y, 10);
  const virtualDesktopBounds = getVirtualDesktopBounds();
  const pointValidation = validateVirtualDesktopPoint({
    x,
    y,
    virtualDesktopBounds
  });
  if (!pointValidation.ok) {
    return buildBlockedResponse("control_mouse", pointValidation.error);
  }

  const automationResult = await executeWindowsSystemControl({
    kind: "mouse",
    action: normalizedAction,
    x,
    y
  });

  if (!automationResult?.ok) {
    return {
      ok: false,
      toolName: "control_mouse",
      error: automationResult?.error || "Mouse automation failed."
    };
  }

  return {
    ...automationResult,
    virtualDesktopBounds
  };
}

async function dragMousePointer(input, systemControlPolicy) {
  const permissionResult = ensureSystemControlAllowed(systemControlPolicy, "mouse", "drag_mouse");
  if (!permissionResult.ok) {
    return permissionResult;
  }

  const startX = Number.parseInt(input?.startX, 10);
  const startY = Number.parseInt(input?.startY, 10);
  const endX = Number.parseInt(input?.endX, 10);
  const endY = Number.parseInt(input?.endY, 10);
  const requestedStepCount = Number.parseInt(input?.stepCount, 10);
  const stepCount = Number.isFinite(requestedStepCount)
    ? Math.min(maximumDragSteps, Math.max(minimumDragSteps, requestedStepCount))
    : 18;
  const virtualDesktopBounds = getVirtualDesktopBounds();

  for (const point of [
    { x: startX, y: startY },
    { x: endX, y: endY }
  ]) {
    const pointValidation = validateVirtualDesktopPoint({
      ...point,
      virtualDesktopBounds
    });
    if (!pointValidation.ok) {
      return buildBlockedResponse("drag_mouse", pointValidation.error);
    }
  }

  const automationResult = await executeWindowsSystemControl({
    kind: "drag",
    startX,
    startY,
    endX,
    endY,
    stepCount
  });

  if (!automationResult?.ok) {
    return {
      ok: false,
      toolName: "drag_mouse",
      error: automationResult?.error || "Mouse drag automation failed."
    };
  }

  return {
    ...automationResult,
    virtualDesktopBounds
  };
}

async function typeTextIntoFocusedWindow(input, systemControlPolicy) {
  const permissionResult = ensureSystemControlAllowed(systemControlPolicy, "keyboard", "type_text");
  if (!permissionResult.ok) {
    return permissionResult;
  }

  const text = String(input?.text ?? "");
  if (!text.trim()) {
    return buildBlockedResponse(
      "type_text",
      "System control blocked type_text because the text payload was empty."
    );
  }

  if (text.length > maxTypedTextCharacters) {
    return buildBlockedResponse(
      "type_text",
      `System control blocked type_text because the payload was too large (${text.length} characters). Keep it below ${maxTypedTextCharacters} characters.`
    );
  }

  const automationResult = await executeWindowsSystemControl({
    kind: "keyboard",
    text,
    pressEnterAfter: Boolean(input?.pressEnterAfter)
  });

  if (!automationResult?.ok) {
    return {
      ok: false,
      toolName: "type_text",
      error: automationResult?.error || "Keyboard automation failed."
    };
  }

  return automationResult;
}

async function pressKeyboardShortcut(input, systemControlPolicy) {
  const permissionResult = ensureSystemControlAllowed(systemControlPolicy, "keyboard", "keyboard_shortcut");
  if (!permissionResult.ok) {
    return permissionResult;
  }

  const keys = Array.isArray(input?.keys)
    ? input.keys
      .map((key) => String(key || "").trim())
      .filter(Boolean)
      .slice(0, maxShortcutKeys)
    : [];

  if (keys.length === 0) {
    return buildBlockedResponse(
      "keyboard_shortcut",
      "System control blocked keyboard_shortcut because no keys were provided."
    );
  }

  const automationResult = await executeWindowsSystemControl({
    kind: "shortcut",
    keys
  });

  if (!automationResult?.ok) {
    return {
      ok: false,
      toolName: "keyboard_shortcut",
      error: automationResult?.error || "Keyboard shortcut automation failed."
    };
  }

  return automationResult;
}

async function openSystemTarget(input, workspaceAccessContext, systemControlPolicy) {
  const permissionResult = ensureSystemControlAllowed(systemControlPolicy, "launch", "open_system_target");
  if (!permissionResult.ok) {
    return permissionResult;
  }

  const normalizedTarget = String(input?.target || "").trim();
  if (!normalizedTarget) {
    return buildBlockedResponse(
      "open_system_target",
      "System control blocked open_system_target because the target was empty."
    );
  }

  const argumentsList = Array.isArray(input?.arguments)
    ? input.arguments
      .map((argument) => String(argument ?? ""))
      .filter((argument) => argument.length > 0)
      .slice(0, maxLaunchArguments)
    : [];

  const resolvedTarget = resolveSystemTargetCandidate(
    normalizedTarget,
    workspaceAccessContext.defaultWorkspaceRoot
  );
  if (
    looksLikeAbsoluteWindowsPath(normalizedTarget) ||
    looksLikeRelativePath(normalizedTarget) ||
    normalizedTarget.startsWith("~")
  ) {
    const targetPathValidation = resolveApprovedPath(workspaceAccessContext, normalizedTarget, {
      toolName: "open_system_target",
      accessKind: "launch",
      mustExist: false
    });
    if (!targetPathValidation.ok) {
      return targetPathValidation;
    }
  }

  const automationResult = await executeWindowsSystemControl({
    kind: "launch",
    target: resolvedTarget,
    arguments: argumentsList
  });

  if (!automationResult?.ok) {
    return {
      ok: false,
      toolName: "open_system_target",
      error: automationResult?.error || "Launch automation failed."
    };
  }

  return {
    ...automationResult,
    requestedTarget: normalizedTarget
  };
}

async function closeApplicationWindow(input, systemControlPolicy) {
  const permissionResult = ensureSystemControlAllowed(systemControlPolicy, "close", "close_application");
  if (!permissionResult.ok) {
    return permissionResult;
  }

  const target = String(input?.target || "").trim();
  const index = Number.isInteger(input?.index) ? input.index : Number.parseInt(input?.index, 10);
  if (!target && !Number.isInteger(index)) {
    return buildBlockedResponse(
      "close_application",
      "System control blocked close_application because it needs a window target or index."
    );
  }

  const automationResult = await executeWindowsSystemControl({
    kind: "close_application",
    target,
    index: Number.isInteger(index) ? index : null
  });

  if (!automationResult?.ok) {
    return {
      ok: false,
      toolName: "close_application",
      error: automationResult?.error || "Close application automation failed."
    };
  }

  return automationResult;
}

async function switchToApplicationWindow(input, systemControlPolicy) {
  const permissionResult = ensureSystemControlAllowed(systemControlPolicy, "window-switch", "switch_window");
  if (!permissionResult.ok) {
    return permissionResult;
  }

  const target = String(input?.target || "").trim();
  const index = Number.isInteger(input?.index) ? input.index : Number.parseInt(input?.index, 10);
  if (!target && !Number.isInteger(index)) {
    return buildBlockedResponse(
      "switch_window",
      "System control blocked switch_window because it needs a window target or index."
    );
  }

  const automationResult = await executeWindowsSystemControl({
    kind: "switch_window",
    target,
    index: Number.isInteger(index) ? index : null
  });

  if (!automationResult?.ok) {
    return {
      ok: false,
      toolName: "switch_window",
      error: automationResult?.error || "Switch window automation failed."
    };
  }

  return automationResult;
}

function searchSystemFilesByName(input, workspaceAccessContext, systemControlPolicy) {
  const permissionResult = ensureSystemControlAllowed(systemControlPolicy, "file-search", "search_system_files");
  if (!permissionResult.ok) {
    return permissionResult;
  }

  const normalizedQuery = String(input?.query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return buildBlockedResponse(
      "search_system_files",
      "System control blocked search_system_files because the query was empty."
    );
  }

  const searchRoots = buildSystemSearchRoots(workspaceAccessContext);
  const results = [];
  const pendingPaths = [...searchRoots];
  const visitedPaths = new Set();

  while (
    pendingPaths.length > 0 &&
    results.length < maxSearchResults &&
    visitedPaths.size < maxVisitedSystemSearchEntries
  ) {
    const currentPath = pendingPaths.pop();
    if (!currentPath || visitedPaths.has(currentPath)) {
      continue;
    }

    visitedPaths.add(currentPath);

    if (findContainingProtectedRoot(workspaceAccessContext, currentPath)) {
      continue;
    }

    let stats;
    try {
      stats = fs.statSync(currentPath);
    } catch {
      continue;
    }

    const currentName = path.basename(currentPath).toLowerCase();
    if (currentName.includes(normalizedQuery)) {
      results.push({
        path: currentPath,
        type: stats.isDirectory() ? "directory" : "file"
      });
    }

    if (!stats.isDirectory()) {
      continue;
    }

    if (["node_modules", ".git", "dist", "__pycache__"].includes(currentName)) {
      continue;
    }

    let childNames = [];
    try {
      childNames = fs.readdirSync(currentPath);
    } catch {
      continue;
    }

    for (const childName of childNames.reverse()) {
      pendingPaths.push(path.join(currentPath, childName));
    }
  }

  return {
    ok: true,
    query: normalizedQuery,
    searchedRoots: searchRoots,
    results,
    truncated: pendingPaths.length > 0 || visitedPaths.size >= maxVisitedSystemSearchEntries
  };
}

function openPathOnWindows(targetPath, workspaceAccessContext) {
  const resolvedPathResult = resolveApprovedPath(workspaceAccessContext, targetPath, {
    toolName: "open_path",
    accessKind: "read",
    mustExist: true
  });

  if (!resolvedPathResult.ok) {
    return resolvedPathResult;
  }

  const stats = fs.statSync(resolvedPathResult.path);
  if (stats.isFile() && isOpenPathExtensionBlocked(resolvedPathResult.path, workspaceAccessContext)) {
    return buildBlockedResponse(
      "open_path",
      `Clicky blocked opening ${resolvedPathResult.path} because agent mode will not launch executable or script-like files. Use read_file if you only need to inspect it.`
    );
  }

  return shell.openPath(resolvedPathResult.path).then((openPathError) => {
    if (openPathError) {
      return {
        ok: false,
        error: `Windows could not open ${resolvedPathResult.path}: ${openPathError}`
      };
    }

    return {
      ok: true,
      openedPath: resolvedPathResult.path,
      workspaceRoot: resolvedPathResult.allowedRoot
    };
  });
}

function listDirectoryEntries(targetPath, workspaceAccessContext) {
  const resolvedPathResult = resolveApprovedPath(workspaceAccessContext, targetPath, {
    toolName: "list_directory",
    accessKind: "read",
    mustExist: true,
    expectedType: "directory",
    allowEmptyPath: true
  });

  if (!resolvedPathResult.ok) {
    return resolvedPathResult;
  }

  const allEntries = fs.readdirSync(resolvedPathResult.path, { withFileTypes: true });
  const entries = allEntries
    .slice(0, 250)
    .map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file"
    }));

  return {
    ok: true,
    path: resolvedPathResult.path,
    workspaceRoot: resolvedPathResult.allowedRoot,
    entries,
    truncated: allEntries.length > entries.length
  };
}

function searchTextInsideFiles(rootPath, query, workspaceAccessContext) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) {
    return buildBlockedResponse(
      "search_text",
      "Clicky blocked search_text because the query was empty. Provide plain text to search for inside the approved workspace."
    );
  }

  const resolvedRootPathResult = resolveApprovedPath(workspaceAccessContext, rootPath, {
    toolName: "search_text",
    accessKind: "read",
    mustExist: true,
    expectedType: "directory",
    allowEmptyPath: true
  });

  if (!resolvedRootPathResult.ok) {
    return resolvedRootPathResult;
  }

  const results = [];
  const pendingPaths = [resolvedRootPathResult.path];
  let visitedEntries = 0;

  while (pendingPaths.length > 0 && results.length < maxSearchResults && visitedEntries < maxVisitedSearchEntries) {
    const currentPath = pendingPaths.pop();
    visitedEntries += 1;

    let stats;
    try {
      stats = fs.statSync(currentPath);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      const baseName = path.basename(currentPath).toLowerCase();
      if (["node_modules", ".git", "dist"].includes(baseName)) {
        continue;
      }

      let children = [];
      try {
        children = fs.readdirSync(currentPath);
      } catch {
        continue;
      }

      for (const childName of children.reverse()) {
        pendingPaths.push(path.join(currentPath, childName));
      }

      continue;
    }

    if (!stats.isFile() || stats.size > maxSearchableFileSizeInBytes || isLikelyBinaryFile(currentPath)) {
      continue;
    }

    let fileContents = "";
    try {
      fileContents = fs.readFileSync(currentPath, "utf8");
    } catch {
      continue;
    }

    const fileLines = fileContents.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < fileLines.length && results.length < maxSearchResults; lineIndex += 1) {
      if (!fileLines[lineIndex].toLowerCase().includes(normalizedQuery.toLowerCase())) {
        continue;
      }

      results.push({
        path: currentPath,
        lineNumber: lineIndex + 1,
        lineText: fileLines[lineIndex].trim()
      });
    }
  }

  return {
    ok: true,
    path: resolvedRootPathResult.path,
    workspaceRoot: resolvedRootPathResult.allowedRoot,
    query: normalizedQuery,
    results,
    truncated: visitedEntries >= maxVisitedSearchEntries
  };
}

function readFileFromDisk(targetPath, startLine, endLine, workspaceAccessContext) {
  const resolvedPathResult = resolveApprovedPath(workspaceAccessContext, targetPath, {
    toolName: "read_file",
    accessKind: "read",
    mustExist: true,
    expectedType: "file"
  });

  if (!resolvedPathResult.ok) {
    return resolvedPathResult;
  }

  if (isLikelyBinaryFile(resolvedPathResult.path)) {
    return buildBlockedResponse(
      "read_file",
      `Clicky blocked reading ${resolvedPathResult.path} as text because it looks like a binary or media file. Use open_path for manual inspection instead.`
    );
  }

  const fileContents = fs.readFileSync(resolvedPathResult.path, "utf8");
  const fileLines = fileContents.split(/\r?\n/);
  const resolvedStartLine = Number.isInteger(startLine) && startLine > 0 ? startLine : 1;
  const resolvedEndLine = Number.isInteger(endLine) && endLine >= resolvedStartLine
    ? endLine
    : fileLines.length;
  const selectedLines = fileLines.slice(resolvedStartLine - 1, resolvedEndLine);
  const selectedText = selectedLines.join("\n");
  const truncatedText = truncateText(selectedText, maxReadCharacters);

  return {
    ok: true,
    path: resolvedPathResult.path,
    workspaceRoot: resolvedPathResult.allowedRoot,
    lineRange: {
      startLine: resolvedStartLine,
      endLine: Math.min(resolvedEndLine, fileLines.length),
      totalLineCount: fileLines.length
    },
    content: truncatedText.value,
    truncated: truncatedText.wasTruncated
  };
}

function writeFileToDisk(targetPath, content, workspaceAccessContext) {
  const normalizedContent = String(content ?? "");
  if (normalizedContent.length > maxWriteCharacters) {
    return buildBlockedResponse(
      "write_file",
      `Clicky blocked write_file because the payload was too large (${normalizedContent.length} characters). Keep writes below ${maxWriteCharacters} characters in a single call.`
    );
  }

  const resolvedPathResult = resolveApprovedPath(workspaceAccessContext, targetPath, {
    toolName: "write_file",
    accessKind: "write",
    mustExist: false
  });

  if (!resolvedPathResult.ok) {
    return resolvedPathResult;
  }

  const extension = path.extname(resolvedPathResult.path).toLowerCase();
  const blockedWriteExtensions = workspaceAccessContext.permissiveDevModeEnabled
    ? permissiveDevModeWriteBlockedExtensions
    : blockedWriteFileExtensions;
  if (blockedWriteExtensions.has(extension) || isLikelyBinaryFile(resolvedPathResult.path)) {
    return buildBlockedResponse(
      "write_file",
      `Clicky blocked writing ${resolvedPathResult.path} because agent mode only allows text-oriented workspace files, not executables, binary assets, or shell launchers.`
    );
  }

  if (fs.existsSync(resolvedPathResult.path) && fs.statSync(resolvedPathResult.path).isDirectory()) {
    return {
      ok: false,
      error: `write_file expected a file path, but ${resolvedPathResult.path} is a directory.`
    };
  }

  fs.mkdirSync(path.dirname(resolvedPathResult.path), { recursive: true });
  fs.writeFileSync(resolvedPathResult.path, normalizedContent, "utf8");

  return {
    ok: true,
    path: resolvedPathResult.path,
    bytesWritten: Buffer.byteLength(normalizedContent, "utf8"),
    workspaceRoot: resolvedPathResult.allowedRoot
  };
}

function runSystemCommand(command, cwd, timeoutSeconds, workspaceAccessContext) {
  const normalizedCommand = String(command || "").trim();
  if (!normalizedCommand) {
    return Promise.resolve(buildBlockedResponse(
      "run_command",
      "Clicky blocked run_command because the command was empty. Use a single PowerShell inspection command or an approved executable such as npm, git, python, node, rg, or where."
    ));
  }

  if (normalizedCommand.length > maxCommandLength) {
    return Promise.resolve(buildBlockedResponse(
      "run_command",
      `Clicky blocked run_command because the command was too long (${normalizedCommand.length} characters). Keep it under ${maxCommandLength} characters so it stays auditable.`
    ));
  }

  const resolvedWorkingDirectoryResult = resolveApprovedPath(workspaceAccessContext, cwd, {
    toolName: "run_command",
    accessKind: "read",
    mustExist: true,
    expectedType: "directory",
    allowEmptyPath: true
  });

  if (!resolvedWorkingDirectoryResult.ok) {
    return Promise.resolve(resolvedWorkingDirectoryResult);
  }

  const commandValidation = validateApprovedCommand(
    normalizedCommand,
    resolvedWorkingDirectoryResult.path,
    workspaceAccessContext
  );
  if (!commandValidation.ok) {
    return Promise.resolve(commandValidation);
  }

  const timeoutMilliseconds = clampCommandTimeout(timeoutSeconds) * 1000;

  return new Promise((resolve) => {
    execFile(
      commandValidation.executionPlan.executable,
      commandValidation.executionPlan.args,
      {
        cwd: resolvedWorkingDirectoryResult.path,
        timeout: timeoutMilliseconds,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error && error.killed) {
          resolve({
            ok: false,
            error: `Command timed out after ${timeoutMilliseconds / 1000} seconds.`,
            stdout: truncateText(stdout, maxCommandOutputCharacters).value,
            stderr: truncateText(stderr, maxCommandOutputCharacters).value,
            cwd: resolvedWorkingDirectoryResult.path,
            policy: commandValidation.executionPlan.policy
          });
          return;
        }

        resolve({
          ok: !error,
          exitCode: typeof error?.code === "number" ? error.code : 0,
          stdout: truncateText(stdout, maxCommandOutputCharacters).value,
          stderr: truncateText(stderr, maxCommandOutputCharacters).value,
          error: error ? error.message : "",
          command: normalizedCommand,
          cwd: resolvedWorkingDirectoryResult.path,
          policy: commandValidation.executionPlan.policy
        });
      }
    );
  });
}

function validateApprovedCommand(command, workingDirectory, workspaceAccessContext) {
  for (const blockedFragment of blockedCommandFragments) {
    if (blockedFragment.pattern.test(command)) {
      return buildBlockedResponse(
        "run_command",
        `Clicky blocked run_command. ${blockedFragment.reason} Allowed examples: Get-ChildItem, Select-String "todo" .\\src\\app.js, rg "needle", git status, npm run check, python .\\scripts\\tool.py.`
      );
    }
  }

  if (blockedCommandPatterns.some((blockedPattern) => blockedPattern.test(command))) {
    return buildBlockedResponse(
      "run_command",
      "Clicky blocked run_command because it matches a destructive or unsupported command pattern."
    );
  }

  const tokens = tokenizeCommand(command).map(stripWrappingQuotes).filter(Boolean);
  if (tokens.length === 0) {
    return buildBlockedResponse(
      "run_command",
      "Clicky blocked run_command because it could not determine the command name."
    );
  }

  const executableToken = tokens[0];
  const commandName = executableToken.toLowerCase();
  const commandLeafName = path.basename(commandName);
  if (readOnlyPowerShellCommands.has(commandName)) {
    for (const token of tokens.slice(1)) {
      const tokenValidation = validateCommandTokenPath(token, workingDirectory, workspaceAccessContext);
      if (!tokenValidation.ok) {
        return tokenValidation;
      }
    }

    return {
      ok: true,
      executionPlan: {
        executable: "powershell.exe",
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          command
        ],
        policy: "read-only-powershell"
      }
    };
  }

  const explicitExecutablePath = resolveExecutablePathToken(
    executableToken,
    workingDirectory,
    workspaceAccessContext
  );
  if (!explicitExecutablePath.ok) {
    return explicitExecutablePath;
  }

  const isPermissiveDevModeEnabled = workspaceAccessContext.permissiveDevModeEnabled;
  if (isPermissiveDevModeEnabled && blockedShellHostCommands.has(commandLeafName)) {
    return buildBlockedResponse(
      "run_command",
      `Clicky blocked run_command because "${tokens[0]}" is a shell host. Use a direct executable or a concrete command instead.`
    );
  }

  if (!explicitExecutablePath.path && !allowedSystemExecutables.has(commandName)) {
    if (!isPermissiveDevModeEnabled) {
      return buildBlockedResponse(
        "run_command",
        `Clicky blocked run_command because "${tokens[0]}" is not in the approved allowlist. Allowed commands: ${formatAllowedCommands()}.`
      );
    }
  }

  if (["node", "python", "python.exe", "py"].includes(commandLeafName) && tokens.length === 1) {
    return buildBlockedResponse(
      "run_command",
      `Clicky blocked run_command because "${tokens[0]}" without arguments would open an interactive shell. Pass a script, module, or explicit arguments instead.`
    );
  }

  for (const token of tokens.slice(1)) {
    const tokenValidation = validateCommandTokenPath(token, workingDirectory, workspaceAccessContext);
    if (!tokenValidation.ok) {
      return tokenValidation;
    }
  }

  return {
    ok: true,
    executionPlan: {
      executable: explicitExecutablePath.path || resolveSystemExecutable(commandName),
      args: tokens.slice(1),
      policy: explicitExecutablePath.path
        ? "explicit-local-command"
        : isPermissiveDevModeEnabled
          ? "permissive-dev-command"
          : "approved-system-command"
    }
  };
}

function resolveExecutablePathToken(token, workingDirectory, workspaceAccessContext) {
  const strippedToken = stripWrappingQuotes(token);
  if (!looksLikeAbsoluteWindowsPath(strippedToken) && !looksLikeRelativePath(strippedToken) && !strippedToken.startsWith("~")) {
    return {
      ok: true,
      path: null
    };
  }

  const resolvedPathResult = resolveApprovedPath(workspaceAccessContext, strippedToken, {
    toolName: "run_command",
    accessKind: "execute",
    mustExist: false
  });
  if (!resolvedPathResult.ok) {
    return resolvedPathResult;
  }

  return {
    ok: true,
    path: resolvedPathResult.path
  };
}

function validateCommandTokenPath(token, workingDirectory, workspaceAccessContext) {
  const strippedToken = stripWrappingQuotes(token);
  if (!strippedToken || strippedToken.startsWith("-") || strippedToken.startsWith("@")) {
    return {
      ok: true
    };
  }

  if (looksLikeAbsoluteWindowsPath(strippedToken) || strippedToken.startsWith("~")) {
    const resolvedPathResult = resolveApprovedPath(workspaceAccessContext, strippedToken, {
      toolName: "run_command",
      accessKind: "read",
      mustExist: false
    });

    if (!resolvedPathResult.ok) {
      return resolvedPathResult;
    }
  }

  if (looksLikeRelativePath(strippedToken)) {
    const candidatePath = path.resolve(workingDirectory, strippedToken);
    if (workspaceAccessContext.permissiveDevModeEnabled) {
      const resolvedPathResult = resolveApprovedPath(workspaceAccessContext, candidatePath, {
        toolName: "run_command",
        accessKind: "read",
        mustExist: false
      });
      if (!resolvedPathResult.ok) {
        return resolvedPathResult;
      }
    } else if (!isPathInsideApprovedWorkspace(workspaceAccessContext, candidatePath)) {
      return buildBlockedResponse(
        "run_command",
        `Clicky blocked run_command because the path token "${strippedToken}" escapes the approved workspace roots. Allowed roots: ${formatApprovedWorkspaceRoots(workspaceAccessContext)}.`
      );
    }
  }

  return {
    ok: true
  };
}

function resolveApprovedPath(workspaceAccessContext, targetPath, options = {}) {
  const {
    toolName,
    accessKind = "read",
    mustExist = false,
    expectedType = null,
    allowEmptyPath = false
  } = options;

  const rawPath = String(targetPath ?? "").trim();
  if (!rawPath && !allowEmptyPath) {
    return {
      ok: false,
      error: `${toolName} requires a path inside the approved workspace roots: ${formatApprovedWorkspaceRoots(workspaceAccessContext)}.`
    };
  }

  const resolvedRequestedPath = resolveRequestedPath(workspaceAccessContext, rawPath);
  const canonicalPath = canonicalizePathForAccess(
    resolvedRequestedPath,
    workspaceAccessContext.defaultWorkspaceRoot
  );
  const protectedRoot = findContainingProtectedRoot(workspaceAccessContext, canonicalPath);
  if (protectedRoot) {
    return buildBlockedResponse(
      toolName,
      `Clicky blocked ${toolName} because ${canonicalPath} falls inside a protected path (${protectedRoot}). Protected roots: ${formatProtectedRoots(workspaceAccessContext)}.`
    );
  }

  const allowedRoot = findContainingApprovedWorkspaceRoot(workspaceAccessContext, canonicalPath);

  if (!allowedRoot && !workspaceAccessContext.permissiveDevModeEnabled) {
    return buildBlockedResponse(
      toolName,
      `Clicky blocked ${toolName} because ${canonicalPath} is outside the approved workspace roots. Allowed roots: ${formatApprovedWorkspaceRoots(workspaceAccessContext)}. This agent mode only permits ${accessKind} access inside those roots.`
    );
  }

  if (mustExist && !fs.existsSync(canonicalPath)) {
    return {
      ok: false,
      error: `The path does not exist inside the approved workspace: ${canonicalPath}`
    };
  }

  if (fs.existsSync(canonicalPath) && expectedType) {
    const stats = fs.statSync(canonicalPath);
    if (expectedType === "directory" && !stats.isDirectory()) {
      return {
        ok: false,
        error: `Expected a directory inside the approved workspace, but got a file: ${canonicalPath}`
      };
    }

    if (expectedType === "file" && !stats.isFile()) {
      return {
        ok: false,
        error: `Expected a file inside the approved workspace, but got a directory: ${canonicalPath}`
      };
    }
  }

  return {
    ok: true,
    path: canonicalPath,
    allowedRoot: allowedRoot || "permissive-dev-mode"
  };
}

function resolveRequestedPath(workspaceAccessContext, targetPath) {
  const expandedPath = String(targetPath || "").replace(/^~(?=$|[\\/])/, process.env.USERPROFILE || "~");
  if (!expandedPath) {
    return workspaceAccessContext.defaultWorkspaceRoot;
  }

  if (path.isAbsolute(expandedPath)) {
    return path.resolve(expandedPath);
  }

  return path.resolve(workspaceAccessContext.defaultWorkspaceRoot, expandedPath);
}

function buildWorkspaceAccessContext(latestAppContext, requestContext = {}) {
  const permissiveDevModeEnabled = Boolean(requestContext?.permissiveDevModeEnabled);
  const approvedWorkspaceRoots = buildApprovedWorkspaceRoots(latestAppContext);
  const protectedRoots = buildProtectedRoots();
  const developerRoot = approvedWorkspaceRoots.find(
    (workspaceRoot) => normalizePath(workspaceRoot) === normalizePath(defaultDeveloperWorkspaceRoot)
  ) || null;
  const activeWorkspaceRoot = findLikelyActiveWorkspaceRoot(developerRoot, latestAppContext);

  return {
    approvedWorkspaceRoots,
    protectedRoots,
    permissiveDevModeEnabled,
    developerRoot,
    activeWorkspaceRoot: activeWorkspaceRoot || developerRoot || approvedWorkspaceRoots[0] || canonicalizePathForAccess(process.cwd()),
    defaultWorkspaceRoot: activeWorkspaceRoot || developerRoot || approvedWorkspaceRoots[0] || canonicalizePathForAccess(process.cwd())
  };
}

function ensureSystemControlAllowed(systemControlPolicy, capability, toolName) {
  const capabilityMap = {
    mouse: systemControlPolicy.allowMouseControl,
    keyboard: systemControlPolicy.allowKeyboardControl,
    launch: systemControlPolicy.allowLaunchControl,
    close: systemControlPolicy.allowCloseControl,
    "window-switch": systemControlPolicy.allowWindowSwitching,
    "file-search": systemControlPolicy.allowFileSearch
  };

  if (!systemControlPolicy.isSystemControlAllowed) {
    return buildBlockedResponse(
      toolName,
      systemControlPolicy.isPermissiveDevModeEnabled
        ? "System control is still blocked because this request did not clearly ask for hands-on machine help."
        : "System control is only available for explicit voice requests from the user. This request did not qualify."
    );
  }

  if (!capabilityMap[capability]) {
    return buildBlockedResponse(
      toolName,
      `System control blocked ${toolName} because the current request did not explicitly ask for that kind of action.`
    );
  }

  return {
    ok: true
  };
}

function buildApprovedWorkspaceRoots(latestAppContext) {
  const configuredRoots = String(process.env[allowedWorkspaceRootsEnvVar] || "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  const likelyActiveWorkspaceRoot = buildLikelyActiveWorkspaceRoot(latestAppContext);
  const candidateRoots = [
    likelyActiveWorkspaceRoot,
    defaultDeveloperWorkspaceRoot,
    process.cwd(),
    ...configuredRoots
  ].filter(Boolean);
  const uniqueRoots = [];

  for (const candidateRoot of candidateRoots) {
    const canonicalRoot = canonicalizePathForAccess(candidateRoot);
    if (!uniqueRoots.includes(canonicalRoot)) {
      uniqueRoots.push(canonicalRoot);
    }
  }

  return uniqueRoots;
}

function buildSystemSearchRoots(workspaceAccessContext) {
  const candidateRoots = [
    workspaceAccessContext.activeWorkspaceRoot,
    defaultDeveloperWorkspaceRoot,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Desktop") : "",
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Documents") : "",
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Downloads") : "",
    process.env.USERPROFILE || ""
  ].filter(Boolean);
  const uniqueRoots = [];

  for (const candidateRoot of candidateRoots) {
    if (!fs.existsSync(candidateRoot)) {
      continue;
    }

    const canonicalRoot = canonicalizePathForAccess(candidateRoot);
    if (!uniqueRoots.includes(canonicalRoot)) {
      uniqueRoots.push(canonicalRoot);
    }
  }

  return uniqueRoots;
}

function buildProtectedRoots() {
  const userProfile = process.env.USERPROFILE || "";
  const localAppData = process.env.LOCALAPPDATA || "";
  const appData = process.env.APPDATA || "";
  const windowsDirectory = process.env.windir || "C:\\Windows";
  const candidateRoots = [
    windowsDirectory,
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    userProfile ? path.join(userProfile, ".ssh") : "",
    userProfile ? path.join(userProfile, ".aws") : "",
    userProfile ? path.join(userProfile, ".gnupg") : "",
    userProfile ? path.join(userProfile, ".docker") : "",
    userProfile ? path.join(userProfile, ".kube") : "",
    localAppData ? path.join(localAppData, "Google", "Chrome", "User Data") : "",
    localAppData ? path.join(localAppData, "Microsoft", "Edge", "User Data") : "",
    localAppData ? path.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data") : "",
    appData ? path.join(appData, "Mozilla", "Firefox", "Profiles") : ""
  ].filter(Boolean);
  const uniqueRoots = [];

  for (const candidateRoot of candidateRoots) {
    const canonicalRoot = canonicalizePathForAccess(candidateRoot);
    if (!uniqueRoots.includes(canonicalRoot)) {
      uniqueRoots.push(canonicalRoot);
    }
  }

  return uniqueRoots;
}

function buildLikelyActiveWorkspaceRoot(latestAppContext) {
  const normalizedProjectHint = String(latestAppContext?.projectHint || "").trim();
  if (!normalizedProjectHint || !fs.existsSync(defaultDeveloperWorkspaceRoot)) {
    return null;
  }

  const candidatePath = path.resolve(defaultDeveloperWorkspaceRoot, normalizedProjectHint);
  if (!isPathInsideRoot(candidatePath, defaultDeveloperWorkspaceRoot) || !fs.existsSync(candidatePath)) {
    return null;
  }

  try {
    if (!fs.statSync(candidatePath).isDirectory()) {
      return null;
    }
  } catch {
    return null;
  }

  return canonicalizePathForAccess(candidatePath);
}

function findLikelyActiveWorkspaceRoot(developerRoot, latestAppContext) {
  if (!developerRoot) {
    return null;
  }

  const normalizedProjectHint = String(latestAppContext?.projectHint || "").trim();
  if (!normalizedProjectHint) {
    return null;
  }

  const candidatePath = path.resolve(developerRoot, normalizedProjectHint);
  if (!isPathInsideRoot(candidatePath, developerRoot) || !fs.existsSync(candidatePath)) {
    return null;
  }

  try {
    if (!fs.statSync(candidatePath).isDirectory()) {
      return null;
    }
  } catch {
    return null;
  }

  return canonicalizePathForAccess(candidatePath);
}

function findContainingApprovedWorkspaceRoot(workspaceAccessContext, targetPath) {
  return workspaceAccessContext.approvedWorkspaceRoots.find(
    (workspaceRoot) => isPathInsideRoot(targetPath, workspaceRoot)
  ) || null;
}

function findContainingProtectedRoot(workspaceAccessContext, targetPath) {
  return (workspaceAccessContext.protectedRoots || []).find(
    (protectedRoot) => isPathInsideRoot(targetPath, protectedRoot)
  ) || null;
}

function isPathInsideApprovedWorkspace(workspaceAccessContext, targetPath) {
  const canonicalPath = canonicalizePathForAccess(targetPath, workspaceAccessContext.defaultWorkspaceRoot);
  return Boolean(findContainingApprovedWorkspaceRoot(workspaceAccessContext, canonicalPath));
}

function isPathInsideRoot(targetPath, rootPath) {
  const normalizedTargetPath = normalizePath(targetPath);
  const normalizedRootPath = normalizePath(rootPath);
  const relativePath = path.relative(normalizedRootPath, normalizedTargetPath);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function canonicalizePathForAccess(targetPath, fallbackPath = process.cwd()) {
  const absolutePath = path.resolve(String(targetPath || fallbackPath));

  if (fs.existsSync(absolutePath)) {
    return resolveRealPath(absolutePath);
  }

  const nearestExistingAncestor = findNearestExistingAncestor(absolutePath);
  if (!nearestExistingAncestor) {
    return absolutePath;
  }

  const canonicalAncestor = resolveRealPath(nearestExistingAncestor);
  const relativeSuffix = path.relative(nearestExistingAncestor, absolutePath);

  return path.resolve(canonicalAncestor, relativeSuffix);
}

function findNearestExistingAncestor(targetPath) {
  let currentPath = path.resolve(targetPath);
  while (!fs.existsSync(currentPath)) {
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }

    currentPath = parentPath;
  }

  return currentPath;
}

function resolveRealPath(targetPath) {
  if (fs.realpathSync.native) {
    return fs.realpathSync.native(targetPath);
  }

  return fs.realpathSync(targetPath);
}

function tokenizeCommand(command) {
  return command.match(/"[^"]*"|'[^']*'|\S+/g) || [];
}

function stripWrappingQuotes(token) {
  return String(token || "").replace(/^(['"])(.*)\1$/, "$2");
}

function looksLikeAbsoluteWindowsPath(token) {
  return /^[a-zA-Z]:[\\/]/.test(token) || /^\\\\/.test(token);
}

function looksLikeRelativePath(token) {
  return token === "."
    || token === ".."
    || token.startsWith(".\\")
    || token.startsWith("..\\")
    || token.startsWith("./")
    || token.startsWith("../")
    || token.includes("\\")
    || token.includes("/");
}

function clampCommandTimeout(timeoutSeconds) {
  const parsedTimeoutSeconds = Number(timeoutSeconds || defaultCommandTimeoutSeconds);
  if (!Number.isFinite(parsedTimeoutSeconds)) {
    return defaultCommandTimeoutSeconds;
  }

  return Math.min(
    maximumCommandTimeoutSeconds,
    Math.max(minimumCommandTimeoutSeconds, Math.floor(parsedTimeoutSeconds))
  );
}

function normalizePath(targetPath) {
  const resolvedPath = path.resolve(targetPath);
  if (resolvedPath.length > 3 && /[\\/]$/.test(resolvedPath)) {
    return resolvedPath.slice(0, -1).toLowerCase();
  }

  return resolvedPath.toLowerCase();
}

function getVirtualDesktopBounds() {
  const displays = screen.getAllDisplays();
  const minX = Math.min(...displays.map((display) => display.bounds.x));
  const minY = Math.min(...displays.map((display) => display.bounds.y));
  const maxX = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width));
  const maxY = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function resolveSystemExecutable(commandName) {
  if (commandName === "npm") {
    return "npm.cmd";
  }

  if (commandName === "where") {
    return "where.exe";
  }

  return commandName;
}

function isOpenPathExtensionBlocked(targetPath, workspaceAccessContext) {
  const extension = path.extname(targetPath).toLowerCase();
  if (!workspaceAccessContext.permissiveDevModeEnabled) {
    return blockedOpenFileExtensions.has(extension);
  }

  return [".dll", ".sys"].includes(extension);
}

function isLikelyBinaryFile(filePath) {
  return [
    ".7z",
    ".avi",
    ".bmp",
    ".dll",
    ".doc",
    ".docx",
    ".exe",
    ".gif",
    ".ico",
    ".jar",
    ".jpeg",
    ".jpg",
    ".mov",
    ".mp3",
    ".mp4",
    ".pdf",
    ".png",
    ".ppt",
    ".pptx",
    ".wav",
    ".xls",
    ".xlsx",
    ".zip"
  ].includes(path.extname(filePath).toLowerCase());
}

function truncateText(text, maxCharacters) {
  const normalizedText = String(text || "");
  if (normalizedText.length <= maxCharacters) {
    return {
      value: normalizedText,
      wasTruncated: false
    };
  }

  return {
    value: `${normalizedText.slice(0, maxCharacters)}\n\n[truncated]`,
    wasTruncated: true
  };
}

function buildBlockedResponse(toolName, error) {
  return {
    ok: false,
    error,
    blocked: true,
    toolName
  };
}

function formatApprovedWorkspaceRoots(workspaceAccessContext) {
  if (workspaceAccessContext.permissiveDevModeEnabled) {
    return "all non-protected local paths";
  }

  return workspaceAccessContext.approvedWorkspaceRoots.join(", ");
}

function formatProtectedRoots(workspaceAccessContext) {
  return (workspaceAccessContext.protectedRoots || []).join(", ");
}

function formatAllowedCommands() {
  return [
    ...Array.from(readOnlyPowerShellCommands).sort(),
    ...Array.from(allowedSystemExecutables).sort()
  ].join(", ");
}
