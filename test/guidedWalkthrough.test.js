import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGuidedWalkthroughSystemPrompt,
  getGuidedWalkthroughStep,
  normalizeGuidedWalkthroughPlan
} from "../src/panel/guidedWalkthrough.js";

test("normalizeGuidedWalkthroughPlan keeps usable steps and fills missing point tags", () => {
  const walkthroughPlan = normalizeGuidedWalkthroughPlan({
    title: "publish release",
    spokenIntro: "let's walk through it.",
    steps: [
      {
        title: "open settings",
        instruction: "open the settings panel"
      },
      {
        title: "check updates",
        instruction: "click the updates button [POINT:120,48:updates]"
      }
    ]
  });

  assert.equal(walkthroughPlan.title, "publish release");
  assert.equal(walkthroughPlan.steps.length, 2);
  assert.match(walkthroughPlan.steps[0].instruction, /\[POINT:none\]$/);
  assert.match(walkthroughPlan.steps[1].instruction, /\[POINT:120,48:updates\]$/);
});

test("normalizeGuidedWalkthroughPlan supports pointTag as a separate field", () => {
  const walkthroughPlan = normalizeGuidedWalkthroughPlan({
    steps: [
      {
        title: "find terminal",
        instruction: "look at the terminal on the other monitor",
        pointTag: "[POINT:400,300:terminal:screen2]"
      }
    ]
  });

  assert.match(
    walkthroughPlan.steps[0].instruction,
    /\[POINT:400,300:terminal:screen2\]$/
  );
});

test("normalizeGuidedWalkthroughPlan rejects empty step lists", () => {
  assert.throws(
    () => normalizeGuidedWalkthroughPlan({ title: "empty", steps: [] }),
    /did not include any usable steps/
  );
});

test("getGuidedWalkthroughStep returns the current indexed step", () => {
  const step = getGuidedWalkthroughStep({
    currentStepIndex: 1,
    steps: [
      { title: "step one", instruction: "first [POINT:none]" },
      { title: "step two", instruction: "second [POINT:none]" }
    ]
  });

  assert.deepEqual(step, {
    title: "step two",
    instruction: "second [POINT:none]"
  });
});

test("buildGuidedWalkthroughSystemPrompt bakes in language and schema rules", () => {
  const systemPrompt = buildGuidedWalkthroughSystemPrompt({
    preferredLanguage: "es",
    contextAwareInstruction: "adapt to the focused coding context."
  });

  assert.match(systemPrompt, /strict json only/);
  assert.match(systemPrompt, /preferred language when known\. right now that is: es/);
  assert.match(systemPrompt, /adapt to the focused coding context\./);
  assert.match(systemPrompt, /each step instruction must end with a valid point tag/);
});
