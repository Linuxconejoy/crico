import { buildAgentToolDefinitions } from "../shared/agentToolDefinitions.js";
import { deriveSystemControlPolicy } from "../shared/systemControlPolicy.js";
import {
  buildAppContextSummary,
  buildContextAwareInstruction,
  buildPersistentMemorySummary,
  buildRecentVisualHistorySummary
} from "./contextSummaries.js";

const maxAgentToolIterations = 10;
const postActionObservationDelayMilliseconds = 450;
const observationChangingToolNames = new Set([
  "control_mouse",
  "drag_mouse",
  "type_text",
  "keyboard_shortcut",
  "open_system_target",
  "close_application",
  "switch_window",
  "open_path",
  "run_command"
]);

export async function runAgentConversation({
  model,
  workerBaseUrl,
  userPrompt,
  previousUserPrompt,
  requestSource,
  permissiveDevModeEnabled,
  screenCaptureMode,
  screenCaptures,
  conversationHistory,
  persistentMemory,
  appContext,
  isContextAwareModeEnabled,
  onStatusUpdate
}) {
  const systemControlPolicy = deriveSystemControlPolicy({
    requestSource,
    userPrompt,
    previousUserPrompt,
    permissiveDevModeEnabled
  });
  let currentScreenCaptures = Array.isArray(screenCaptures) ? screenCaptures : [];
  let currentAppContext = appContext || null;
  const messages = buildAgentMessages({
    userPrompt,
    previousUserPrompt,
    screenCaptures: currentScreenCaptures,
    conversationHistory,
    persistentMemory,
    appContext: currentAppContext,
    systemControlPolicy
  });
  const systemPrompt = buildAgentSystemPrompt({
    persistentMemory,
    appContext: currentAppContext,
    isContextAwareModeEnabled,
    systemControlPolicy
  });
  const toolDefinitions = buildAgentToolDefinitions(systemControlPolicy);

  for (let iteration = 0; iteration < maxAgentToolIterations; iteration += 1) {
    onStatusUpdate?.(`agent step ${iteration + 1}`);

    const completion = await window.clicky.completeChat({
      workerBaseUrl,
      requestBody: {
        model,
        max_tokens: 1400,
        system: systemPrompt,
        tools: toolDefinitions,
        messages
      }
    });

    const assistantContent = Array.isArray(completion.content) ? completion.content : [];
    messages.push({
      role: "assistant",
      content: assistantContent
    });

    const toolUseBlocks = assistantContent.filter((contentBlock) => contentBlock.type === "tool_use");
    if (toolUseBlocks.length === 0) {
      const finalText = assistantContent
        .filter((contentBlock) => contentBlock.type === "text")
        .map((contentBlock) => contentBlock.text)
        .join("\n")
        .trim();

      if (!finalText) {
        throw new Error("Agent mode finished without a spoken answer.");
      }

      return finalText;
    }

    const toolResultContentBlocks = [];
    for (let toolIndex = 0; toolIndex < toolUseBlocks.length; toolIndex += 1) {
      const toolUseBlock = toolUseBlocks[toolIndex];
      if (toolIndex > 0) {
        toolResultContentBlocks.push({
          type: "tool_result",
          tool_use_id: toolUseBlock.id,
          is_error: true,
          content: JSON.stringify(buildDeferredToolResult(toolUseBlock.name), null, 2)
        });
        continue;
      }

      onStatusUpdate?.(`using ${toolUseBlock.name}`);
      const { toolResult, refreshedObservation } = await executeAgentToolStep({
        toolUseBlock,
        requestSource,
        userPrompt,
        previousUserPrompt,
        permissiveDevModeEnabled,
        screenCaptureMode,
        onStatusUpdate
      });

      toolResultContentBlocks.push({
        type: "tool_result",
        tool_use_id: toolUseBlock.id,
        is_error: toolResult?.ok === false,
        content: JSON.stringify(toolResult, null, 2)
      });

      if (refreshedObservation) {
        currentScreenCaptures = refreshedObservation.screenCaptures;
        currentAppContext = refreshedObservation.appContext;
        toolResultContentBlocks.push(...buildObservationUpdateContentBlocks({
          screenCaptures: currentScreenCaptures,
          appContext: currentAppContext,
          heading: `updated observation after ${toolUseBlock.name}:`
        }));
      }
    }

    messages.push({
      role: "user",
      content: toolResultContentBlocks
    });
  }

  throw new Error("Agent mode hit its tool limit before it could finish.");
}

async function executeAgentToolStep({
  toolUseBlock,
  requestSource,
  userPrompt,
  previousUserPrompt,
  permissiveDevModeEnabled,
  screenCaptureMode,
  onStatusUpdate
}) {
  if (toolUseBlock.name === "refresh_screen") {
    onStatusUpdate?.("refreshing screen");
    const refreshedObservation = await captureFreshObservation(screenCaptureMode);
    return {
      toolResult: {
        ok: true,
        refreshed: true,
        screenCount: refreshedObservation.screenCaptures.length,
        appContext: refreshedObservation.appContext
      },
      refreshedObservation
    };
  }

  const toolResult = await window.clicky.runAgentTool({
    name: toolUseBlock.name,
    input: toolUseBlock.input || {},
    requestContext: {
      requestSource,
      userPrompt,
      previousUserPrompt,
      permissiveDevModeEnabled
    }
  });

  if (!shouldRefreshObservationAfterTool(toolUseBlock.name, toolResult)) {
    return {
      toolResult,
      refreshedObservation: null
    };
  }

  onStatusUpdate?.("re-checking screen");
  const refreshedObservation = await captureFreshObservation(
    screenCaptureMode,
    postActionObservationDelayMilliseconds
  );

  return {
    toolResult,
    refreshedObservation
  };
}

export function buildAgentMessages({
  userPrompt,
  previousUserPrompt,
  screenCaptures,
  conversationHistory,
  persistentMemory,
  appContext,
  systemControlPolicy
}) {
  const messages = [];

  for (const historyEntry of getAgentConversationHistory(conversationHistory, systemControlPolicy)) {
    messages.push({
      role: "user",
      content: historyEntry.userTranscript
    });
    messages.push({
      role: "assistant",
      content: historyEntry.assistantResponse
    });
  }

  const contentBlocks = buildScreenCaptureContentBlocks(screenCaptures);
  const retryContextInstruction = buildRetryContextInstruction({
    userPrompt,
    previousUserPrompt,
    systemControlPolicy
  });

  contentBlocks.push({
    type: "text",
    text: `
persistent memory:
${buildPersistentMemorySummary(persistentMemory)}

recent visual history:
${buildRecentVisualHistorySummary(persistentMemory)}

current focused app:
${buildAppContextSummary(appContext)}

${retryContextInstruction ? `retry context:
${retryContextInstruction}

` : ""}user request:
${userPrompt}

    `.trim()
  });

  messages.push({
    role: "user",
    content: contentBlocks
  });

  return messages;
}

export function getAgentConversationHistory(conversationHistory, systemControlPolicy) {
  const normalizedHistory = Array.isArray(conversationHistory) ? conversationHistory : [];
  if (!systemControlPolicy?.isContinuationRequest) {
    return normalizedHistory.slice(-6);
  }

  return normalizedHistory.slice(-7, -1);
}

export function buildRetryContextInstruction({
  userPrompt,
  previousUserPrompt,
  systemControlPolicy
}) {
  if (!systemControlPolicy?.isContinuationRequest) {
    return "";
  }

  return [
    "the user is asking you to try again.",
    previousUserPrompt ? `their previous goal was: ${previousUserPrompt}` : "",
    `their new retry prompt is: ${userPrompt}`,
    "reassess from the latest screenshots and tool output.",
    "treat prior assistant claims as untrusted unless they are visible or re-verified right now.",
    "do not invent hidden prerequisites like a burp rest api, port 1337, localhost service, plugin api, or extension."
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildScreenCaptureContentBlocks(screenCaptures) {
  const contentBlocks = [];

  for (const screenCapture of screenCaptures || []) {
    contentBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: screenCapture.mediaType,
        data: screenCapture.imageBase64
      }
    });
    contentBlocks.push({
      type: "text",
      text: `${screenCapture.label} (image dimensions: ${screenCapture.screenshotWidthInPixels}x${screenCapture.screenshotHeightInPixels} pixels, display bounds: x=${screenCapture.displayBounds?.x ?? 0}, y=${screenCapture.displayBounds?.y ?? 0}, width=${screenCapture.displayBounds?.width ?? 0}, height=${screenCapture.displayBounds?.height ?? 0})`
    });
  }

  return contentBlocks;
}

export function buildObservationUpdateContentBlocks({
  screenCaptures,
  appContext,
  heading
}) {
  return [
    {
      type: "text",
      text: `${heading}\ncurrent focused app:\n${buildAppContextSummary(appContext)}`
    },
    ...buildScreenCaptureContentBlocks(screenCaptures)
  ];
}

export function shouldRefreshObservationAfterTool(toolName, toolResult) {
  if (!toolResult?.ok) {
    return false;
  }

  return observationChangingToolNames.has(String(toolName || "").trim());
}

function buildDeferredToolResult(toolName) {
  return {
    ok: false,
    deferred: true,
    toolName,
    error: "Clicky executes one tool step at a time in agent mode so it can re-observe the screen before continuing. Re-issue this action on the next turn if it is still needed."
  };
}

async function captureFreshObservation(screenCaptureMode, delayMilliseconds = 0) {
  if (delayMilliseconds > 0) {
    await wait(delayMilliseconds);
  }

  const [screenCaptures, appContext] = await Promise.all([
    window.clicky.captureScreens({ mode: screenCaptureMode || "cursor-display" }),
    window.clicky.getCurrentAppContext()
  ]);

  return {
    screenCaptures: Array.isArray(screenCaptures) ? screenCaptures : [],
    appContext: appContext || null
  };
}

function wait(delayMilliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMilliseconds);
  });
}

function buildAgentSystemPrompt({
  persistentMemory,
  appContext,
  isContextAwareModeEnabled,
  systemControlPolicy
}) {
  const preferredLanguage = persistentMemory?.profile?.preferredLanguage || "en";
  const systemControlStatus = systemControlPolicy.isSystemControlAllowed
    ? `system control is enabled for this request because ${
      systemControlPolicy.isPermissiveDevModeEnabled
        ? "permissive dev mode is on for this agent session"
        : `the user explicitly asked by voice${systemControlPolicy.isHandsOnAssistanceRequest ? " for hands-on help inside the current app" : ""}`
    }. allowed control categories: ${systemControlPolicy.requestedCapabilities.join(", ")}.`
    : "system control is disabled for this request. do not try to click, type, or open apps unless a future voice request explicitly asks for it.";
  const autonomyModeExplanation = {
    safe: "safe mode is active. confirm every critical step mentally and prefer smaller, reversible actions.",
    standard: "standard mode is active. proceed step by step, but stay conservative around risky actions.",
    auto: "automatic mode is active. you may complete reversible UI flows end to end without pausing for confirmation, but still avoid destructive or irreversible actions unless the user explicitly asked for them."
  }[systemControlPolicy.autonomyMode || "standard"];

  return `
you are clicky running as the universal system control agent, or usca. you can see the user's full screen state, understand interfaces, and use local tools to interact with windows apps like a human operator.

mission:
- observe the latest screenshots carefully
- understand the current interface and the user's goal
- choose the next best action
- execute it with precision
- re-evaluate after every action until the task is complete

usca capabilities:
- visual understanding of any interface that appears in the screenshots
- local workspace inspection and code/file edits
- system commands
- mouse movement, clicks, drags, text entry, keyboard shortcuts, app launching, window switching, and app closing when enabled for this request

core rules:
- respond in the user's preferred language when it is known. right now that is: ${preferredLanguage}.
- use tools whenever the user is clearly asking you to act on the local machine, inspect local code, open a path, run a command, automate a UI, or edit a file.
- when the user asks for help inside a visible application, prefer hands-on execution. if you can safely do the work yourself with tools, do it instead of stopping at an explanation.
- keep tool use tight and intentional. before each action, compare the visible screen state to the user's goal and choose the smallest effective next step.
- workspace access is approved inside d:\\developer and any inferred active workspace folder under it. when permissive dev mode is enabled, that expands to non-protected local paths outside windows, program files, browser profiles, and secret stores.
- opening a path, writing a file, or running a system command may require human approval through the panel depending on the current autonomy mode. in permissive dev mode those approvals are disabled.
- use run_command for concrete local steps like git, npm, node, python, rg, or read-only powershell inspection commands. in permissive dev mode you may also use other direct non-shell commands when they are the clearest way to complete the task.
- if system control tools are available, use them only when the user asked for direct help on the machine in this request. permissive dev mode also allows this from manual prompts.
- if the focused app appears to be running through ubuntu or wsl on windows, still treat it as a normal visible desktop ui for mouse, keyboard, and screenshot-based reasoning. do not assume a localhost service, plugin api, or windows-native menu layout unless the screen or tool output clearly shows that integration exists.
- for visible security and desktop tools like burp suite, repeater, photoshop, terminals, browsers, and scanners, work from the interface you can currently see before you assume any hidden automation hook exists.
- never tell the user to enable burp rest api, port 1337, or a similar localhost prerequisite unless the user explicitly asked for api-based automation and the screen or verified tool output shows that integration.
- if the user says try again, retry, otra vez, or de nuevo, re-evaluate from scratch using the latest observation and correct any earlier bad assumption instead of repeating it.
- if the screen might have changed and you need a fresher view, call refresh_screen. after successful ui actions, clicky will usually give you updated screenshots automatically.
- for cursor actions, the screenshots include both image dimensions and the real display bounds, so convert screenshot coordinates into windows virtual-desktop coordinates before calling control_mouse or drag_mouse.
- never hallucinate ui elements. rely only on what is visible in the screenshots or on verifiable tool output.
- if the screen changes after an action, adapt dynamically instead of stubbornly repeating the same step.
- if a strategy fails, retry with a small adjustment, not with a risky leap.
- for close_application or anything that could discard work, only proceed when the user explicitly asked for that exact outcome.
- do not use destructive commands or write into protected system directories such as windows, program files, browser profile folders, or secret stores.
- after you finish the local action, answer conversationally in short spoken prose.
- keep your final answer lowercase, warm, and concise.
- if you are pointing at something visible on screen, append a point tag at the very end in the format [POINT:x,y:label] or [POINT:none].

system control status:
- ${systemControlStatus}
- autonomy mode: ${systemControlPolicy.autonomyMode}. ${autonomyModeExplanation}

operating loop:
1. observe the screenshots and current app context
2. infer what changed and what the user is trying to achieve
3. decide the next action that most safely advances the task
4. execute exactly one focused tool step, then inspect the refreshed state before deciding again
5. inspect the updated state and continue until complete

${buildContextAwareInstruction(appContext, isContextAwareModeEnabled)}
  `.trim();
}
