const baseAgentToolDefinitions = [
  {
    name: "refresh_screen",
    description: "Capture a fresh screenshot set and focused-app snapshot when you need to re-check what changed on screen before continuing.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "get_app_context",
    description: "Inspect the Windows application currently in focus and the mode Clicky inferred from it.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "open_path",
    description: "Open a file or folder inside an approved workspace root with the default Windows handler. Do not use this for executables or scripts.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative path inside an approved workspace root such as D:\\Developer or the inferred active workspace folder."
        }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    name: "list_directory",
    description: "List files and folders inside an approved workspace directory to discover the local project structure.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative directory path inside an approved workspace root such as D:\\Developer or the inferred active workspace folder."
        }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    name: "search_text",
    description: "Search recursively for text inside workspace files when you need to find code or configuration quickly.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Root directory inside an approved workspace where the search should start."
        },
        query: {
          type: "string",
          description: "Plain text to search for."
        }
      },
      required: ["path", "query"],
      additionalProperties: false
    }
  },
  {
    name: "read_file",
    description: "Read a text file inside an approved workspace root. Use optional line ranges for large files.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative file path inside an approved workspace root such as D:\\Developer or the inferred active workspace folder."
        },
        startLine: {
          type: "integer",
          description: "Optional 1-based start line."
        },
        endLine: {
          type: "integer",
          description: "Optional 1-based end line."
        }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    name: "write_file",
    description: "Write or replace a text-oriented file inside an approved workspace root after you have read the relevant content and decided on the exact edit.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative file path inside an approved workspace root such as D:\\Developer or the inferred active workspace folder."
        },
        content: {
          type: "string",
          description: "Full text content that should be written to disk. Binary files and launcher scripts are blocked."
        }
      },
      required: ["path", "content"],
      additionalProperties: false
    }
  },
  {
    name: "run_command",
    description: "Run a single local command. In normal mode this stays inside approved workspace roots and may require approval. In permissive dev mode it expands to non-protected local paths and approvals are disabled.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Single command text to execute. Supported examples: Get-ChildItem, Select-String, rg \"todo\", git status, npm run check, python .\\scripts\\tool.py."
        },
        cwd: {
          type: "string",
          description: "Optional working directory inside an approved workspace root such as D:\\Developer or the inferred active workspace folder."
        },
        timeoutSeconds: {
          type: "integer",
          description: "Optional timeout in seconds. Defaults to 20 and is clamped to a safe range."
        }
      },
      required: ["command"],
      additionalProperties: false
    }
  }
];

const systemControlToolDefinitions = {
  mouse: {
    name: "control_mouse",
    description: "Move the Windows cursor and optionally click at a specific virtual-desktop coordinate. Use this when the user explicitly asked Clicky to take over or help directly inside an app, including permissive dev mode requests.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["move", "left_click", "double_click", "right_click"],
          description: "Whether to move only or move and click."
        },
        x: {
          type: "integer",
          description: "Virtual-desktop X coordinate in Windows screen space."
        },
        y: {
          type: "integer",
          description: "Virtual-desktop Y coordinate in Windows screen space."
        }
      },
      required: ["action", "x", "y"],
      additionalProperties: false
    }
  },
  drag: {
    name: "drag_mouse",
    description: "Drag from one virtual-desktop coordinate to another. Use this when the user explicitly asked for hands-on UI help that needs a drag, drop, resize, or selection gesture.",
    input_schema: {
      type: "object",
      properties: {
        startX: {
          type: "integer",
          description: "Drag start X coordinate in Windows virtual-desktop space."
        },
        startY: {
          type: "integer",
          description: "Drag start Y coordinate in Windows virtual-desktop space."
        },
        endX: {
          type: "integer",
          description: "Drag end X coordinate in Windows virtual-desktop space."
        },
        endY: {
          type: "integer",
          description: "Drag end Y coordinate in Windows virtual-desktop space."
        },
        stepCount: {
          type: "integer",
          description: "Optional number of interpolation steps for the drag."
        }
      },
      required: ["startX", "startY", "endX", "endY"],
      additionalProperties: false
    }
  },
  keyboard: {
    name: "type_text",
    description: "Type text into the currently focused field as if Clicky were a keyboard. Use this when the user explicitly asked Clicky to type or complete the task for them.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Exact text to type into the currently focused window."
        },
        pressEnterAfter: {
          type: "boolean",
          description: "Optional. Press Enter after typing."
        }
      },
      required: ["text"],
      additionalProperties: false
    }
  },
  shortcut: {
    name: "keyboard_shortcut",
    description: "Press a keyboard shortcut such as Ctrl+C, Alt+Tab, Win+R, or Ctrl+Shift+P. Use this during explicit hands-on assistance when a shortcut is the safest next step.",
    input_schema: {
      type: "object",
      properties: {
        keys: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Ordered key names such as [\"ctrl\", \"c\"] or [\"alt\", \"tab\"]."
        }
      },
      required: ["keys"],
      additionalProperties: false
    }
  },
  launch: {
    name: "open_system_target",
    description: "Open an application, file, folder, or system target by name or path. Use this during explicit hands-on assistance when opening something is necessary to finish the task.",
    input_schema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Application name, executable name, relative path, absolute path, or shell target to open."
        },
        arguments: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Optional argument list when launching an application."
        }
      },
      required: ["target"],
      additionalProperties: false
    }
  },
  close: {
    name: "close_application",
    description: "Gracefully close an application window by process name, window title, or visible window index. Use only when the user explicitly asked for that exact close outcome.",
    input_schema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Application name or window title fragment to close."
        },
        index: {
          type: "integer",
          description: "Optional visible window index if the user identified a specific window by position."
        }
      },
      additionalProperties: false
    }
  },
  switchWindow: {
    name: "switch_window",
    description: "Bring a visible application window to the foreground by name, title fragment, or visible window index.",
    input_schema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Application name or window title fragment to activate."
        },
        index: {
          type: "integer",
          description: "Optional visible window index."
        }
      },
      additionalProperties: false
    }
  },
  fileSearch: {
    name: "search_system_files",
    description: "Search common user and development directories for files or folders by name. Use this when the user wants you to find a file before opening it.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Case-insensitive file or folder name fragment to search for."
        }
      },
      required: ["query"],
      additionalProperties: false
    }
  }
};

export function buildAgentToolDefinitions(systemControlPolicy = {}) {
  const selectedToolDefinitions = [...baseAgentToolDefinitions];

  if (systemControlPolicy.allowMouseControl) {
    selectedToolDefinitions.push(systemControlToolDefinitions.mouse);
    selectedToolDefinitions.push(systemControlToolDefinitions.drag);
  }

  if (systemControlPolicy.allowKeyboardControl) {
    selectedToolDefinitions.push(systemControlToolDefinitions.keyboard);
    selectedToolDefinitions.push(systemControlToolDefinitions.shortcut);
  }

  if (systemControlPolicy.allowLaunchControl) {
    selectedToolDefinitions.push(systemControlToolDefinitions.launch);
  }

  if (systemControlPolicy.allowCloseControl) {
    selectedToolDefinitions.push(systemControlToolDefinitions.close);
  }

  if (systemControlPolicy.allowWindowSwitching) {
    selectedToolDefinitions.push(systemControlToolDefinitions.switchWindow);
  }

  if (systemControlPolicy.allowFileSearch || systemControlPolicy.allowLaunchControl) {
    selectedToolDefinitions.push(systemControlToolDefinitions.fileSearch);
  }

  return selectedToolDefinitions;
}
