import { spawn } from "node:child_process";

const powerShellReadySignal = "READY";
const powerShellStartSignal = "PTT_START";
const powerShellStopSignal = "PTT_STOP";

export class GlobalPushToTalkMonitor {
  constructor({ onStart, onStop, onError }) {
    this.onStart = onStart;
    this.onStop = onStop;
    this.onError = onError;
    this.isPushToTalkActive = false;
    this.powerShellHelperProcess = null;
    this.powerShellStdoutBuffer = "";
    this.mode = "idle";
  }

  async start() {
    if (this.powerShellHelperProcess) {
      return {
        mode: this.mode
      };
    }

    await this.startWindowsPowerShellListener();
    this.mode = "native-embedded";
    return {
      mode: this.mode
    };
  }

  stop() {
    this.stopWindowsPowerShellListener();
    this.mode = "idle";
  }

  async startWindowsPowerShellListener() {
    const encodedCommand = Buffer.from(buildWindowsPushToTalkPowerShellScript(), "utf16le").toString(
      "base64"
    );

    await new Promise((resolve, reject) => {
      let didResolveReady = false;
      let stderrBuffer = "";
      const nextProcess = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-WindowStyle",
          "Hidden",
          "-EncodedCommand",
          encodedCommand
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true
        }
      );

      const settleAsError = (error) => {
        if (didResolveReady) {
          this.onError?.(error);
          return;
        }

        reject(error);
      };

      nextProcess.once("error", (error) => {
        settleAsError(error);
      });

      nextProcess.once("exit", (code, signal) => {
        const wasManagedShutdown = didResolveReady && this.powerShellHelperProcess !== nextProcess;
        const unexpectedExitError =
          code === 0
            ? null
            : new Error(
                stderrBuffer.trim() ||
                  `Windows push-to-talk helper exited before it became ready (code=${code}, signal=${signal ?? "none"}).`
              );

        if (!didResolveReady) {
          settleAsError(
            unexpectedExitError ||
              new Error("Windows push-to-talk helper exited before it became ready.")
          );
          return;
        }

        if (wasManagedShutdown) {
          return;
        }

        this.powerShellHelperProcess = null;
        this.powerShellStdoutBuffer = "";
        if (this.isPushToTalkActive) {
          this.isPushToTalkActive = false;
          this.onStop?.();
        }

        if (unexpectedExitError) {
          this.onError?.(unexpectedExitError);
        }
      });

      nextProcess.stdout.setEncoding("utf8");
      nextProcess.stdout.on("data", (chunk) => {
        this.powerShellStdoutBuffer += chunk;
        const outputLines = this.powerShellStdoutBuffer.split(/\r?\n/);
        this.powerShellStdoutBuffer = outputLines.pop() ?? "";

        for (const rawLine of outputLines) {
          const line = rawLine.trim();
          if (!line) {
            continue;
          }

          if (!didResolveReady && line === powerShellReadySignal) {
            didResolveReady = true;
            this.powerShellHelperProcess = nextProcess;
            this.powerShellStdoutBuffer = "";
            resolve();
            continue;
          }

          if (line === powerShellStartSignal && !this.isPushToTalkActive) {
            this.isPushToTalkActive = true;
            this.onStart?.();
            continue;
          }

          if (line === powerShellStopSignal && this.isPushToTalkActive) {
            this.isPushToTalkActive = false;
            this.onStop?.();
          }
        }
      });

      nextProcess.stderr.setEncoding("utf8");
      nextProcess.stderr.on("data", (chunk) => {
        stderrBuffer += chunk;
      });
    });
  }

  stopWindowsPowerShellListener() {
    if (!this.powerShellHelperProcess) {
      return;
    }

    const helperProcess = this.powerShellHelperProcess;
    this.powerShellHelperProcess = null;
    this.powerShellStdoutBuffer = "";

    try {
      helperProcess.kill();
    } catch (error) {
      this.onError?.(error);
    }

    if (this.isPushToTalkActive) {
      this.isPushToTalkActive = false;
      this.onStop?.();
    }
  }
}

export function buildWindowsPushToTalkPowerShellScript() {
  return `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -Language CSharp @"
using System;
using System.Runtime.InteropServices;

public static class ClickyPushToTalkHook {
    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const int VK_CONTROL = 0x11;
    private const int VK_LCONTROL = 0xA2;
    private const int VK_RCONTROL = 0xA3;
    private const int VK_MENU = 0x12;
    private const int VK_LMENU = 0xA4;
    private const int VK_RMENU = 0xA5;

    private static readonly LowLevelKeyboardProc HookCallbackDelegate = HookCallback;
    private static IntPtr hookId = IntPtr.Zero;
    private static bool pushToTalkActive = false;
    private static bool leftControlDown = false;
    private static bool rightControlDown = false;
    private static bool leftAltDown = false;
    private static bool rightAltDown = false;

    public static int Run() {
        hookId = SetWindowsHookEx(WH_KEYBOARD_LL, HookCallbackDelegate, IntPtr.Zero, 0);
        if (hookId == IntPtr.Zero) {
            return Marshal.GetLastWin32Error();
        }

        Console.WriteLine("${powerShellReadySignal}");
        Console.Out.Flush();

        try {
            MSG message;
            int messageResult;
            while ((messageResult = GetMessage(out message, IntPtr.Zero, 0, 0)) > 0) {
            }
            if (messageResult == -1) {
                return Marshal.GetLastWin32Error();
            }
        } finally {
            UnhookWindowsHookEx(hookId);
            hookId = IntPtr.Zero;
        }

        return 0;
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            int message = wParam.ToInt32();
            if (message == WM_KEYDOWN || message == WM_KEYUP || message == WM_SYSKEYDOWN || message == WM_SYSKEYUP) {
                KBDLLHOOKSTRUCT keyboardData = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
                UpdateModifierState(keyboardData.vkCode, message);

                bool controlPressed = leftControlDown || rightControlDown;
                bool altPressed = leftAltDown || rightAltDown;

                if (!pushToTalkActive && controlPressed && altPressed && IsModifierVirtualKey(keyboardData.vkCode)) {
                    pushToTalkActive = true;
                    Console.WriteLine("${powerShellStartSignal}");
                    Console.Out.Flush();
                } else if (pushToTalkActive && (!controlPressed || !altPressed)) {
                    pushToTalkActive = false;
                    Console.WriteLine("${powerShellStopSignal}");
                    Console.Out.Flush();
                }
            }
        }

        return CallNextHookEx(hookId, nCode, wParam, lParam);
    }

    private static void UpdateModifierState(uint virtualKeyCode, int message) {
        bool isKeyDown = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
        bool isKeyUp = message == WM_KEYUP || message == WM_SYSKEYUP;
        if (!isKeyDown && !isKeyUp) {
            return;
        }

        bool nextState = isKeyDown;
        switch (virtualKeyCode) {
            case VK_CONTROL:
            case VK_LCONTROL:
                leftControlDown = nextState;
                break;
            case VK_RCONTROL:
                rightControlDown = nextState;
                break;
            case VK_MENU:
            case VK_LMENU:
                leftAltDown = nextState;
                break;
            case VK_RMENU:
                rightAltDown = nextState;
                break;
        }
    }

    private static bool IsModifierVirtualKey(uint virtualKeyCode) {
        switch (virtualKeyCode) {
            case VK_CONTROL:
            case VK_LCONTROL:
            case VK_RCONTROL:
            case VK_MENU:
            case VK_LMENU:
            case VK_RMENU:
                return true;
            default:
                return false;
        }
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern int GetMessage(out MSG message, IntPtr hWnd, uint minFilter, uint maxFilter);

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }
}
"@

$exitCode = [ClickyPushToTalkHook]::Run()
if ($exitCode -ne 0) {
    [Console]::Error.WriteLine("Windows push-to-talk hook failed to initialize. Win32 error: $exitCode")
    exit $exitCode
}
`.trim();
}
