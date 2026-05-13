import { execFile } from "node:child_process";

const modeMatchers = {
  code: [
    "code",
    "cursor",
    "devenv",
    "idea64",
    "webstorm64",
    "pycharm64",
    "clion64",
    "rider64",
    "studio64",
    "notepad++",
    "sublime_text"
  ],
  terminal: [
    "windowsterminal",
    "powershell",
    "pwsh",
    "cmd",
    "bash",
    "wezterm",
    "alacritty"
  ],
  creative: [
    "adobepremierepro",
    "premiere",
    "afterfx",
    "photoshop",
    "illustrator",
    "blender",
    "resolve",
    "figma"
  ],
  security: [
    "burp",
    "burpsuite",
    "burp suite",
    "owasp zap",
    "zaproxy",
    "wireshark"
  ],
  browser: [
    "chrome",
    "msedge",
    "firefox",
    "brave",
    "opera"
  ],
  writing: [
    "winword",
    "notion",
    "obsidian",
    "typora",
    "slack",
    "outlook"
  ],
  spreadsheet: [
    "excel"
  ],
  meeting: [
    "teams",
    "zoom"
  ]
};

const modeBehaviorHints = {
  code: "Code mode. Prioritize debugging, code edits, terminal commands, precise technical explanations, and step-by-step implementation help.",
  terminal: "Terminal mode. Prioritize shell commands, logs, environment diagnosis, and command-line troubleshooting.",
  creative: "Creative mode. Prioritize editing flow, visual composition, storytelling, iteration suggestions, and practical shortcuts inside creative apps.",
  security: "Security tool mode. Prioritize safe verification, request and response analysis, repeatable troubleshooting, and practical UI actions inside security tools.",
  browser: "Browser mode. Prioritize navigation help, research support, and explaining what is visible in the current page or tab.",
  writing: "Writing mode. Prioritize drafting, editing, summarizing, structure, and tone refinement.",
  spreadsheet: "Spreadsheet mode. Prioritize formulas, data cleanup, analysis, charts, and table reasoning.",
  meeting: "Meeting mode. Prioritize concise summaries, action items, and communication support.",
  general: "General mode. Adapt to the user's goal based on the visible app and screen content."
};

export async function getForegroundAppContext() {
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class NativeForegroundWindow {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

$windowHandle = [NativeForegroundWindow]::GetForegroundWindow()
if ($windowHandle -eq [IntPtr]::Zero) {
  @{
    processId = 0
    processName = ""
    windowTitle = ""
    executablePath = ""
  } | ConvertTo-Json -Compress
  exit
}

$windowTitleBuilder = New-Object System.Text.StringBuilder 2048
[void][NativeForegroundWindow]::GetWindowText($windowHandle, $windowTitleBuilder, $windowTitleBuilder.Capacity)
$processId = 0
[void][NativeForegroundWindow]::GetWindowThreadProcessId($windowHandle, [ref]$processId)
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue

@{
  processId = $processId
  processName = if ($process) { $process.Name } else { "" }
  windowTitle = $windowTitleBuilder.ToString()
  executablePath = if ($process) { $process.ExecutablePath } else { "" }
} | ConvertTo-Json -Compress
  `.trim();

  try {
    const stdout = await runPowerShellScript(script, 8000);
    const parsedContext = JSON.parse(stdout || "{}");
    const normalizedProcessName = normalizeProcessName(parsedContext.processName);
    const detectedMode = detectModeFromProcessAndTitle({
      processName: normalizedProcessName,
      windowTitle: parsedContext.windowTitle || ""
    });
    const runtimeEnvironment = detectRuntimeEnvironment({
      processName: normalizedProcessName,
      windowTitle: String(parsedContext.windowTitle || "").trim(),
      executablePath: String(parsedContext.executablePath || "").trim()
    });

    return {
      capturedAt: new Date().toISOString(),
      processId: Number(parsedContext.processId || 0),
      processName: normalizedProcessName,
      windowTitle: String(parsedContext.windowTitle || "").trim(),
      executablePath: String(parsedContext.executablePath || "").trim(),
      detectedMode,
      runtimeEnvironment,
      projectHint: deriveProjectHint({
        processName: normalizedProcessName,
        windowTitle: String(parsedContext.windowTitle || "").trim(),
        detectedMode
      }),
      behaviorHint: buildBehaviorHint(detectedMode, runtimeEnvironment)
    };
  } catch (error) {
    console.warn("Failed to inspect the foreground Windows app:", error);
    return {
      capturedAt: new Date().toISOString(),
      processId: 0,
      processName: "",
      windowTitle: "",
      executablePath: "",
      detectedMode: "general",
      runtimeEnvironment: "windows-native",
      projectHint: "",
      behaviorHint: buildBehaviorHint("general", "windows-native")
    };
  }
}

export function hasMeaningfullyChangedAppContext(previousAppContext, nextAppContext) {
  if (!previousAppContext) {
    return true;
  }

  return (
    previousAppContext.processName !== nextAppContext.processName ||
    previousAppContext.windowTitle !== nextAppContext.windowTitle ||
    previousAppContext.detectedMode !== nextAppContext.detectedMode ||
    previousAppContext.runtimeEnvironment !== nextAppContext.runtimeEnvironment ||
    previousAppContext.projectHint !== nextAppContext.projectHint
  );
}

export function detectModeFromProcessAndTitle({ processName, windowTitle }) {
  const normalizedText = `${processName} ${windowTitle}`.toLowerCase();

  for (const [modeName, candidates] of Object.entries(modeMatchers)) {
    if (candidates.some((candidate) => normalizedText.includes(candidate))) {
      return modeName;
    }
  }

  return "general";
}

export function detectRuntimeEnvironment({ processName, windowTitle, executablePath }) {
  const normalizedText = `${processName} ${windowTitle} ${executablePath}`.toLowerCase();

  if (
    [
      "ubuntu",
      "debian",
      "kali",
      "fedora",
      "opensuse",
      "wsl",
      "wslg"
    ].some((candidate) => normalizedText.includes(candidate))
  ) {
    return "wsl-linux";
  }

  return "windows-native";
}

export function buildBehaviorHint(detectedMode, runtimeEnvironment) {
  const baseHint = modeBehaviorHints[detectedMode] || modeBehaviorHints.general;
  if (runtimeEnvironment !== "wsl-linux") {
    return baseHint;
  }

  return `${baseHint} This app appears to be running through Ubuntu or WSL on Windows, so prefer screenshot-driven UI automation and in-app navigation over assumptions about a Windows-native menu layout or a localhost REST API.`;
}

function deriveProjectHint({ processName, windowTitle, detectedMode }) {
  if (!windowTitle) {
    return "";
  }

  const titleSegments = windowTitle
    .split(/\s[-|—]\s/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (titleSegments.length === 0) {
    return "";
  }

  if (detectedMode === "code" || detectedMode === "terminal") {
    const appNameSegmentIndex = titleSegments.findIndex((segment) => {
      const normalizedSegment = segment.toLowerCase();
      return normalizedSegment.includes(processName.toLowerCase()) || normalizedSegment.includes("visual studio code");
    });

    if (appNameSegmentIndex > 0) {
      return titleSegments[appNameSegmentIndex - 1];
    }

    if (titleSegments.length >= 2) {
      return titleSegments[titleSegments.length - 2];
    }
  }

  return titleSegments[0];
}

function normalizeProcessName(processName) {
  return String(processName || "")
    .trim()
    .replace(/\.exe$/i, "");
}

function runPowerShellScript(script, timeoutMilliseconds) {
  const encodedScript = Buffer.from(script, "utf16le").toString("base64");

  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodedScript
      ],
      {
        windowsHide: true,
        timeout: timeoutMilliseconds
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }

        resolve(stdout.trim());
      }
    );
  });
}
