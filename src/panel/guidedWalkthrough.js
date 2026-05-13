const pointTagPattern = /\[POINT:(?:none|(\d+)\s*,\s*(\d+)(?::([^\]:\s][^\]:]*?))?(?::screen(\d+))?)\]\s*$/;

export function normalizeGuidedWalkthroughPlan(rawPlan) {
  const rawSteps = Array.isArray(rawPlan?.steps) ? rawPlan.steps : [];
  const normalizedSteps = rawSteps
    .map((rawStep, index) => normalizeGuidedWalkthroughStep(rawStep, index))
    .filter(Boolean);

  if (normalizedSteps.length === 0) {
    throw new Error("Guided walkthrough did not include any usable steps.");
  }

  return {
    title: String(rawPlan?.title || "guided walkthrough").trim() || "guided walkthrough",
    spokenIntro: String(rawPlan?.spokenIntro || "").trim(),
    steps: normalizedSteps
  };
}

export function getGuidedWalkthroughStep(session) {
  const steps = Array.isArray(session?.steps) ? session.steps : [];
  const currentStepIndex = Number.isInteger(session?.currentStepIndex) ? session.currentStepIndex : 0;
  return steps[currentStepIndex] || null;
}

export function buildGuidedWalkthroughSystemPrompt({ preferredLanguage, contextAwareInstruction }) {
  return `
you are clicky in guided walkthrough mode. you can see the user's screens and your goal is to turn the current task into a short step-by-step walkthrough.

rules:
- respond with strict json only. no markdown.
- keep the walkthrough short and concrete. use between two and five steps.
- each step must be something the user can do right now.
- each step's instruction should sound natural when spoken aloud.
- ground the walkthrough in the visible interface first. do not invent hidden prerequisites like a rest api, localhost port, plugin, or extension unless the screen clearly shows one.
- each step instruction must end with a valid point tag in the format [POINT:x,y:label], [POINT:x,y:label:screenN], or [POINT:none].
- if later steps are uncertain without more screen changes, still give the best likely sequence based on what you can see now.
- do not mention json, schemas, or internal formatting.
- use the user's preferred language when known. right now that is: ${preferredLanguage || "en"}.

json schema:
{
  "title": "short walkthrough name",
  "spokenIntro": "one short sentence introducing the walkthrough",
  "steps": [
    {
      "title": "short step title",
      "instruction": "spoken instruction ending with a point tag"
    }
  ]
}

${contextAwareInstruction || ""}
  `.trim();
}

export function normalizeGuidedWalkthroughStep(rawStep, index) {
  if (!rawStep || typeof rawStep !== "object") {
    return null;
  }

  const title = String(rawStep.title || `step ${index + 1}`).trim() || `step ${index + 1}`;
  const rawInstruction = String(rawStep.instruction || rawStep.spokenText || "").trim();
  const pointTag = String(rawStep.pointTag || "").trim();
  const instructionWithPointTag = ensurePointTag(rawInstruction, pointTag);

  if (!instructionWithPointTag) {
    return null;
  }

  return {
    title,
    instruction: instructionWithPointTag
  };
}

function ensurePointTag(instruction, pointTag) {
  const trimmedInstruction = String(instruction || "").trim();
  const trimmedPointTag = String(pointTag || "").trim();

  if (trimmedInstruction && pointTagPattern.test(trimmedInstruction)) {
    return trimmedInstruction;
  }

  if (trimmedInstruction && trimmedPointTag && pointTagPattern.test(trimmedPointTag)) {
    return `${trimmedInstruction} ${trimmedPointTag}`.trim();
  }

  if (!trimmedInstruction) {
    return trimmedPointTag && pointTagPattern.test(trimmedPointTag)
      ? `focus on the next visible action. ${trimmedPointTag}`
      : "";
  }

  return `${trimmedInstruction} [POINT:none]`;
}
