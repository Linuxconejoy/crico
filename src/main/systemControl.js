import path from "node:path";
import { execFile } from "node:child_process";

const defaultAutomationTimeoutMilliseconds = 15000;

export function validateVirtualDesktopPoint({ x, y, virtualDesktopBounds }) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return {
      ok: false,
      error: "System control requires integer screen coordinates."
    };
  }

  const isInsideVirtualDesktop = x >= virtualDesktopBounds.x &&
    y >= virtualDesktopBounds.y &&
    x < virtualDesktopBounds.x + virtualDesktopBounds.width &&
    y < virtualDesktopBounds.y + virtualDesktopBounds.height;

  if (!isInsideVirtualDesktop) {
    return {
      ok: false,
      error: `System control blocked the pointer action because (${x}, ${y}) is outside the Windows virtual desktop bounds ${formatVirtualDesktopBounds(virtualDesktopBounds)}.`
    };
  }

  return {
    ok: true
  };
}

export function resolveSystemTargetCandidate(target, defaultWorkspaceRoot) {
  const normalizedTarget = String(target || "").trim();
  if (!normalizedTarget) {
    return "";
  }

  if (path.isAbsolute(normalizedTarget)) {
    return normalizedTarget;
  }

  if (looksLikePathishTarget(normalizedTarget)) {
    return path.resolve(defaultWorkspaceRoot, normalizedTarget);
  }

  return normalizedTarget;
}

export async function executeWindowsSystemControl(actionPayload) {
  const payloadJson = JSON.stringify(actionPayload);
  const payloadBase64 = Buffer.from(payloadJson, "utf8").toString("base64");
  const encodedScript = Buffer.from(
    buildWindowsSystemControlPowerShellScript(payloadBase64),
    "utf16le"
  ).toString("base64");

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
        timeout: defaultAutomationTimeoutMilliseconds
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }

        try {
          resolve(JSON.parse(String(stdout || "{}").trim() || "{}"));
        } catch {
          reject(new Error(`System control returned invalid JSON: ${String(stdout || "").trim()}`));
        }
      }
    );
  });
}

export function buildWindowsSystemControlPowerShellScript(payloadBase64) {
  return `
$payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("${payloadBase64}"))
$payload = $payloadJson | ConvertFrom-Json

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class ClickyWindowsAutomation {
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public InputUnion U;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)]
    public MOUSEINPUT mi;

    [FieldOffset(0)]
    public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  public sealed class WindowDescriptor {
    public long Handle;
    public string Title = "";
    public string ProcessName = "";
    public int ProcessId;
  }

  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  private const uint INPUT_MOUSE = 0;
  private const uint INPUT_KEYBOARD = 1;
  private const uint KEYEVENTF_KEYUP = 0x0002;
  private const uint KEYEVENTF_UNICODE = 0x0004;
  private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  private const uint MOUSEEVENTF_LEFTUP = 0x0004;
  private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  private const uint WM_CLOSE = 0x0010;
  private const int SW_RESTORE = 9;

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

  public static void MoveCursor(int x, int y) {
    if (!SetCursorPos(x, y)) {
      throw new InvalidOperationException("SetCursorPos failed.");
    }
  }

  public static void LeftClick() {
    SendMouseClick(MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP);
  }

  public static void RightClick() {
    SendMouseClick(MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP);
  }

  public static void DoubleClick() {
    LeftClick();
    LeftClick();
  }

  public static void LeftButtonDown() {
    INPUT[] inputs = new INPUT[1];
    inputs[0].type = INPUT_MOUSE;
    inputs[0].U.mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
    Send(inputs);
  }

  public static void LeftButtonUp() {
    INPUT[] inputs = new INPUT[1];
    inputs[0].type = INPUT_MOUSE;
    inputs[0].U.mi.dwFlags = MOUSEEVENTF_LEFTUP;
    Send(inputs);
  }

  public static void TypeText(string text) {
    foreach (char character in text) {
      INPUT[] inputs = new INPUT[2];
      inputs[0].type = INPUT_KEYBOARD;
      inputs[0].U.ki.wScan = character;
      inputs[0].U.ki.dwFlags = KEYEVENTF_UNICODE;
      inputs[1].type = INPUT_KEYBOARD;
      inputs[1].U.ki.wScan = character;
      inputs[1].U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
      Send(inputs);
    }
  }

  public static void PressEnter() {
    PressVirtualKeys(new ushort[] { 0x0D });
  }

  public static void PressVirtualKeys(ushort[] virtualKeys) {
    if (virtualKeys == null || virtualKeys.Length == 0) {
      throw new InvalidOperationException("No keys provided.");
    }

    foreach (ushort virtualKey in virtualKeys) {
      KeyDown(virtualKey);
    }

    for (int index = virtualKeys.Length - 1; index >= 0; index--) {
      KeyUp(virtualKeys[index]);
    }
  }

  public static List<WindowDescriptor> GetVisibleWindows() {
    var windows = new List<WindowDescriptor>();

    EnumWindows((handle, lParam) => {
      if (!IsWindowVisible(handle)) {
        return true;
      }

      var titleBuilder = new StringBuilder(2048);
      GetWindowText(handle, titleBuilder, titleBuilder.Capacity);
      string title = titleBuilder.ToString().Trim();
      if (string.IsNullOrWhiteSpace(title)) {
        return true;
      }

      uint processId;
      GetWindowThreadProcessId(handle, out processId);
      string processName = "";

      try {
        processName = Process.GetProcessById((int)processId).ProcessName;
      } catch {
        processName = "";
      }

      windows.Add(new WindowDescriptor {
        Handle = handle.ToInt64(),
        Title = title,
        ProcessName = processName,
        ProcessId = (int)processId
      });

      return true;
    }, IntPtr.Zero);

    return windows;
  }

  public static void ActivateWindow(long handleValue) {
    IntPtr handle = new IntPtr(handleValue);
    ShowWindow(handle, SW_RESTORE);
    if (!SetForegroundWindow(handle)) {
      throw new InvalidOperationException("SetForegroundWindow failed.");
    }
  }

  public static void CloseWindow(long handleValue) {
    IntPtr handle = new IntPtr(handleValue);
    if (!PostMessage(handle, WM_CLOSE, IntPtr.Zero, IntPtr.Zero)) {
      throw new InvalidOperationException("PostMessage(WM_CLOSE) failed.");
    }
  }

  private static void KeyDown(ushort virtualKey) {
    INPUT[] inputs = new INPUT[1];
    inputs[0].type = INPUT_KEYBOARD;
    inputs[0].U.ki.wVk = virtualKey;
    Send(inputs);
  }

  private static void KeyUp(ushort virtualKey) {
    INPUT[] inputs = new INPUT[1];
    inputs[0].type = INPUT_KEYBOARD;
    inputs[0].U.ki.wVk = virtualKey;
    inputs[0].U.ki.dwFlags = KEYEVENTF_KEYUP;
    Send(inputs);
  }

  private static void SendMouseClick(uint downFlag, uint upFlag) {
    INPUT[] inputs = new INPUT[2];
    inputs[0].type = INPUT_MOUSE;
    inputs[0].U.mi.dwFlags = downFlag;
    inputs[1].type = INPUT_MOUSE;
    inputs[1].U.mi.dwFlags = upFlag;
    Send(inputs);
  }

  private static void Send(INPUT[] inputs) {
    uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (sent != inputs.Length) {
      throw new InvalidOperationException("SendInput failed.");
    }
  }
}
"@

function Resolve-VirtualKeyCode {
  param(
    [Parameter(Mandatory = $true)]
    [string]$KeyName
  )

  $normalizedKeyName = $KeyName.Trim().ToLowerInvariant()
  $namedVirtualKeys = @{
    "alt" = 0x12
    "backspace" = 0x08
    "ctrl" = 0x11
    "delete" = 0x2E
    "down" = 0x28
    "end" = 0x23
    "enter" = 0x0D
    "esc" = 0x1B
    "escape" = 0x1B
    "home" = 0x24
    "left" = 0x25
    "pagedown" = 0x22
    "pageup" = 0x21
    "right" = 0x27
    "shift" = 0x10
    "space" = 0x20
    "tab" = 0x09
    "up" = 0x26
    "win" = 0x5B
  }

  if ($namedVirtualKeys.ContainsKey($normalizedKeyName)) {
    return [UInt16]$namedVirtualKeys[$normalizedKeyName]
  }

  if ($normalizedKeyName.Length -ge 2 -and $normalizedKeyName.Length -le 3 -and $normalizedKeyName.StartsWith("f")) {
    $functionNumber = 0
    if ([int]::TryParse($normalizedKeyName.Substring(1), [ref]$functionNumber) -and $functionNumber -ge 1 -and $functionNumber -le 12) {
      return [UInt16](0x70 + $functionNumber - 1)
    }
  }

  if ($normalizedKeyName.Length -eq 1) {
    $characterCode = [int][char]$normalizedKeyName.ToUpperInvariant()
    return [UInt16]$characterCode
  }

  throw "Unsupported key name: $KeyName"
}

function Get-ClickyVisibleWindows {
  return [ClickyWindowsAutomation]::GetVisibleWindows()
}

function Resolve-WindowTarget {
  param(
    [string]$Target,
    [Nullable[int]]$Index
  )

  $windows = @(Get-ClickyVisibleWindows)
  if ($windows.Count -eq 0) {
    throw "No visible windows were found."
  }

  if ($Index -ne $null) {
    if ($Index.Value -lt 1 -or $Index.Value -gt $windows.Count) {
      throw "Window index $($Index.Value) is out of range."
    }

    return $windows[$Index.Value - 1]
  }

  if ([string]::IsNullOrWhiteSpace($Target)) {
    throw "A window target or index is required."
  }

  $normalizedTarget = $Target.Trim().ToLowerInvariant()
  $match = $windows | Where-Object {
    $_.Title.ToLowerInvariant().Contains($normalizedTarget) -or $_.ProcessName.ToLowerInvariant().Contains($normalizedTarget)
  } | Select-Object -First 1

  if (-not $match) {
    throw "No visible window matched '$Target'."
  }

  return $match
}

try {
  switch ([string]$payload.kind) {
    "mouse" {
      $x = [int]$payload.x
      $y = [int]$payload.y
      [ClickyWindowsAutomation]::MoveCursor($x, $y)
      Start-Sleep -Milliseconds 50

      switch ([string]$payload.action) {
        "move" {
        }
        "left_click" {
          [ClickyWindowsAutomation]::LeftClick()
        }
        "double_click" {
          [ClickyWindowsAutomation]::DoubleClick()
        }
        "right_click" {
          [ClickyWindowsAutomation]::RightClick()
        }
        default {
          throw "Unsupported mouse action: $($payload.action)"
        }
      }

      @{
        ok = $true
        kind = "mouse"
        action = [string]$payload.action
        x = $x
        y = $y
      } | ConvertTo-Json -Compress
      exit
    }

    "drag" {
      $startX = [int]$payload.startX
      $startY = [int]$payload.startY
      $endX = [int]$payload.endX
      $endY = [int]$payload.endY
      $stepCount = [Math]::Max(4, [Math]::Min(60, [int]$payload.stepCount))

      [ClickyWindowsAutomation]::MoveCursor($startX, $startY)
      Start-Sleep -Milliseconds 40
      [ClickyWindowsAutomation]::LeftButtonDown()

      for ($stepIndex = 1; $stepIndex -le $stepCount; $stepIndex++) {
        $progress = $stepIndex / [double]$stepCount
        $currentX = [int][Math]::Round($startX + (($endX - $startX) * $progress))
        $currentY = [int][Math]::Round($startY + (($endY - $startY) * $progress))
        [ClickyWindowsAutomation]::MoveCursor($currentX, $currentY)
        Start-Sleep -Milliseconds 8
      }

      Start-Sleep -Milliseconds 30
      [ClickyWindowsAutomation]::LeftButtonUp()

      @{
        ok = $true
        kind = "drag"
        startX = $startX
        startY = $startY
        endX = $endX
        endY = $endY
        stepCount = $stepCount
      } | ConvertTo-Json -Compress
      exit
    }

    "keyboard" {
      $text = [string]$payload.text
      [ClickyWindowsAutomation]::TypeText($text)
      if ([bool]$payload.pressEnterAfter) {
        [ClickyWindowsAutomation]::PressEnter()
      }

      @{
        ok = $true
        kind = "keyboard"
        typedLength = $text.Length
        pressEnterAfter = [bool]$payload.pressEnterAfter
      } | ConvertTo-Json -Compress
      exit
    }

    "shortcut" {
      $keyNames = @($payload.keys)
      if ($keyNames.Count -eq 0) {
        throw "No keys were provided."
      }

      $virtualKeys = New-Object 'System.Collections.Generic.List[UInt16]'
      foreach ($keyName in $keyNames) {
        $virtualKeys.Add((Resolve-VirtualKeyCode ([string]$keyName)))
      }

      [ClickyWindowsAutomation]::PressVirtualKeys($virtualKeys.ToArray())

      @{
        ok = $true
        kind = "shortcut"
        keys = $keyNames
      } | ConvertTo-Json -Compress
      exit
    }

    "launch" {
      $target = [string]$payload.target
      if ([string]::IsNullOrWhiteSpace($target)) {
        throw "Missing system target."
      }

      $arguments = @()
      if ($payload.arguments) {
        $arguments = @($payload.arguments)
      }

      $resolvedTarget = $target
      if (Test-Path -LiteralPath $target) {
        $resolvedTarget = (Resolve-Path -LiteralPath $target).Path
      }

      if ($arguments.Count -gt 0) {
        Start-Process -FilePath $resolvedTarget -ArgumentList $arguments | Out-Null
      } else {
        Start-Process -FilePath $resolvedTarget | Out-Null
      }

      @{
        ok = $true
        kind = "launch"
        target = $target
        resolvedTarget = $resolvedTarget
        arguments = $arguments
      } | ConvertTo-Json -Compress
      exit
    }

    "switch_window" {
      $resolvedWindow = Resolve-WindowTarget -Target ([string]$payload.target) -Index $payload.index
      [ClickyWindowsAutomation]::ActivateWindow([Int64]$resolvedWindow.Handle)

      @{
        ok = $true
        kind = "switch_window"
        title = $resolvedWindow.Title
        processName = $resolvedWindow.ProcessName
        handle = $resolvedWindow.Handle
      } | ConvertTo-Json -Compress
      exit
    }

    "close_application" {
      $resolvedWindow = Resolve-WindowTarget -Target ([string]$payload.target) -Index $payload.index
      [ClickyWindowsAutomation]::CloseWindow([Int64]$resolvedWindow.Handle)

      @{
        ok = $true
        kind = "close_application"
        title = $resolvedWindow.Title
        processName = $resolvedWindow.ProcessName
        handle = $resolvedWindow.Handle
      } | ConvertTo-Json -Compress
      exit
    }

    default {
      throw "Unsupported system control kind: $($payload.kind)"
    }
  }
} catch {
  @{
    ok = $false
    error = $_.Exception.Message
    kind = [string]$payload.kind
  } | ConvertTo-Json -Compress
}
  `.trim();
}

function looksLikePathishTarget(target) {
  return target.includes("\\")
    || target.includes("/")
    || path.extname(target).length > 0
    || target.startsWith(".")
    || /^[a-zA-Z]:$/.test(target);
}

function formatVirtualDesktopBounds(virtualDesktopBounds) {
  return `[x=${virtualDesktopBounds.x}, y=${virtualDesktopBounds.y}, width=${virtualDesktopBounds.width}, height=${virtualDesktopBounds.height}]`;
}
