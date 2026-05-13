import { desktopCapturer, screen } from "electron";

const maxThumbnailSize = 1280;
const defaultCaptureMode = "all-displays";

export async function captureScreensAsJpeg({ mode = defaultCaptureMode } = {}) {
  const cursorPoint = screen.getCursorScreenPoint();
  const displays = screen.getAllDisplays();
  const cursorDisplay = screen.getDisplayNearestPoint(cursorPoint);

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: maxThumbnailSize,
      height: maxThumbnailSize
    },
    fetchWindowIcons: false
  });

  const sortedDisplays = [...displays].sort((displayA, displayB) => {
    const aIsCursorDisplay = displayA.id === cursorDisplay.id;
    const bIsCursorDisplay = displayB.id === cursorDisplay.id;

    if (aIsCursorDisplay !== bIsCursorDisplay) {
      return aIsCursorDisplay ? -1 : 1;
    }

    return displayA.id - displayB.id;
  });

  const targetDisplays = mode === "cursor-display"
    ? sortedDisplays.filter((display) => display.id === cursorDisplay.id)
    : sortedDisplays;

  return targetDisplays
    .map((display, index) => {
      const matchingSource = sources.find((source) => {
        if (String(source.display_id) === String(display.id)) {
          return true;
        }

        return source.id.startsWith(`screen:${display.id}:`);
      });

      if (!matchingSource || matchingSource.thumbnail.isEmpty()) {
        return null;
      }

      const screenshotSize = matchingSource.thumbnail.getSize();
      const imageBuffer = matchingSource.thumbnail.toJPEG(80);
      const isCursorScreen = display.id === cursorDisplay.id;

      let label = "user's screen (cursor is here)";

      if (targetDisplays.length > 1) {
        label = isCursorScreen
          ? `screen ${index + 1} of ${targetDisplays.length} - cursor is on this screen (primary focus)`
          : `screen ${index + 1} of ${targetDisplays.length} - secondary screen`;
      }

      return {
        imageBase64: imageBuffer.toString("base64"),
        mediaType: "image/jpeg",
        label,
        isCursorScreen,
        displayBounds: {
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height
        },
        screenshotWidthInPixels: screenshotSize.width,
        screenshotHeightInPixels: screenshotSize.height
      };
    })
    .filter(Boolean);
}

export async function captureAllScreensAsJpeg() {
  return captureScreensAsJpeg({ mode: "all-displays" });
}
