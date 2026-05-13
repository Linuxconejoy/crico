const pointTagPattern = /\[POINT:(?:none|(\d+)\s*,\s*(\d+)(?::([^\]:\s][^\]:]*?))?(?::screen(\d+))?)\]\s*$/;

export function parsePointingCoordinates(responseText) {
  const match = responseText.match(pointTagPattern);

  if (!match) {
    return {
      spokenText: responseText.trim(),
      coordinate: null,
      elementLabel: null,
      screenNumber: null
    };
  }

  const spokenText = responseText.slice(0, match.index).trim();
  const [, xValue, yValue, labelValue, screenValue] = match;

  if (!xValue || !yValue) {
    return {
      spokenText,
      coordinate: null,
      elementLabel: "none",
      screenNumber: null
    };
  }

  return {
    spokenText,
    coordinate: {
      x: Number(xValue),
      y: Number(yValue)
    },
    elementLabel: labelValue ? labelValue.trim() : null,
    screenNumber: screenValue ? Number(screenValue) : null
  };
}

export function pickTargetCapture(screenCaptures, screenNumber) {
  if (screenNumber && screenNumber >= 1 && screenNumber <= screenCaptures.length) {
    return screenCaptures[screenNumber - 1];
  }

  return screenCaptures.find((capture) => capture.isCursorScreen) ?? screenCaptures[0] ?? null;
}

export function mapScreenshotPointToDisplay(coordinate, capture) {
  if (!coordinate || !capture) {
    return null;
  }

  const screenshotWidth = capture.screenshotWidthInPixels;
  const screenshotHeight = capture.screenshotHeightInPixels;
  const displayWidth = capture.displayBounds.width;
  const displayHeight = capture.displayBounds.height;

  const clampedX = clamp(coordinate.x, 0, screenshotWidth);
  const clampedY = clamp(coordinate.y, 0, screenshotHeight);

  return {
    x: capture.displayBounds.x + (clampedX * displayWidth) / screenshotWidth,
    y: capture.displayBounds.y + (clampedY * displayHeight) / screenshotHeight
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
