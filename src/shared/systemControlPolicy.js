const mouseIntentPatterns = [
  /\bclick\b/i,
  /\bdouble click\b/i,
  /\bright click\b/i,
  /\bdrag\b/i,
  /\bdrop\b/i,
  /\bmove (?:the )?cursor\b/i,
  /\bmove (?:the )?mouse\b/i,
  /\bhaz clic\b/i,
  /\bdoble clic\b/i,
  /\bclic derecho\b/i,
  /\barrastra\b/i,
  /\bsuelta\b/i,
  /\bmueve (?:el )?cursor\b/i,
  /\bmueve (?:el )?mouse\b/i,
  /\bselecciona\b/i,
  /\bpulsa(?:r)?\b/i,
  /\bpresiona(?:r)?\b/i
];

const keyboardIntentPatterns = [
  /\btype\b/i,
  /\bwrite\b/i,
  /\benter text\b/i,
  /\bfill (?:in|out)\b/i,
  /\binput\b/i,
  /\bshortcut\b/i,
  /\bhotkey\b/i,
  /\bctrl\s*\+\s*/i,
  /\balt\s*\+\s*/i,
  /\bwin\s*\+\s*/i,
  /\bescribe\b/i,
  /\bteclea\b/i,
  /\brellena\b/i,
  /\bingresa\b/i,
  /\bpon el texto\b/i,
  /\batajo\b/i
];

const launchIntentPatterns = [
  /\bopen\b/i,
  /\blaunch\b/i,
  /\bstart\b/i,
  /\brun\b/i,
  /\babre\b/i,
  /\binicia\b/i,
  /\bejecuta\b/i
];

const closeIntentPatterns = [
  /\bclose\b/i,
  /\bquit\b/i,
  /\bexit\b/i,
  /\bterminate\b/i,
  /\bcierra\b/i,
  /\bcerra\b/i,
  /\bsal de\b/i
];

const switchWindowIntentPatterns = [
  /\bswitch window\b/i,
  /\bchange window\b/i,
  /\balt\s*\+\s*tab\b/i,
  /\bbring .* to front\b/i,
  /\bcambiar de ventana\b/i,
  /\bcambia a\b/i,
  /\btrae .* al frente\b/i,
  /\benfoca\b/i
];

const fileSearchIntentPatterns = [
  /\bfind file\b/i,
  /\bsearch file\b/i,
  /\blook for file\b/i,
  /\bbusca(?:r)? archivo\b/i,
  /\bencontra(?:r)? archivo\b/i
];

const handsOnAssistanceIntentPatterns = [
  /\bhelp me\b/i,
  /\bcan you do it\b/i,
  /\bcan you handle\b/i,
  /\bdo it for me\b/i,
  /\bfix (?:it|this)\b/i,
  /\bsolve (?:it|this)\b/i,
  /\bhandle (?:it|this)\b/i,
  /\bi can't\b/i,
  /\bi cannot\b/i,
  /\bi'm stuck\b/i,
  /\bayudame\b/i,
  /\bay\u00fadame\b/i,
  /\bhazlo (?:tu|t\u00fa)\b/i,
  /\bhazlo por mi\b/i,
  /\bhazlo por m\u00ed\b/i,
  /\barreglalo\b/i,
  /\barr\u00e9glalo\b/i,
  /\bresuelvelo\b/i,
  /\bresu\u00e9lvelo\b/i,
  /\bencargate\b/i,
  /\benc\u00e1rgate\b/i,
  /\bno puedo\b/i,
  /\bestoy atorado\b/i,
  /\btengo problemas\b/i
];

const autoModePatterns = [
  /\bdo it automatically\b/i,
  /\bautomatic mode\b/i,
  /\bfully automatic\b/i,
  /\bwithout asking\b/i,
  /\bsin preguntar\b/i,
  /\bhazlo automaticamente\b/i,
  /\bhazlo autom\u00e1ticamente\b/i,
  /\bmodo automatico\b/i,
  /\bmodo autom\u00e1tico\b/i
];

const safeModePatterns = [
  /\bsafe mode\b/i,
  /\bask before each\b/i,
  /\bconfirm each step\b/i,
  /\bmodo seguro\b/i,
  /\bconfirma cada paso\b/i,
  /\bpide confirmacion\b/i,
  /\bpide confirmaci\u00f3n\b/i
];

const retryOrContinuationPatterns = [
  /^again[.!]?$/i,
  /^try again[.!]?$/i,
  /^retry[.!]?$/i,
  /^continue[.!]?$/i,
  /^keep going[.!]?$/i,
  /^otra vez[.!]?$/i,
  /^de nuevo[.!]?$/i,
  /^int[e\u00e9]ntalo de nuevo[.!]?$/i,
  /^contin[u\u00fa]a[.!]?$/i,
  /^sigue[.!]?$/i,
  /^hazlo[.!]?$/i,
  /^hazlo tu[.!]?$/i,
  /^hazlo t\u00fa[.!]?$/i
];

export function deriveSystemControlPolicy({
  requestSource,
  userPrompt,
  previousUserPrompt,
  permissiveDevModeEnabled
}) {
  const normalizedPrompt = String(userPrompt || "").trim();
  const normalizedPreviousPrompt = String(previousUserPrompt || "").trim();
  const isVoiceRequest = requestSource === "voice-session";
  const isPermissiveDevModeEnabled = Boolean(permissiveDevModeEnabled);
  const canControlFromThisRequest = isVoiceRequest || isPermissiveDevModeEnabled;
  const isContinuationRequest = matchesAny(retryOrContinuationPatterns, normalizedPrompt);
  const effectivePrompt = isContinuationRequest && normalizedPreviousPrompt
    ? `${normalizedPreviousPrompt}\n${normalizedPrompt}`
    : normalizedPrompt;
  const isHandsOnAssistanceRequest = matchesAny(handsOnAssistanceIntentPatterns, effectivePrompt);
  const allowMouseControl = matchesAny(mouseIntentPatterns, effectivePrompt) || isHandsOnAssistanceRequest;
  const allowKeyboardControl = matchesAny(keyboardIntentPatterns, effectivePrompt) || isHandsOnAssistanceRequest;
  const allowLaunchControl = matchesAny(launchIntentPatterns, effectivePrompt) || isHandsOnAssistanceRequest;
  const allowCloseControl = matchesAny(closeIntentPatterns, effectivePrompt);
  const allowWindowSwitching = matchesAny(switchWindowIntentPatterns, effectivePrompt) || isHandsOnAssistanceRequest;
  const allowFileSearch = matchesAny(fileSearchIntentPatterns, effectivePrompt) || isHandsOnAssistanceRequest;
  const autonomyMode = deriveAutonomyMode(effectivePrompt);
  const requestedCapabilities = [
    allowMouseControl ? "mouse" : "",
    allowKeyboardControl ? "keyboard" : "",
    allowLaunchControl ? "launch" : "",
    allowCloseControl ? "close" : "",
    allowWindowSwitching ? "window-switch" : "",
    allowFileSearch ? "file-search" : ""
  ].filter(Boolean);

  return {
    isVoiceRequest,
    isPermissiveDevModeEnabled,
    isContinuationRequest,
    hasExplicitRequest: requestedCapabilities.length > 0 || isHandsOnAssistanceRequest,
    isHandsOnAssistanceRequest,
    autonomyMode,
    isSystemControlAllowed: canControlFromThisRequest && requestedCapabilities.length > 0,
    requestedCapabilities,
    allowMouseControl: canControlFromThisRequest && allowMouseControl,
    allowKeyboardControl: canControlFromThisRequest && allowKeyboardControl,
    allowLaunchControl: canControlFromThisRequest && allowLaunchControl,
    allowCloseControl: canControlFromThisRequest && allowCloseControl,
    allowWindowSwitching: canControlFromThisRequest && allowWindowSwitching,
    allowFileSearch: canControlFromThisRequest && allowFileSearch
  };
}

export function shouldRequireApprovalForTool(toolName, systemControlPolicy) {
  const normalizedToolName = String(toolName || "").trim();
  if (systemControlPolicy?.isPermissiveDevModeEnabled) {
    return false;
  }

  if (systemControlPolicy?.autonomyMode === "safe") {
    return true;
  }

  if (systemControlPolicy?.autonomyMode === "auto") {
    return !new Set([
      "control_mouse",
      "drag_mouse",
      "keyboard_shortcut",
      "switch_window"
    ]).has(normalizedToolName);
  }

  return true;
}

function deriveAutonomyMode(text) {
  if (matchesAny(safeModePatterns, text)) {
    return "safe";
  }

  if (matchesAny(autoModePatterns, text)) {
    return "auto";
  }

  return "standard";
}

function matchesAny(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}
