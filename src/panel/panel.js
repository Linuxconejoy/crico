import {
  companionVoiceResponseSystemPrompt,
  DEFAULT_MODEL,
  DEFAULT_WORKER_BASE_URL,
  MAX_CONVERSATION_HISTORY
} from "../shared/systemPrompt.js";
import { mapScreenshotPointToDisplay, parsePointingCoordinates, pickTargetCapture } from "../shared/pointing.js";
import { runAgentConversation } from "./agentLoop.js";
import { streamClaudeResponse, fetchTTSAudio } from "./clickyApi.js";
import { AssemblyAIStreamingSession } from "./assemblyAiStreamingSession.js";
import {
  buildAppContextSummary,
  buildContextAwareInstruction,
  buildPersistentMemorySummary,
  buildRecentVisualHistorySummary,
  buildVisualMomentSummary
} from "./contextSummaries.js";
import { getProfileCategories } from "../shared/persistentMemorySchema.js";
import { shouldUseAgentMode } from "../shared/agentModePolicy.js";
import { deriveSystemControlPolicy } from "../shared/systemControlPolicy.js";
import {
  buildGuidedWalkthroughSystemPrompt,
  getGuidedWalkthroughStep,
  normalizeGuidedWalkthroughPlan
} from "./guidedWalkthrough.js";

const transcriptOutput = document.querySelector("#transcript-output");
const responseOutput = document.querySelector("#response-output");
const statusBadge = document.querySelector("#status-badge");
const backendOnboardingCard = document.querySelector("#backend-onboarding-card");
const backendOnboardingBadge = document.querySelector("#backend-onboarding-badge");
const backendOnboardingLabel = document.querySelector("#backend-onboarding-label");
const backendOnboardingTitle = document.querySelector("#backend-onboarding-title");
const backendOnboardingCopy = document.querySelector("#backend-onboarding-copy");
const activeModelLabel = document.querySelector("#active-model-label");
const shortcutLabel = document.querySelector("#shortcut-label");
const shortcutModeNote = document.querySelector("#shortcut-mode-note");
const manualPromptInput = document.querySelector("#manual-prompt-input");
const workerUrlInput = document.querySelector("#worker-url-input");
const workerAuthHeaderNameInput = document.querySelector("#worker-auth-header-name-input");
const workerAuthHeaderValueInput = document.querySelector("#worker-auth-header-value-input");
const workerHealthSummary = document.querySelector("#worker-health-summary");
const workerHealthNote = document.querySelector("#worker-health-note");
const chatHealthStatus = document.querySelector("#chat-health-status");
const chatHealthDetail = document.querySelector("#chat-health-detail");
const ttsHealthStatus = document.querySelector("#tts-health-status");
const ttsHealthDetail = document.querySelector("#tts-health-detail");
const transcribeHealthStatus = document.querySelector("#transcribe-health-status");
const transcribeHealthDetail = document.querySelector("#transcribe-health-detail");
const modelSelect = document.querySelector("#model-select");
const screenCaptureModeSelect = document.querySelector("#screen-capture-mode-select");
const visualHistoryRetentionDaysInput = document.querySelector("#visual-history-retention-days-input");
const showClickyToggle = document.querySelector("#show-clicky-toggle");
const autoPlaySpeechToggle = document.querySelector("#auto-play-speech-toggle");
const agentModeToggle = document.querySelector("#agent-mode-toggle");
const permissiveDevModeToggle = document.querySelector("#permissive-dev-mode-toggle");
const guidedWalkthroughToggle = document.querySelector("#guided-walkthrough-toggle");
const contextAwareModeToggle = document.querySelector("#context-aware-mode-toggle");
const passiveVisualContextToggle = document.querySelector("#passive-visual-context-toggle");
const visualHistoryToggle = document.querySelector("#visual-history-toggle");
const autoTriggersToggle = document.querySelector("#auto-triggers-toggle");
const preferredLanguageInput = document.querySelector("#preferred-language-input");
const activeProjectsInput = document.querySelector("#active-projects-input");
const pendingIssuesInput = document.querySelector("#pending-issues-input");
const decisionsMadeInput = document.querySelector("#decisions-made-input");
const currentAppName = document.querySelector("#current-app-name");
const currentModeLabel = document.querySelector("#current-mode-label");
const currentWindowTitle = document.querySelector("#current-window-title");
const currentProjectHint = document.querySelector("#current-project-hint");
const passiveVisualStatusOutput = document.querySelector("#passive-visual-status-output");
const passiveVisualSummaryOutput = document.querySelector("#passive-visual-summary-output");
const proactiveSuggestionOutput = document.querySelector("#proactive-suggestion-output");
const visualHistoryList = document.querySelector("#visual-history-list");
const errorBanner = document.querySelector("#error-banner");
const versionLabel = document.querySelector("#version-label");
const sendManualPromptButton = document.querySelector("#send-manual-prompt-button");
const checkWorkerHealthButton = document.querySelector("#check-worker-health-button");
const saveSettingsButton = document.querySelector("#save-settings-button");
const saveMemoryButton = document.querySelector("#save-memory-button");
const resetMemoryProfileButton = document.querySelector("#reset-memory-profile-button");
const clearAppContextsButton = document.querySelector("#clear-app-contexts-button");
const clearVisualHistoryButton = document.querySelector("#clear-visual-history-button");
const clearAllMemoryButton = document.querySelector("#clear-all-memory-button");
const clearHistoryButton = document.querySelector("#clear-history-button");
const agentApprovalCard = document.querySelector("#agent-approval-card");
const agentApprovalBadge = document.querySelector("#agent-approval-badge");
const agentApprovalToolName = document.querySelector("#agent-approval-tool-name");
const agentApprovalTitle = document.querySelector("#agent-approval-title");
const agentApprovalSummary = document.querySelector("#agent-approval-summary");
const agentApprovalDetail = document.querySelector("#agent-approval-detail");
const agentApprovalPreview = document.querySelector("#agent-approval-preview");
const agentApprovalApproveButton = document.querySelector("#agent-approval-approve-button");
const agentApprovalDenyButton = document.querySelector("#agent-approval-deny-button");
const walkthroughCard = document.querySelector("#walkthrough-card");
const walkthroughProgressLabel = document.querySelector("#walkthrough-progress-label");
const walkthroughTitle = document.querySelector("#walkthrough-title");
const walkthroughStepTitle = document.querySelector("#walkthrough-step-title");
const walkthroughStepCopy = document.querySelector("#walkthrough-step-copy");
const walkthroughNote = document.querySelector("#walkthrough-note");
const walkthroughRepeatButton = document.querySelector("#walkthrough-repeat-button");
const walkthroughNextButton = document.querySelector("#walkthrough-next-button");
const walkthroughEndButton = document.querySelector("#walkthrough-end-button");

const backgroundObservationIntervalMilliseconds = 15000;
const stagnationThresholdMilliseconds = 8 * 60 * 1000;
const proactiveSuggestionCooldownMilliseconds = 12 * 60 * 1000;

const state = {
  config: {
    workerBaseUrl: DEFAULT_WORKER_BASE_URL,
    workerAuthHeaderName: "",
    workerAuthHeaderValue: "",
    selectedModel: DEFAULT_MODEL,
    screenCaptureMode: "cursor-display",
    visualHistoryRetentionDays: 14,
    showClickyWhenIdle: true,
    autoPlaySpeech: true,
    agentModeEnabled: false,
    permissiveDevModeEnabled: false,
    guidedWalkthroughEnabled: false,
    contextAwareModeEnabled: true,
    passiveVisualContextEnabled: false,
    visualHistoryEnabled: false,
    autoTriggersEnabled: false
  },
  persistentMemory: {
    profile: {
      preferredLanguage: "en",
      categories: {
        activeProjects: [],
        pendingIssues: [],
        decisionsMade: []
      }
    },
    recentAppContexts: [],
    visualHistory: []
  },
  appContext: null,
  conversationHistory: loadConversationHistory(),
  currentTranscript: "",
  currentResponse: "",
  currentAudio: null,
  activeTranscriptionSession: null,
  activeChatRequestId: null,
  pendingAgentApproval: null,
  resolvePendingAgentApproval: null,
  walkthroughSession: null,
  isRecording: false,
  isProcessing: false,
  isStartingRecording: false,
  shouldStopAfterStart: false,
  shortcutMode: {
    label: "Ctrl + Alt",
    mode: "native",
    note: "Hold to talk globally."
  },
  workerHealth: createSetupRequiredWorkerHealthState(),
  passiveVisualContext: {
    changeCount: 0,
    lastChangedAt: 0,
    summary: "",
    status: "Passive visual context is off."
  },
  latestProactiveSuggestion: "",
  proactiveWatcher: {
    intervalId: null,
    lastFingerprint: "",
    lastAppSignature: "",
    lastChangedAt: Date.now(),
    lastInterventionAt: 0,
    lastInterventionFingerprint: ""
  }
};

initialize();

async function initialize() {
  try {
    const [config, appVersion, persistentMemory, appContext] = await Promise.all([
      window.clicky.getConfig(),
      window.clicky.getAppVersion(),
      window.clicky.getPersistentMemory(),
      window.clicky.getCurrentAppContext()
    ]);

    state.config = {
      ...state.config,
      ...config
    };
    state.persistentMemory = persistentMemory || state.persistentMemory;
    state.appContext = appContext || null;

    workerUrlInput.value = state.config.workerBaseUrl;
    workerAuthHeaderNameInput.value = state.config.workerAuthHeaderName || "";
    workerAuthHeaderValueInput.value = state.config.workerAuthHeaderValue || "";
    modelSelect.value = state.config.selectedModel;
    screenCaptureModeSelect.value = state.config.screenCaptureMode || "cursor-display";
    visualHistoryRetentionDaysInput.value = String(state.config.visualHistoryRetentionDays || 14);
    showClickyToggle.checked = state.config.showClickyWhenIdle;
    autoPlaySpeechToggle.checked = state.config.autoPlaySpeech;
    agentModeToggle.checked = state.config.agentModeEnabled;
    permissiveDevModeToggle.checked = state.config.permissiveDevModeEnabled;
    guidedWalkthroughToggle.checked = state.config.guidedWalkthroughEnabled;
    contextAwareModeToggle.checked = state.config.contextAwareModeEnabled;
    passiveVisualContextToggle.checked = state.config.passiveVisualContextEnabled;
    visualHistoryToggle.checked = state.config.visualHistoryEnabled;
    autoTriggersToggle.checked = state.config.autoTriggersEnabled;
    versionLabel.textContent = `v${appVersion}`;

    bindEvents();
    renderPersistentMemory();
    renderAppContext();
    renderPassiveVisualContext();
    renderVisualHistory();
    resetWorkerHealthForCandidate(state.config.workerBaseUrl);
    renderConversationFromHistory();
    renderAgentApproval();
    renderWalkthroughCard();
    renderWorkerHealth();
    renderBackendReadiness();
    applyIdleOverlayState();
    startProactiveWatcher();

    if (isWorkerUrlConfigured(state.config.workerBaseUrl)) {
      runWorkerHealthCheck({ workerBaseUrl: state.config.workerBaseUrl }).catch(() => {});
    }
  } catch (error) {
    showError(error.message);
  }
}

function bindEvents() {
  sendManualPromptButton.addEventListener("click", () => {
    const prompt = manualPromptInput.value.trim();
    if (!prompt) {
      showError("Write a prompt before sending.");
      return;
    }

    runManualPrompt(prompt).catch((error) => showError(error.message));
  });

  saveSettingsButton.addEventListener("click", async () => {
    try {
      const previousPassiveVisualContextEnabled = state.config.passiveVisualContextEnabled;
      const nextWorkerBaseUrl = getWorkerUrlCandidateFromInput();
      const workerUrlValidation = validateWorkerUrlSyntax(nextWorkerBaseUrl);
      const workerHeaderValidation = validateWorkerAuthHeaderInputs(
        workerAuthHeaderNameInput.value,
        workerAuthHeaderValueInput.value
      );
      const visualHistoryRetentionDaysValidation = validateVisualHistoryRetentionDays(
        visualHistoryRetentionDaysInput.value
      );

      if (!workerUrlValidation.ok) {
        showError(workerUrlValidation.message);
        focusWorkerSettings();
        return;
      }

      if (!workerHeaderValidation.ok) {
        showError(workerHeaderValidation.message);
        workerAuthHeaderNameInput.focus();
        return;
      }

      if (!visualHistoryRetentionDaysValidation.ok) {
        showError(visualHistoryRetentionDaysValidation.message);
        visualHistoryRetentionDaysInput.focus();
        visualHistoryRetentionDaysInput.select();
        return;
      }

      state.config = await window.clicky.saveConfig({
        workerBaseUrl: nextWorkerBaseUrl,
        workerAuthHeaderName: workerAuthHeaderNameInput.value.trim(),
        workerAuthHeaderValue: workerAuthHeaderValueInput.value.trim(),
        selectedModel: modelSelect.value,
        screenCaptureMode: screenCaptureModeSelect.value,
        visualHistoryRetentionDays: visualHistoryRetentionDaysValidation.value,
        showClickyWhenIdle: showClickyToggle.checked,
        autoPlaySpeech: autoPlaySpeechToggle.checked,
        agentModeEnabled: agentModeToggle.checked,
        permissiveDevModeEnabled: permissiveDevModeToggle.checked,
        guidedWalkthroughEnabled: guidedWalkthroughToggle.checked,
        contextAwareModeEnabled: contextAwareModeToggle.checked,
        passiveVisualContextEnabled: passiveVisualContextToggle.checked,
        visualHistoryEnabled: visualHistoryToggle.checked,
        autoTriggersEnabled: autoTriggersToggle.checked
      });

      if (!previousPassiveVisualContextEnabled && state.config.passiveVisualContextEnabled) {
        state.passiveVisualContext = {
          changeCount: 0,
          lastChangedAt: 0,
          summary: "",
          status: "watching"
        };
        state.proactiveWatcher.lastFingerprint = "";
        state.proactiveWatcher.lastAppSignature = "";
      }

      state.persistentMemory = await window.clicky.getPersistentMemory();
      workerUrlInput.value = state.config.workerBaseUrl;
      workerAuthHeaderNameInput.value = state.config.workerAuthHeaderName || "";
      workerAuthHeaderValueInput.value = state.config.workerAuthHeaderValue || "";
      activeModelLabel.textContent = state.config.selectedModel;
      screenCaptureModeSelect.value = state.config.screenCaptureMode || "cursor-display";
      visualHistoryRetentionDaysInput.value = String(state.config.visualHistoryRetentionDays || 14);
      guidedWalkthroughToggle.checked = state.config.guidedWalkthroughEnabled;
      permissiveDevModeToggle.checked = state.config.permissiveDevModeEnabled;
      passiveVisualContextToggle.checked = state.config.passiveVisualContextEnabled;
      applyIdleOverlayState();
      clearError();
      resetWorkerHealthForCandidate(state.config.workerBaseUrl);
      renderPersistentMemory();
      renderPassiveVisualContext();
      renderVisualHistory();
      renderConversationFromHistory();
      renderWorkerHealth();
      renderBackendReadiness();

      if (isWorkerUrlConfigured(state.config.workerBaseUrl)) {
        await runWorkerHealthCheck({
          workerBaseUrl: state.config.workerBaseUrl,
          userInitiated: true
        });
      }
    } catch (error) {
      showError(error.message);
    }
  });

  checkWorkerHealthButton.addEventListener("click", () => {
    const currentWorkerBaseUrl = getWorkerUrlCandidateFromInput();

    if (hasUnsavedWorkerSecuritySettings()) {
      showError("Save Settings first so the backend test can include your current auth header values.");
      focusWorkerSettings();
      return;
    }

    runWorkerHealthCheck({
      workerBaseUrl: currentWorkerBaseUrl,
      userInitiated: true
    }).catch((error) => showError(error.message));
  });

  workerUrlInput.addEventListener("input", () => {
    resetWorkerHealthForCandidate(getWorkerUrlCandidateFromInput());
    renderConversationFromHistory();
    renderWorkerHealth();
    renderBackendReadiness();
  });

  workerAuthHeaderNameInput.addEventListener("input", () => {
    renderBackendReadiness();
  });

  workerAuthHeaderValueInput.addEventListener("input", () => {
    renderBackendReadiness();
  });

  saveMemoryButton.addEventListener("click", async () => {
    try {
      state.persistentMemory = await window.clicky.savePersistentProfile({
        preferredLanguage: preferredLanguageInput.value.trim(),
        activeProjects: parseCommaOrLineSeparatedValues(activeProjectsInput.value),
        pendingIssues: parseCommaOrLineSeparatedValues(pendingIssuesInput.value),
        decisionsMade: parseCommaOrLineSeparatedValues(decisionsMadeInput.value)
      });
      renderPersistentMemory();
      clearError();
    } catch (error) {
      showError(error.message);
    }
  });

  resetMemoryProfileButton.addEventListener("click", async () => {
    if (!window.confirm("Reset the saved profile fields to their defaults on this machine?")) {
      return;
    }

    try {
      state.persistentMemory = await window.clicky.resetPersistentProfile();
      renderPersistentMemory();
      clearError();
    } catch (error) {
      showError(error.message);
    }
  });

  clearAppContextsButton.addEventListener("click", async () => {
    if (!window.confirm("Delete the saved app context snapshot history?")) {
      return;
    }

    try {
      state.persistentMemory = await window.clicky.clearRecentAppContexts();
      renderPersistentMemory();
      clearError();
    } catch (error) {
      showError(error.message);
    }
  });

  clearVisualHistoryButton.addEventListener("click", async () => {
    if (!window.confirm("Delete all saved visual history screenshots and summaries?")) {
      return;
    }

    try {
      state.persistentMemory = await window.clicky.clearVisualHistory();
      renderVisualHistory();
      clearError();
    } catch (error) {
      showError(error.message);
    }
  });

  clearAllMemoryButton.addEventListener("click", async () => {
    if (!window.confirm("Delete all saved profile memory, app contexts, and visual history on this machine?")) {
      return;
    }

    try {
      state.persistentMemory = await window.clicky.clearAllPersistentMemory();
      renderPersistentMemory();
      renderVisualHistory();
      clearError();
    } catch (error) {
      showError(error.message);
    }
  });

  agentApprovalApproveButton.addEventListener("click", () => {
    resolvePendingAgentApproval({
      approved: true
    }).catch((error) => showError(error.message));
  });

  agentApprovalDenyButton.addEventListener("click", () => {
    resolvePendingAgentApproval({
      approved: false,
      reason: "User denied approval for this agent action."
    }).catch((error) => showError(error.message));
  });

  walkthroughRepeatButton.addEventListener("click", () => {
    presentCurrentWalkthroughStep({ speak: state.config.autoPlaySpeech }).catch((error) => showError(error.message));
  });

  walkthroughNextButton.addEventListener("click", () => {
    advanceWalkthroughStep().catch((error) => showError(error.message));
  });

  walkthroughEndButton.addEventListener("click", () => {
    endWalkthroughSession();
  });

  clearHistoryButton.addEventListener("click", () => {
    state.conversationHistory = [];
    persistConversationHistory();
    renderConversationFromHistory();
  });

  window.clicky.onPushToTalkStart(() => {
    startVoiceCapture().catch((error) => showError(error.message));
  });

  window.clicky.onPushToTalkStop(() => {
    stopVoiceCaptureAndSend().catch((error) => showError(error.message));
  });

  window.clicky.onShortcutMode((payload) => {
    state.shortcutMode = payload;
    shortcutLabel.textContent = payload.label;
    shortcutModeNote.textContent = payload.note;
  });

  window.clicky.onAppContextChanged((appContext) => {
    state.appContext = appContext;
    renderAppContext();
    window.clicky.getPersistentMemory()
      .then((persistentMemory) => {
        state.persistentMemory = persistentMemory;
        renderPersistentMemory();
        renderVisualHistory();
      })
      .catch(() => {});
  });

  window.clicky.onAgentApprovalRequested((approvalRequest) => {
    state.pendingAgentApproval = approvalRequest;
    renderAgentApproval();
    renderStatus("approval");
    responseOutput.textContent = approvalRequest.summary || "approval needed for the next agent action.";
  });
}

async function startVoiceCapture() {
  if (state.isRecording || state.isStartingRecording || state.isProcessing) {
    return;
  }

  if (!ensureWorkerConfiguredForUse()) {
    return;
  }

  clearError();
  cancelActiveAudio();
  abortActiveChatIfNeeded();

  state.currentTranscript = "";
  state.currentResponse = "";
  state.isRecording = true;
  state.isProcessing = false;
  state.isStartingRecording = true;
  state.shouldStopAfterStart = false;
  renderStatus("listening");
  responseOutput.textContent = getListeningInstructionText();
  transcriptOutput.textContent = "speak now";

  const transcriptionSession = new AssemblyAIStreamingSession({
    workerBaseUrl: state.config.workerBaseUrl,
    onTranscriptUpdate: (transcript) => {
      state.currentTranscript = transcript;
      transcriptOutput.textContent = transcript || "listening...";
    }
  });

  state.activeTranscriptionSession = transcriptionSession;
  try {
    await transcriptionSession.start();
  } catch (error) {
    state.isStartingRecording = false;
    throw error;
  }

  state.isStartingRecording = false;

  if (!state.isRecording && state.shouldStopAfterStart) {
    state.shouldStopAfterStart = false;
    await stopVoiceCaptureAndSend();
    return;
  }

  await window.clicky.setOverlayState({
    visible: true,
    mode: "listening",
    statusText: "listening",
    message: getListeningInstructionText()
  });
}

async function stopVoiceCaptureAndSend() {
  if (state.isStartingRecording) {
    state.isRecording = false;
    state.shouldStopAfterStart = true;
    return;
  }

  if (!state.isRecording && !state.activeTranscriptionSession) {
    return;
  }

  state.isRecording = false;
  state.isStartingRecording = false;
  state.shouldStopAfterStart = false;

  const activeTranscriptionSession = state.activeTranscriptionSession;
  state.activeTranscriptionSession = null;
  const transcript = activeTranscriptionSession
    ? await activeTranscriptionSession.stopAndFinalize()
    : state.currentTranscript.trim();

  if (!transcript) {
    renderStatus("ready");
    transcriptOutput.textContent = "I did not catch that.";
    responseOutput.textContent = "Hold Ctrl + Alt to try again, or use the manual prompt below.";
    applyIdleOverlayState();
    return;
  }

  state.currentTranscript = transcript;
  transcriptOutput.textContent = transcript;
  await sendPromptWithScreenshots(transcript, "voice-session");
}

async function runManualPrompt(prompt) {
  if (!ensureWorkerConfiguredForUse()) {
    return;
  }

  clearError();
  cancelActiveAudio();
  abortActiveChatIfNeeded();
  state.currentTranscript = prompt;
  state.currentResponse = "";
  transcriptOutput.textContent = prompt;
  manualPromptInput.value = "";
  await sendPromptWithScreenshots(prompt, "manual-session");
}

async function sendPromptWithScreenshots(prompt, source) {
  if (!ensureWorkerConfiguredForUse()) {
    return;
  }

  if (state.isProcessing) {
    showError("Clicky is still handling the previous request. Wait for it to finish before starting another one.");
    return;
  }

  const useAgentMode = shouldUseAgentMode(state.config);
  const previousUserPrompt = state.conversationHistory[state.conversationHistory.length - 1]?.userTranscript || "";
  const requestControlPolicy = deriveSystemControlPolicy({
    requestSource: source,
    userPrompt: prompt,
    previousUserPrompt,
    permissiveDevModeEnabled: state.config.permissiveDevModeEnabled
  });
  cancelPendingAgentApproval("A new request replaced the pending approval.");
  endWalkthroughSession({ preserveConversation: true, preserveOverlay: true });
  state.isProcessing = true;
  renderStatus("processing");
  responseOutput.textContent = useAgentMode
    ? "agent mode is inspecting your machine..."
    : state.config.guidedWalkthroughEnabled
      ? "capturing your screens and building a walkthrough..."
      : "capturing your screens and thinking...";
  await window.clicky.setOverlayState({
    visible: true,
    mode: "processing",
    statusText: "thinking",
    message: ""
  });

  const screenCaptures = await window.clicky.captureScreens({
    mode: state.config.screenCaptureMode || "cursor-display"
  });
  await updateProactiveWatcherBaseline(screenCaptures);
  const requestId = crypto.randomUUID();
  state.activeChatRequestId = requestId;

  let fullResponseText = "";

  try {
    if (useAgentMode) {
      fullResponseText = await runAgentConversation({
        model: state.config.selectedModel,
        workerBaseUrl: state.config.workerBaseUrl,
        userPrompt: prompt,
        previousUserPrompt,
        requestSource: source,
        permissiveDevModeEnabled: state.config.permissiveDevModeEnabled,
        screenCaptureMode: state.config.screenCaptureMode || "cursor-display",
        screenCaptures,
        conversationHistory: state.conversationHistory,
        persistentMemory: state.persistentMemory,
        appContext: state.appContext,
        isContextAwareModeEnabled: state.config.contextAwareModeEnabled,
        onStatusUpdate: async (statusText) => {
          responseOutput.textContent = `${statusText}...`;
          await window.clicky.setOverlayState({
            visible: true,
            mode: "processing",
            statusText: "agent",
            message: statusText
          });
        }
      });
    } else if (state.config.guidedWalkthroughEnabled) {
      fullResponseText = await startGuidedWalkthrough({
        prompt,
        screenCaptures
      });
    } else {
      const requestBody = buildClaudeRequestBody({
        model: state.config.selectedModel,
        userPrompt: prompt,
        previousUserPrompt,
        systemControlPolicy: requestControlPolicy,
        screenCaptures,
        conversationHistory: state.conversationHistory
      });

      fullResponseText = await streamClaudeResponse({
        requestId,
        workerBaseUrl: state.config.workerBaseUrl,
        requestBody,
        onTextChunk: (streamedText) => {
          state.currentResponse = streamedText;
          responseOutput.textContent = streamedText || "thinking...";
        }
      });
    }
  } finally {
    if (state.activeChatRequestId === requestId) {
      state.activeChatRequestId = null;
    }
  }

  if (state.config.guidedWalkthroughEnabled && !useAgentMode) {
    state.isProcessing = false;
    renderStatus("ready");
    return;
  }

  const parseResult = parsePointingCoordinates(fullResponseText);
  const spokenText = parseResult.spokenText || "I had a blank moment there.";
  state.currentResponse = spokenText;
  responseOutput.textContent = spokenText;
  appendConversationHistory(prompt, spokenText);

  const targetCapture = pickTargetCapture(screenCaptures, parseResult.screenNumber);
  const targetPoint = parseResult.coordinate
    ? mapScreenshotPointToDisplay(parseResult.coordinate, targetCapture)
    : null;

  await window.clicky.setOverlayState({
    visible: true,
    mode: "responding",
    statusText: "responding",
    message: spokenText,
    showClickyWhenIdle: state.config.showClickyWhenIdle
  });

  if (targetPoint) {
    await window.clicky.showOverlayPoint({
      x: targetPoint.x,
      y: targetPoint.y,
      label: parseResult.elementLabel || "here",
      spokenText
    });
  } else {
    await window.clicky.clearOverlayPoint();
  }

  if (state.config.autoPlaySpeech) {
    await playSpeech(spokenText);
  }

  if (state.config.visualHistoryEnabled) {
    await persistVisualMoment({
      source,
      userPrompt: prompt,
      assistantResponse: spokenText,
      appContext: state.appContext,
      screenCaptures
    });
  }

  state.isProcessing = false;
  renderStatus("ready");
  applyIdleOverlayState();
}

async function startGuidedWalkthrough({ prompt, screenCaptures }) {
  const completion = await window.clicky.completeChat({
    workerBaseUrl: state.config.workerBaseUrl,
    requestBody: buildGuidedWalkthroughRequestBody({
      model: state.config.selectedModel,
      userPrompt: prompt,
      screenCaptures
    })
  });

  const assistantText = extractCompletionText(completion);
  const walkthroughPlan = normalizeGuidedWalkthroughPlan(parseJsonResponseText(assistantText));

  state.walkthroughSession = {
    title: walkthroughPlan.title,
    spokenIntro: walkthroughPlan.spokenIntro,
    steps: walkthroughPlan.steps,
    currentStepIndex: 0,
    sourcePrompt: prompt,
    screenCaptures
  };

  renderWalkthroughCard();
  await presentCurrentWalkthroughStep({
    speak: state.config.autoPlaySpeech,
    includeIntro: true
  });

  const currentStep = getGuidedWalkthroughStep(state.walkthroughSession);
  const currentStepSpokenText = parsePointingCoordinates(currentStep?.instruction || "").spokenText;
  appendConversationHistory(
    prompt,
    [walkthroughPlan.spokenIntro, currentStepSpokenText].filter(Boolean).join(" ").trim() || "guided walkthrough ready"
  );

  return currentStepSpokenText || "guided walkthrough ready";
}

function buildGuidedWalkthroughRequestBody({ model, userPrompt, screenCaptures }) {
  const contentBlocks = [];

  for (const capture of screenCaptures) {
    contentBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: capture.mediaType,
        data: capture.imageBase64
      }
    });
    contentBlocks.push({
      type: "text",
      text: `${capture.label} (image dimensions: ${capture.screenshotWidthInPixels}x${capture.screenshotHeightInPixels} pixels)`
    });
  }

  contentBlocks.push({
    type: "text",
    text: `
persistent memory:
${buildPersistentMemorySummary(state.persistentMemory)}

recent visual history:
${buildRecentVisualHistorySummary(state.persistentMemory)}

current app context:
${buildAppContextSummary(state.appContext)}

user request:
${userPrompt}
    `.trim()
  });

  return {
    model,
    max_tokens: 1400,
    system: buildGuidedWalkthroughSystemPrompt({
      preferredLanguage: state.persistentMemory?.profile?.preferredLanguage || "en",
      contextAwareInstruction: buildContextAwareInstruction(state.appContext, state.config.contextAwareModeEnabled)
    }),
    messages: [
      {
        role: "user",
        content: contentBlocks
      }
    ]
  };
}

async function presentCurrentWalkthroughStep({ speak = false, includeIntro = false } = {}) {
  const currentStep = getGuidedWalkthroughStep(state.walkthroughSession);
  if (!currentStep || !state.walkthroughSession) {
    return;
  }

  const parseResult = parsePointingCoordinates(currentStep.instruction);
  const spokenText = parseResult.spokenText || "focus on the next step on screen.";
  const spokenIntro = includeIntro ? state.walkthroughSession.spokenIntro : "";
  const speechText = [spokenIntro, spokenText].filter(Boolean).join(" ").trim();

  state.currentResponse = spokenText;
  responseOutput.textContent = spokenText;
  renderWalkthroughCard();

  const targetCapture = pickTargetCapture(state.walkthroughSession.screenCaptures, parseResult.screenNumber);
  const targetPoint = parseResult.coordinate
    ? mapScreenshotPointToDisplay(parseResult.coordinate, targetCapture)
    : null;

  await window.clicky.setOverlayState({
    visible: true,
    mode: "responding",
    statusText: "walkthrough",
    message: spokenText,
    showClickyWhenIdle: state.config.showClickyWhenIdle
  });

  if (targetPoint) {
    await window.clicky.showOverlayPoint({
      x: targetPoint.x,
      y: targetPoint.y,
      label: parseResult.elementLabel || currentStep.title || "step",
      spokenText
    });
  } else {
    await window.clicky.clearOverlayPoint();
  }

  if (speak && speechText) {
    await playSpeech(speechText);
  }
}

async function advanceWalkthroughStep() {
  if (!state.walkthroughSession) {
    return;
  }

  const nextIndex = state.walkthroughSession.currentStepIndex + 1;
  if (nextIndex >= state.walkthroughSession.steps.length) {
    endWalkthroughSession();
    responseOutput.textContent = "walkthrough complete. ask for another one whenever you want.";
    if (state.config.autoPlaySpeech) {
      await playSpeech("walkthrough complete. ask for another one whenever you want.");
    }
    return;
  }

  state.walkthroughSession.currentStepIndex = nextIndex;
  renderWalkthroughCard();
  await presentCurrentWalkthroughStep({
    speak: state.config.autoPlaySpeech
  });
}

function buildClaudeRequestBody({
  model,
  userPrompt,
  previousUserPrompt,
  systemControlPolicy,
  screenCaptures,
  conversationHistory
}) {
  const messages = [];
  const effectiveConversationHistory = systemControlPolicy?.isContinuationRequest
    ? conversationHistory.slice(0, -1)
    : conversationHistory;

  for (const entry of effectiveConversationHistory.slice(-6)) {
    messages.push({
      role: "user",
      content: entry.userTranscript
    });
    messages.push({
      role: "assistant",
      content: entry.assistantResponse
    });
  }

  const contentBlocks = [];
  for (const capture of screenCaptures) {
    contentBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: capture.mediaType,
        data: capture.imageBase64
      }
    });
    contentBlocks.push({
      type: "text",
      text: `${capture.label} (image dimensions: ${capture.screenshotWidthInPixels}x${capture.screenshotHeightInPixels} pixels)`
    });
  }

  contentBlocks.push({
    type: "text",
    text: `
persistent memory:
${buildPersistentMemorySummary(state.persistentMemory)}

recent visual history:
${buildRecentVisualHistorySummary(state.persistentMemory)}

current app context:
${buildAppContextSummary(state.appContext)}

${systemControlPolicy?.isContinuationRequest ? `retry context:
the user is asking you to try again.
their previous goal was: ${previousUserPrompt || "unknown"}.
reassess from the current screenshots before you trust any prior assistant claim.
do not invent hidden prerequisites like a burp rest api, port 1337, localhost service, plugin api, or extension.

` : ""}user prompt:
${userPrompt}
    `.trim()
  });

  messages.push({
    role: "user",
    content: contentBlocks
  });

  return {
    model,
    max_tokens: 1024,
    stream: true,
    system: buildConversationSystemPrompt(),
    messages
  };
}

function buildConversationSystemPrompt() {
  const preferredLanguage = state.persistentMemory?.profile?.preferredLanguage || "en";
  const contextAwareInstruction = buildContextAwareInstruction(
    state.appContext,
    state.config.contextAwareModeEnabled
  );

  return `
${companionVoiceResponseSystemPrompt}

extra rules:
- respond in the user's preferred language when it is known. right now that is: ${preferredLanguage}.
- you have persistent memory across sessions. trust the provided memory and visual history summaries when they are relevant.
- if the user is asking about local work they were doing days ago, use the visual history and accumulated context to reconnect the thread.
- when the request is about a visible app on screen, ground your answer in the visible ui first.
- do not claim the user needs a rest api, localhost port, plugin, extension, or hidden backend unless the screen, the user, or verified tool output clearly shows it.
- if the user asks you to try again, reassess from the current screenshots and correct yourself instead of repeating an earlier assumption.

${contextAwareInstruction}
  `.trim();
}

async function playSpeech(text) {
  cancelActiveAudio();

  const { mimeType, audioBase64 } = await fetchTTSAudio({
    workerBaseUrl: state.config.workerBaseUrl,
    text
  });

  const audioBlob = base64ToBlob(audioBase64, mimeType);
  const audioUrl = URL.createObjectURL(audioBlob);
  const audio = new Audio(audioUrl);

  state.currentAudio = audio;

  await new Promise((resolve, reject) => {
    audio.addEventListener("ended", () => {
      URL.revokeObjectURL(audioUrl);
      if (state.currentAudio === audio) {
        state.currentAudio = null;
      }
      resolve();
    }, { once: true });

    audio.addEventListener("error", () => {
      URL.revokeObjectURL(audioUrl);
      reject(new Error("Audio playback failed."));
    }, { once: true });

    audio.play().catch(reject);
  });
}

function cancelActiveAudio() {
  if (!state.currentAudio) {
    return;
  }

  state.currentAudio.pause();
  state.currentAudio.currentTime = 0;
  state.currentAudio = null;
}

function abortActiveChatIfNeeded() {
  if (!state.activeChatRequestId) {
    return;
  }

  window.clicky.abortChatStream(state.activeChatRequestId);
  state.activeChatRequestId = null;
}

function appendConversationHistory(userTranscript, assistantResponse) {
  state.conversationHistory.push({
    userTranscript,
    assistantResponse
  });

  if (state.conversationHistory.length > MAX_CONVERSATION_HISTORY) {
    state.conversationHistory = state.conversationHistory.slice(-MAX_CONVERSATION_HISTORY);
  }

  persistConversationHistory();
}

function persistConversationHistory() {
  window.localStorage.setItem("clicky-windows-history", JSON.stringify(state.conversationHistory));
}

function loadConversationHistory() {
  try {
    const savedHistory = JSON.parse(window.localStorage.getItem("clicky-windows-history") || "[]");
    return Array.isArray(savedHistory)
      ? savedHistory.slice(-MAX_CONVERSATION_HISTORY)
      : [];
  } catch {
    return [];
  }
}

function renderConversationFromHistory() {
  if (state.walkthroughSession) {
    const currentStep = getGuidedWalkthroughStep(state.walkthroughSession);
    transcriptOutput.textContent = state.walkthroughSession.sourcePrompt || "guided walkthrough";
    responseOutput.textContent = parsePointingCoordinates(currentStep?.instruction || "").spokenText || "guided walkthrough ready.";
    activeModelLabel.textContent = state.config.selectedModel;
    return;
  }

  if (state.pendingAgentApproval) {
    activeModelLabel.textContent = state.config.selectedModel;
    return;
  }

  const latestExchange = state.conversationHistory[state.conversationHistory.length - 1];

  if (latestExchange) {
    transcriptOutput.textContent = latestExchange.userTranscript;
    responseOutput.textContent = latestExchange.assistantResponse;
  } else if (!isWorkerUrlConfigured(state.config.workerBaseUrl)) {
    transcriptOutput.textContent = "Add your Worker URL in Settings before using push-to-talk or manual prompts.";
    responseOutput.textContent = "After that, save settings and test the backend so /chat, /tts, and /transcribe-token all show ready.";
  } else {
    transcriptOutput.textContent = "Hold Ctrl + Alt to talk, or send a manual prompt below.";
    responseOutput.textContent = state.workerHealth.overallStatus === "degraded"
      ? "The backend is configured, but one or more services still need attention. Review the health status in Settings."
      : state.workerHealth.overallStatus === "pending"
        ? "The backend URL is saved, but Clicky has not verified the required routes yet. Run a backend test in Settings first."
        : "I will stream the answer here, then speak it out loud if autoplay is enabled.";
  }

  activeModelLabel.textContent = state.config.selectedModel;
}

function renderAgentApproval() {
  const pendingAgentApproval = state.pendingAgentApproval;
  agentApprovalCard.hidden = !pendingAgentApproval;

  if (!pendingAgentApproval) {
    agentApprovalPreview.value = "";
    return;
  }

  agentApprovalBadge.textContent = pendingAgentApproval.toolName === "write_file"
    ? "write blocked"
    : "review action";
  agentApprovalToolName.textContent = pendingAgentApproval.toolName || "agent action";
  agentApprovalTitle.textContent = pendingAgentApproval.title || "approval needed";
  agentApprovalSummary.textContent = pendingAgentApproval.summary || "Clicky wants to perform a sensitive local action.";
  agentApprovalDetail.textContent = pendingAgentApproval.detail || "Review the request before allowing it.";
  agentApprovalPreview.value = pendingAgentApproval.preview || "";
  agentApprovalApproveButton.textContent = pendingAgentApproval.confirmLabel || "approve";
  agentApprovalDenyButton.textContent = pendingAgentApproval.denyLabel || "deny";
}

function renderWalkthroughCard() {
  const walkthroughSession = state.walkthroughSession;
  walkthroughCard.hidden = !walkthroughSession;

  if (!walkthroughSession) {
    return;
  }

  const currentStep = getGuidedWalkthroughStep(walkthroughSession);
  walkthroughProgressLabel.textContent = `step ${walkthroughSession.currentStepIndex + 1} of ${walkthroughSession.steps.length}`;
  walkthroughTitle.textContent = walkthroughSession.title || "guided walkthrough";
  walkthroughStepTitle.textContent = currentStep?.title || "current step";
  walkthroughStepCopy.textContent = parsePointingCoordinates(currentStep?.instruction || "").spokenText || "focus on the current action on screen.";
  walkthroughNote.textContent = walkthroughSession.spokenIntro
    ? `${walkthroughSession.spokenIntro} refresh the walkthrough if the screen changes a lot.`
    : "the plan is based on the screenshots from when the walkthrough started. refresh it if the screen changes a lot.";
  walkthroughNextButton.textContent = walkthroughSession.currentStepIndex >= walkthroughSession.steps.length - 1
    ? "finish"
    : "next step";
}

async function resolvePendingAgentApproval(decision) {
  if (!state.pendingAgentApproval) {
    return;
  }

  const pendingAgentApproval = state.pendingAgentApproval;
  state.pendingAgentApproval = null;
  renderAgentApproval();
  await window.clicky.submitAgentApprovalDecision({
    requestId: pendingAgentApproval.requestId,
    approved: Boolean(decision?.approved),
    reason: String(decision?.reason || "").trim()
  });

  if (state.isProcessing) {
    renderStatus("processing");
  } else {
    renderStatus("ready");
  }
}

function cancelPendingAgentApproval(reason = "The pending approval is no longer valid.") {
  if (!state.pendingAgentApproval) {
    return;
  }

  const pendingAgentApproval = state.pendingAgentApproval;
  state.pendingAgentApproval = null;
  renderAgentApproval();
  window.clicky.submitAgentApprovalDecision({
    requestId: pendingAgentApproval.requestId,
    approved: false,
    reason
  }).catch(() => {});
}

function endWalkthroughSession({ preserveConversation = false, preserveOverlay = false } = {}) {
  if (!state.walkthroughSession) {
    return;
  }

  state.walkthroughSession = null;
  renderWalkthroughCard();

  if (!preserveConversation) {
    renderConversationFromHistory();
  }

  if (!preserveOverlay) {
    window.clicky.clearOverlayPoint().catch(() => {});
    applyIdleOverlayState();
  }
}

function renderWorkerHealth() {
  workerHealthSummary.textContent = state.workerHealth.summary;
  workerHealthNote.textContent = state.workerHealth.note;
  chatHealthStatus.textContent = state.workerHealth.endpoints.chat.status;
  chatHealthDetail.textContent = state.workerHealth.endpoints.chat.detail;
  ttsHealthStatus.textContent = state.workerHealth.endpoints.tts.status;
  ttsHealthDetail.textContent = state.workerHealth.endpoints.tts.detail;
  transcribeHealthStatus.textContent = state.workerHealth.endpoints.transcribeToken.status;
  transcribeHealthDetail.textContent = state.workerHealth.endpoints.transcribeToken.detail;
}

function renderBackendReadiness() {
  const savedWorkerConfigured = isWorkerUrlConfigured(state.config.workerBaseUrl);
  const draftWorkerBaseUrl = getWorkerUrlCandidateFromInput();
  const draftWorkerConfigured = isWorkerUrlConfigured(draftWorkerBaseUrl);
  const hasUnsavedWorkerChanges = hasUnsavedWorkerSettings();
  const hasUnsavedWorkerAuth = hasUnsavedWorkerSecuritySettings();
  const isCheckingBackend = state.workerHealth.overallStatus === "checking";

  sendManualPromptButton.disabled = !savedWorkerConfigured;
  checkWorkerHealthButton.disabled = !draftWorkerConfigured || isCheckingBackend;
  checkWorkerHealthButton.textContent = isCheckingBackend ? "testing backend..." : "test backend";

  if (!savedWorkerConfigured) {
    backendOnboardingCard.hidden = false;
    backendOnboardingBadge.textContent = "action needed";
    backendOnboardingLabel.textContent = "Before first use";
    backendOnboardingTitle.textContent = "Connect your Worker backend";
    backendOnboardingCopy.textContent = "Add a live Worker URL in Settings, then save and test the backend before using voice or manual prompts.";
    return;
  }

  if (hasUnsavedWorkerChanges) {
    backendOnboardingCard.hidden = false;
    backendOnboardingBadge.textContent = "save first";
    backendOnboardingLabel.textContent = "Pending backend changes";
    backendOnboardingTitle.textContent = "Your saved backend is still the active one";
    backendOnboardingCopy.textContent = hasUnsavedWorkerAuth
      ? "Save Settings before testing so Clicky can attach your updated auth header values from the main process."
      : "The Worker URL in the form differs from the active backend. Save Settings before trusting the next session to use it.";
    return;
  }

  if (state.workerHealth.overallStatus === "checking") {
    backendOnboardingCard.hidden = false;
    backendOnboardingBadge.textContent = "checking";
    backendOnboardingLabel.textContent = "Connectivity";
    backendOnboardingTitle.textContent = "Testing /chat, /tts, and /transcribe-token";
    backendOnboardingCopy.textContent = "Clicky is validating the saved backend right now.";
    return;
  }

  if (state.workerHealth.overallStatus === "pending") {
    backendOnboardingCard.hidden = false;
    backendOnboardingBadge.textContent = "test first";
    backendOnboardingLabel.textContent = "Connectivity";
    backendOnboardingTitle.textContent = "Run a backend test before the first live session";
    backendOnboardingCopy.textContent = "The Worker URL is configured, but Clicky has not confirmed the required routes yet.";
    return;
  }

  if (state.workerHealth.overallStatus === "degraded") {
    const failingEndpointSummary = Object.values(state.workerHealth.endpoints)
      .filter((endpoint) => endpoint.status !== "ready")
      .map((endpoint) => `${endpoint.label}: ${endpoint.detail}`)
      .join(" ");

    backendOnboardingCard.hidden = false;
    backendOnboardingBadge.textContent = "backend issue";
    backendOnboardingLabel.textContent = "Connectivity";
    backendOnboardingTitle.textContent = "The backend is configured, but not fully healthy yet";
    backendOnboardingCopy.textContent = failingEndpointSummary
      ? `Failing checks: ${failingEndpointSummary}`
      : "Review the endpoint details below, then retry after fixing the failing route or auth secret.";
    return;
  }

  backendOnboardingCard.hidden = true;
}

async function runWorkerHealthCheck({ workerBaseUrl, userInitiated = false } = {}) {
  const candidateWorkerBaseUrl = normalizeWorkerBaseUrl(workerBaseUrl || state.config.workerBaseUrl) || DEFAULT_WORKER_BASE_URL;
  const workerUrlValidation = validateWorkerUrlSyntax(candidateWorkerBaseUrl);

  if (!workerUrlValidation.ok) {
    state.workerHealth = createInvalidWorkerHealthState(workerUrlValidation.message);
    renderWorkerHealth();
    renderBackendReadiness();
    if (userInitiated) {
      showError(workerUrlValidation.message);
    }
    return;
  }

  if (!isWorkerUrlConfigured(candidateWorkerBaseUrl)) {
    state.workerHealth = createSetupRequiredWorkerHealthState(
      "Replace the placeholder Worker URL before testing backend connectivity."
    );
    renderWorkerHealth();
    renderBackendReadiness();
    if (userInitiated) {
      showError("Replace the placeholder Worker URL in Settings before testing the backend.");
    }
    return;
  }

  state.workerHealth = createCheckingWorkerHealthState(candidateWorkerBaseUrl);
  renderWorkerHealth();
  renderBackendReadiness();

  const [chatResult, ttsResult, transcribeTokenResult] = await Promise.allSettled([
    checkChatEndpoint(candidateWorkerBaseUrl),
    checkTtsEndpoint(candidateWorkerBaseUrl),
    checkTranscribeTokenEndpoint(candidateWorkerBaseUrl)
  ]);

  const endpoints = {
    chat: createEndpointHealthFromResult(chatResult, "/chat", "Chat requests are responding."),
    tts: createEndpointHealthFromResult(ttsResult, "/tts", "TTS returned audio successfully."),
    transcribeToken: createEndpointHealthFromResult(
      transcribeTokenResult,
      "/transcribe-token",
      "Transcription token requests are responding."
    )
  };

  const failedEndpoints = Object.values(endpoints).filter((endpoint) => endpoint.status !== "ready");
  const testedSavedBackend = normalizeWorkerBaseUrl(candidateWorkerBaseUrl) === normalizeWorkerBaseUrl(state.config.workerBaseUrl);
  const authContextNote = state.config.workerAuthHeaderName && state.config.workerAuthHeaderValue
    ? `Auth header \`${state.config.workerAuthHeaderName}\` is being attached from saved settings.`
    : "No optional Worker auth header is configured.";

  state.workerHealth = failedEndpoints.length === 0
    ? {
        overallStatus: "ready",
        summary: "Backend ready",
        note: testedSavedBackend
          ? `All required routes are healthy. ${authContextNote}`
          : `The current URL looks healthy. Save Settings to make it the active backend. ${authContextNote}`,
        checkedWorkerBaseUrl: candidateWorkerBaseUrl,
        endpoints
      }
    : {
        overallStatus: "degraded",
        summary: "Backend degraded",
        note: `One or more required routes failed. ${failedEndpoints.map((endpoint) => endpoint.label).join(", ")} need attention.`,
        checkedWorkerBaseUrl: candidateWorkerBaseUrl,
        endpoints
      };

  renderWorkerHealth();
  renderBackendReadiness();
  renderConversationFromHistory();

  if (userInitiated) {
    if (failedEndpoints.length === 0) {
      clearError();
    } else {
      showError("Backend health check failed. Review the endpoint details in Settings.");
    }
  }
}

async function checkChatEndpoint(workerBaseUrl) {
  const completion = await window.clicky.completeChat({
    workerBaseUrl,
    requestBody: {
      model: modelSelect.value || state.config.selectedModel,
      max_tokens: 24,
      system: "You are a backend health check. Respond with the single word ok.",
      messages: [
        {
          role: "user",
          content: "Respond with ok."
        }
      ]
    }
  });

  const responseText = extractCompletionText(completion);
  if (!responseText) {
    throw new Error("Chat returned no text.");
  }

  return responseText;
}

async function checkTtsEndpoint(workerBaseUrl) {
  const audio = await window.clicky.fetchTTSAudio({
    workerBaseUrl,
    text: "health check"
  });

  if (!audio?.audioBase64) {
    throw new Error("TTS returned no audio payload.");
  }

  return audio.audioBase64;
}

async function checkTranscribeTokenEndpoint(workerBaseUrl) {
  const tokenPayload = await window.clicky.getTranscribeToken(workerBaseUrl);

  if (typeof tokenPayload?.token !== "string" || tokenPayload.token.trim() === "") {
    throw new Error("Transcription token response did not include a token.");
  }

  return tokenPayload.token;
}

function extractCompletionText(completion) {
  return (completion?.content || [])
    .filter((contentBlock) => contentBlock.type === "text")
    .map((contentBlock) => contentBlock.text)
    .join("\n")
    .trim();
}

function createEndpointHealthFromResult(result, endpointLabel, readyDetail) {
  if (result.status === "fulfilled") {
    return {
      label: endpointLabel,
      status: "ready",
      detail: readyDetail
    };
  }

  return {
    label: endpointLabel,
    status: "error",
    detail: result.reason?.message || "Unknown backend error."
  };
}

function resetWorkerHealthForCandidate(workerBaseUrl) {
  if (!isWorkerUrlConfigured(workerBaseUrl)) {
    state.workerHealth = createSetupRequiredWorkerHealthState();
    return;
  }

  state.workerHealth = createPendingWorkerHealthState(workerBaseUrl);
}

function createSetupRequiredWorkerHealthState(note = "Clicky needs a live backend before voice, chat, and TTS can work.") {
  return {
    overallStatus: "setup-required",
    summary: "Backend setup required",
    note,
    checkedWorkerBaseUrl: "",
    endpoints: {
      chat: createEndpointHealthState("setup required", "Waiting for a valid Worker URL.", "/chat"),
      tts: createEndpointHealthState("setup required", "Waiting for a valid Worker URL.", "/tts"),
      transcribeToken: createEndpointHealthState(
        "setup required",
        "Waiting for a valid Worker URL.",
        "/transcribe-token"
      )
    }
  };
}

function createPendingWorkerHealthState(workerBaseUrl) {
  return {
    overallStatus: "pending",
    summary: "Backend not tested yet",
    note: normalizeWorkerBaseUrl(workerBaseUrl) === normalizeWorkerBaseUrl(state.config.workerBaseUrl)
      ? "Click Save Settings or Test Backend to verify connectivity."
      : "Test this URL after saving, or use Test Backend when auth values already match.",
    checkedWorkerBaseUrl: normalizeWorkerBaseUrl(workerBaseUrl),
    endpoints: {
      chat: createEndpointHealthState("not tested", "No recent backend check for /chat.", "/chat"),
      tts: createEndpointHealthState("not tested", "No recent backend check for /tts.", "/tts"),
      transcribeToken: createEndpointHealthState(
        "not tested",
        "No recent backend check for /transcribe-token.",
        "/transcribe-token"
      )
    }
  };
}

function createCheckingWorkerHealthState(workerBaseUrl) {
  return {
    overallStatus: "checking",
    summary: "Checking backend",
    note: "Testing the required Worker routes now.",
    checkedWorkerBaseUrl: normalizeWorkerBaseUrl(workerBaseUrl),
    endpoints: {
      chat: createEndpointHealthState("checking", "Running /chat health check...", "/chat"),
      tts: createEndpointHealthState("checking", "Running /tts health check...", "/tts"),
      transcribeToken: createEndpointHealthState(
        "checking",
        "Running /transcribe-token health check...",
        "/transcribe-token"
      )
    }
  };
}

function createInvalidWorkerHealthState(message) {
  return {
    overallStatus: "invalid",
    summary: "Worker URL invalid",
    note: message,
    checkedWorkerBaseUrl: "",
    endpoints: {
      chat: createEndpointHealthState("blocked", message, "/chat"),
      tts: createEndpointHealthState("blocked", message, "/tts"),
      transcribeToken: createEndpointHealthState("blocked", message, "/transcribe-token")
    }
  };
}

function createEndpointHealthState(status, detail, label) {
  return {
    label,
    status,
    detail
  };
}

function ensureWorkerConfiguredForUse() {
  const savedWorkerBaseUrl = normalizeWorkerBaseUrl(state.config.workerBaseUrl) || DEFAULT_WORKER_BASE_URL;
  const workerUrlValidation = validateWorkerUrlSyntax(savedWorkerBaseUrl);

  if (!workerUrlValidation.ok || !isWorkerUrlConfigured(savedWorkerBaseUrl)) {
    showError("Clicky needs a live Worker URL in Settings before it can listen, chat, or speak.");
    focusWorkerSettings();
    renderBackendReadiness();
    return false;
  }

  return true;
}

function hasUnsavedWorkerSecuritySettings() {
  return workerAuthHeaderNameInput.value.trim() !== String(state.config.workerAuthHeaderName || "").trim() ||
    workerAuthHeaderValueInput.value.trim() !== String(state.config.workerAuthHeaderValue || "").trim();
}

function hasUnsavedWorkerSettings() {
  return normalizeWorkerBaseUrl(getWorkerUrlCandidateFromInput()) !== normalizeWorkerBaseUrl(state.config.workerBaseUrl) ||
    hasUnsavedWorkerSecuritySettings();
}

function getWorkerUrlCandidateFromInput() {
  return normalizeWorkerBaseUrl(workerUrlInput.value) || DEFAULT_WORKER_BASE_URL;
}

function focusWorkerSettings() {
  workerUrlInput.focus();
  workerUrlInput.select();
}

function validateWorkerUrlSyntax(workerBaseUrl) {
  const normalizedWorkerBaseUrl = normalizeWorkerBaseUrl(workerBaseUrl);
  if (!normalizedWorkerBaseUrl) {
    return {
      ok: true
    };
  }

  let parsedWorkerBaseUrl;
  try {
    parsedWorkerBaseUrl = new URL(normalizedWorkerBaseUrl);
  } catch {
    return {
      ok: false,
      message: "Worker URL must be a valid http or https URL."
    };
  }

  if (!["http:", "https:"].includes(parsedWorkerBaseUrl.protocol)) {
    return {
      ok: false,
      message: "Worker URL must start with http:// or https://."
    };
  }

  return {
    ok: true
  };
}

function validateWorkerAuthHeaderInputs(headerName, headerValue) {
  const normalizedHeaderName = String(headerName || "").trim();
  const normalizedHeaderValue = String(headerValue || "").trim();

  if (!normalizedHeaderName && !normalizedHeaderValue) {
    return {
      ok: true
    };
  }

  if (!normalizedHeaderName || !normalizedHeaderValue) {
    return {
      ok: false,
      message: "Fill both Worker auth header fields or leave both empty."
    };
  }

  try {
    const headers = new Headers();
    headers.set(normalizedHeaderName, normalizedHeaderValue);
  } catch {
    return {
      ok: false,
      message: "Worker auth header name is invalid."
    };
  }

  return {
    ok: true
  };
}

function validateVisualHistoryRetentionDays(rawValue) {
  const parsedValue = Number.parseInt(String(rawValue || "").trim(), 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 1 || parsedValue > 90) {
    return {
      ok: false,
      message: "Visual history retention must be a whole number between 1 and 90 days."
    };
  }

  return {
    ok: true,
    value: parsedValue
  };
}

function getBackgroundCaptureOptions() {
  return {
    mode: state.config.screenCaptureMode || "cursor-display"
  };
}

function isWorkerUrlConfigured(workerBaseUrl) {
  const normalizedWorkerBaseUrl = normalizeWorkerBaseUrl(workerBaseUrl);
  return Boolean(normalizedWorkerBaseUrl) && normalizedWorkerBaseUrl !== normalizeWorkerBaseUrl(DEFAULT_WORKER_BASE_URL) &&
    !/your-worker-name|your-subdomain/i.test(normalizedWorkerBaseUrl);
}

function normalizeWorkerBaseUrl(workerBaseUrl) {
  return String(workerBaseUrl || "").trim().replace(/\/+$/, "");
}

function renderPersistentMemory() {
  const profileCategories = getProfileCategories(state.persistentMemory);
  preferredLanguageInput.value = state.persistentMemory.profile?.preferredLanguage || "";
  activeProjectsInput.value = profileCategories.activeProjects.join("\n");
  pendingIssuesInput.value = profileCategories.pendingIssues.join("\n");
  decisionsMadeInput.value = profileCategories.decisionsMade.join("\n");
}

function renderAppContext() {
  if (!state.appContext) {
    currentAppName.textContent = "waiting for focused app";
    currentModeLabel.textContent = "general";
    currentWindowTitle.textContent = "No active window detected yet.";
    currentProjectHint.textContent = "No project hint yet.";
    return;
  }

  currentAppName.textContent = state.appContext.processName || "unknown";
  currentModeLabel.textContent = state.appContext.detectedMode || "general";
  currentWindowTitle.textContent = state.appContext.windowTitle || "No window title";
  currentProjectHint.textContent = state.appContext.projectHint || "No project hint";
}

function renderVisualHistory() {
  visualHistoryList.innerHTML = "";

  const visualHistoryEntries = state.persistentMemory.visualHistory || [];
  if (visualHistoryEntries.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "history-item history-item-empty";
    emptyItem.textContent = "No saved visual moments yet.";
    visualHistoryList.appendChild(emptyItem);
    return;
  }

  for (const visualMoment of visualHistoryEntries.slice(0, 6)) {
    const historyItem = document.createElement("li");
    historyItem.className = "history-item";

    const historyTopRow = document.createElement("div");
    historyTopRow.className = "history-item-row";

    const historyTitle = document.createElement("strong");
    historyTitle.textContent = `${formatTimestamp(visualMoment.recordedAt)} · ${visualMoment.appContext?.processName || visualMoment.appContext?.detectedMode || "session"}`;

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "history-delete-button";
    deleteButton.textContent = "delete";
    deleteButton.addEventListener("click", async () => {
      if (!window.confirm("Delete this saved visual moment and its screenshots from this machine?")) {
        return;
      }

      try {
        state.persistentMemory = await window.clicky.deleteVisualMomentById(visualMoment.id);
        renderVisualHistory();
        clearError();
      } catch (error) {
        showError(error.message);
      }
    });

    const historySummary = document.createElement("p");
    historySummary.textContent = visualMoment.summary || visualMoment.userPrompt || "Saved moment";

    historyTopRow.appendChild(historyTitle);
    historyTopRow.appendChild(deleteButton);
    historyItem.appendChild(historyTopRow);
    historyItem.appendChild(historySummary);
    visualHistoryList.appendChild(historyItem);
  }
}

function renderProactiveSuggestion() {
  proactiveSuggestionOutput.textContent = state.latestProactiveSuggestion || "No proactive nudge yet.";
}

function renderPassiveVisualContext() {
  if (!state.config.passiveVisualContextEnabled) {
    passiveVisualStatusOutput.textContent = "off";
    passiveVisualSummaryOutput.textContent = "Enable passive visual context to watch for app or screen changes in the background.";
    return;
  }

  passiveVisualStatusOutput.textContent = state.passiveVisualContext.changeCount > 0
    ? `watching (${state.passiveVisualContext.changeCount} changes)`
    : "watching";
  passiveVisualSummaryOutput.textContent = state.passiveVisualContext.summary ||
    buildPassiveVisualWaitingMessage();
}

function getListeningInstructionText() {
  if (state.shortcutMode.mode === "fallback") {
    return `listening... press ${state.shortcutMode.label} again to send.`;
  }

  return "listening...";
}

function renderStatus(status) {
  const labels = {
    approval: "approval",
    listening: "listening",
    processing: "thinking",
    ready: "ready"
  };

  statusBadge.textContent = labels[status] || status;
}

function applyIdleOverlayState() {
  const shouldShowIdleOverlay = state.config.showClickyWhenIdle && !state.isRecording && !state.isProcessing;

  if (!shouldShowIdleOverlay) {
    window.clicky.hideOverlay();
    return;
  }

  window.clicky.setOverlayState({
    visible: true,
    mode: "idle",
    statusText: "ready",
    message: "",
    showClickyWhenIdle: state.config.showClickyWhenIdle
  });
}

async function persistVisualMoment({
  source,
  userPrompt,
  assistantResponse,
  appContext,
  screenCaptures
}) {
  state.persistentMemory = await window.clicky.recordVisualMoment({
    source,
    userPrompt,
    assistantResponse,
    appContext,
    screenCaptures,
    summary: buildVisualMomentSummary({
      userPrompt,
      assistantResponse,
      appContext,
      source
    })
  });
  renderVisualHistory();
}

function startProactiveWatcher() {
  stopProactiveWatcher();
  renderPassiveVisualContext();
  renderProactiveSuggestion();
  state.proactiveWatcher.intervalId = window.setInterval(() => {
    runProactiveWatcherTick().catch((error) => {
      console.warn("Proactive watcher tick failed:", error);
    });
  }, backgroundObservationIntervalMilliseconds);
}

function stopProactiveWatcher() {
  if (state.proactiveWatcher.intervalId) {
    window.clearInterval(state.proactiveWatcher.intervalId);
    state.proactiveWatcher.intervalId = null;
  }
}

async function runProactiveWatcherTick() {
  const shouldWatchPassiveContext = state.config.passiveVisualContextEnabled;
  const shouldEvaluateProactiveTriggers = state.config.autoTriggersEnabled &&
    isWorkerUrlConfigured(state.config.workerBaseUrl);

  if (!shouldWatchPassiveContext && !shouldEvaluateProactiveTriggers) {
    return;
  }

  if (state.isRecording || state.isProcessing) {
    return;
  }

  const screenCaptures = await window.clicky.captureScreens(getBackgroundCaptureOptions());
  const currentFingerprint = await createScreenFingerprint(screenCaptures);
  const currentAppSignature = getCurrentAppSignature();
  const now = Date.now();
  const hasExistingBaseline = Boolean(
    state.proactiveWatcher.lastFingerprint || state.proactiveWatcher.lastAppSignature
  );
  const fingerprintChanged = currentFingerprint !== state.proactiveWatcher.lastFingerprint;
  const appSignatureChanged = currentAppSignature !== state.proactiveWatcher.lastAppSignature;

  if (!hasExistingBaseline) {
    updateProactiveWatcherBaseline(screenCaptures, {
      fingerprint: currentFingerprint,
      appSignature: currentAppSignature,
      observedAt: now
    });
    if (shouldWatchPassiveContext) {
      state.passiveVisualContext = {
        ...state.passiveVisualContext,
        status: "watching",
        summary: buildPassiveVisualWaitingMessage()
      };
      renderPassiveVisualContext();
    }
    return;
  }

  if (fingerprintChanged || appSignatureChanged) {
    updateProactiveWatcherBaseline(screenCaptures, {
      fingerprint: currentFingerprint,
      appSignature: currentAppSignature,
      observedAt: now
    });
    if (shouldWatchPassiveContext) {
      rememberPassiveVisualChange({
        appSignatureChanged,
        fingerprintChanged,
        observedAt: now
      });
    }
    return;
  }

  if (!shouldEvaluateProactiveTriggers) {
    return;
  }

  const looksStagnant = now - state.proactiveWatcher.lastChangedAt >= stagnationThresholdMilliseconds;
  const looksLikeVisibleError = /error|exception|failed|traceback|warning/i.test(
    `${state.appContext?.windowTitle || ""}`
  );
  const hasCooledDown = now - state.proactiveWatcher.lastInterventionAt >= proactiveSuggestionCooldownMilliseconds;

  if ((!looksStagnant && !looksLikeVisibleError) || !hasCooledDown) {
    return;
  }

  if (state.proactiveWatcher.lastInterventionFingerprint === currentFingerprint) {
    return;
  }

  const proactiveSuggestion = await requestProactiveSuggestion({
    screenCaptures,
    reasonHint: looksLikeVisibleError ? "possible error visible on screen" : "same screen with no visible progress for a while"
  });

  if (!proactiveSuggestion.shouldIntervene || !proactiveSuggestion.message) {
    return;
  }

  state.proactiveWatcher.lastInterventionAt = now;
  state.proactiveWatcher.lastInterventionFingerprint = currentFingerprint;
  state.latestProactiveSuggestion = proactiveSuggestion.message;
  renderProactiveSuggestion();

  await window.clicky.showBalloonNotification({
    title: "Clicky noticed something",
    content: proactiveSuggestion.message,
    iconType: "info"
  });

  await window.clicky.setOverlayState({
    visible: true,
    mode: "responding",
    statusText: "nudge",
    message: proactiveSuggestion.message,
    showClickyWhenIdle: true
  });

  responseOutput.textContent = proactiveSuggestion.message;

  if (state.config.visualHistoryEnabled) {
    await persistVisualMoment({
      source: "auto-trigger",
      userPrompt: proactiveSuggestion.summary || proactiveSuggestion.reason || "proactive trigger",
      assistantResponse: proactiveSuggestion.message,
      appContext: state.appContext,
      screenCaptures
    });
  }

  window.setTimeout(() => {
    if (!state.isRecording && !state.isProcessing) {
      applyIdleOverlayState();
    }
  }, 7000);
}

function rememberPassiveVisualChange({ appSignatureChanged, fingerprintChanged, observedAt }) {
  const changedThings = [];
  if (appSignatureChanged) {
    changedThings.push("focused app");
  }
  if (fingerprintChanged) {
    changedThings.push("screen content");
  }

  const appLabel = state.appContext?.processName || state.appContext?.detectedMode || "the current app";
  const projectLabel = state.appContext?.projectHint ? ` for ${state.appContext.projectHint}` : "";
  const detectedChangeLabel = changedThings.length > 0 ? changedThings.join(" and ") : "screen state";

  state.passiveVisualContext = {
    changeCount: state.passiveVisualContext.changeCount + 1,
    lastChangedAt: observedAt,
    status: "watching",
    summary: `${capitalizeFirst(detectedChangeLabel)} changed in ${appLabel}${projectLabel}. Last update ${formatTimestamp(new Date(observedAt).toISOString())}.`
  };
  renderPassiveVisualContext();
}

function buildPassiveVisualWaitingMessage() {
  const captureScopeLabel = state.config.screenCaptureMode === "all-displays"
    ? "all displays"
    : "the cursor display";
  return `Watching ${captureScopeLabel} for passive app and screen changes.`;
}

async function requestProactiveSuggestion({ screenCaptures, reasonHint }) {
  const requestBody = {
    model: state.config.selectedModel,
    max_tokens: 500,
    system: `
you are clicky's proactive monitor. inspect the screenshots and the focused app context, then decide whether the user likely needs a gentle interruption right now.

rules:
- intervene only when there is a visible blocker, an obvious error, or the user appears stuck on the same screen with no progress.
- keep the interruption calm, specific, and useful.
- answer with strict json only.
- json schema:
{
  "shouldIntervene": boolean,
  "reason": "short label",
  "message": "one or two natural sentences",
  "summary": "compact summary for visual history"
}
    `.trim(),
    messages: [
      {
        role: "user",
        content: [
          ...screenCaptures.flatMap((capture) => ([
            {
              type: "image",
              source: {
                type: "base64",
                media_type: capture.mediaType,
                data: capture.imageBase64
              }
            },
            {
              type: "text",
              text: `${capture.label} (image dimensions: ${capture.screenshotWidthInPixels}x${capture.screenshotHeightInPixels} pixels)`
            }
          ])),
          {
            type: "text",
            text: `
reason hint:
${reasonHint}

persistent memory:
${buildPersistentMemorySummary(state.persistentMemory)}

recent visual history:
${buildRecentVisualHistorySummary(state.persistentMemory, 4)}

current app context:
${buildAppContextSummary(state.appContext)}
            `.trim()
          }
        ]
      }
    ]
  };

  const completion = await window.clicky.completeChat({
    workerBaseUrl: state.config.workerBaseUrl,
    requestBody
  });

  const assistantText = (completion.content || [])
    .filter((contentBlock) => contentBlock.type === "text")
    .map((contentBlock) => contentBlock.text)
    .join("\n")
    .trim();

  return parseJsonResponseText(assistantText);
}

async function updateProactiveWatcherBaseline(screenCaptures, baseline = {}) {
  state.proactiveWatcher.lastFingerprint = baseline.fingerprint || await createScreenFingerprint(screenCaptures);
  state.proactiveWatcher.lastAppSignature = baseline.appSignature || getCurrentAppSignature();
  state.proactiveWatcher.lastChangedAt = baseline.observedAt || Date.now();
}

async function createScreenFingerprint(screenCaptures) {
  const signatureText = screenCaptures
    .map((screenCapture) => (
      `${screenCapture.label}|${screenCapture.screenshotWidthInPixels}x${screenCapture.screenshotHeightInPixels}|${screenCapture.imageBase64.slice(0, 256)}|${screenCapture.imageBase64.slice(-256)}`
    ))
    .join("||");
  const encodedSignature = new TextEncoder().encode(signatureText);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encodedSignature);
  return Array.from(new Uint8Array(hashBuffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function getCurrentAppSignature() {
  return [
    state.appContext?.processName || "",
    state.appContext?.windowTitle || "",
    state.appContext?.detectedMode || ""
  ].join("|");
}

function parseJsonResponseText(responseText) {
  const normalizedText = responseText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  return JSON.parse(normalizedText);
}

function parseCommaOrLineSeparatedValues(text) {
  return text
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function showError(message) {
  cancelPendingAgentApproval("The pending agent action was cancelled because Clicky hit an error.");
  state.walkthroughSession = null;
  renderWalkthroughCard();
  errorBanner.hidden = false;
  errorBanner.textContent = message;
  responseOutput.textContent = message;
  renderStatus("ready");
  state.isRecording = false;
  state.isProcessing = false;
  state.isStartingRecording = false;
  state.shouldStopAfterStart = false;
  state.activeTranscriptionSession?.cancel();
  state.activeTranscriptionSession = null;
  applyIdleOverlayState();
}

function clearError() {
  errorBanner.hidden = true;
  errorBanner.textContent = "";
}

function base64ToBlob(base64String, mimeType) {
  const byteCharacters = atob(base64String);
  const byteNumbers = new Array(byteCharacters.length);

  for (let index = 0; index < byteCharacters.length; index += 1) {
    byteNumbers[index] = byteCharacters.charCodeAt(index);
  }

  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
}

function formatTimestamp(isoString) {
  try {
    return new Date(isoString).toLocaleString();
  } catch {
    return isoString;
  }
}

function capitalizeFirst(text) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) {
    return "";
  }

  return `${normalizedText.charAt(0).toUpperCase()}${normalizedText.slice(1)}`;
}
