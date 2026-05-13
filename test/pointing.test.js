import test from "node:test";
import assert from "node:assert/strict";

import {
  mapScreenshotPointToDisplay,
  parsePointingCoordinates,
  pickTargetCapture
} from "../src/shared/pointing.js";

test("parsePointingCoordinates returns trimmed spoken text when there is no point tag", () => {
  assert.deepEqual(parsePointingCoordinates("  explain closures in javascript  "), {
    spokenText: "explain closures in javascript",
    coordinate: null,
    elementLabel: null,
    screenNumber: null
  });
});

test("parsePointingCoordinates handles [POINT:none] without leaking the tag into speech", () => {
  assert.deepEqual(parsePointingCoordinates("click the save button [POINT:none]   "), {
    spokenText: "click the save button",
    coordinate: null,
    elementLabel: "none",
    screenNumber: null
  });
});

test("parsePointingCoordinates parses coordinates, label, and explicit screen number", () => {
  assert.deepEqual(
    parsePointingCoordinates("the menu is up here [POINT:1100,42:color inspector:screen2]"),
    {
      spokenText: "the menu is up here",
      coordinate: {
        x: 1100,
        y: 42
      },
      elementLabel: "color inspector",
      screenNumber: 2
    }
  );
});

test("parsePointingCoordinates supports unlabeled coordinates", () => {
  assert.deepEqual(parsePointingCoordinates("it's near the toolbar [POINT:640,128]"), {
    spokenText: "it's near the toolbar",
    coordinate: {
      x: 640,
      y: 128
    },
    elementLabel: null,
    screenNumber: null
  });
});

test("pickTargetCapture prefers the explicitly addressed screen when valid", () => {
  const screenCaptures = [
    { id: "screen-1", isCursorScreen: false },
    { id: "screen-2", isCursorScreen: true }
  ];

  assert.equal(pickTargetCapture(screenCaptures, 1), screenCaptures[0]);
  assert.equal(pickTargetCapture(screenCaptures, 2), screenCaptures[1]);
});

test("pickTargetCapture falls back to the cursor screen and then the first screen", () => {
  const cursorScreenCaptures = [
    { id: "screen-1", isCursorScreen: false },
    { id: "screen-2", isCursorScreen: true },
    { id: "screen-3", isCursorScreen: false }
  ];
  const noCursorScreenCaptures = [
    { id: "screen-1", isCursorScreen: false },
    { id: "screen-2", isCursorScreen: false }
  ];

  assert.equal(pickTargetCapture(cursorScreenCaptures, 99), cursorScreenCaptures[1]);
  assert.equal(pickTargetCapture(noCursorScreenCaptures, null), noCursorScreenCaptures[0]);
  assert.equal(pickTargetCapture([], null), null);
});

test("mapScreenshotPointToDisplay scales coordinates into display space", () => {
  const capture = {
    screenshotWidthInPixels: 2000,
    screenshotHeightInPixels: 1000,
    displayBounds: {
      x: 100,
      y: 50,
      width: 1000,
      height: 500
    }
  };

  assert.deepEqual(mapScreenshotPointToDisplay({ x: 500, y: 250 }, capture), {
    x: 350,
    y: 175
  });
});

test("mapScreenshotPointToDisplay clamps out-of-bounds screenshot coordinates", () => {
  const capture = {
    screenshotWidthInPixels: 1000,
    screenshotHeightInPixels: 500,
    displayBounds: {
      x: 20,
      y: 40,
      width: 200,
      height: 100
    }
  };

  assert.deepEqual(mapScreenshotPointToDisplay({ x: -50, y: 9999 }, capture), {
    x: 20,
    y: 140
  });
  assert.equal(mapScreenshotPointToDisplay(null, capture), null);
  assert.equal(mapScreenshotPointToDisplay({ x: 10, y: 10 }, null), null);
});
