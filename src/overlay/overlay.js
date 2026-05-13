const overlayRoot = document.querySelector("#overlay-root");
const buddyAnchor = document.querySelector("#buddy-anchor");
const buddyBubble = document.querySelector("#buddy-bubble");
const buddyBubbleText = document.querySelector("#buddy-bubble-text");
const buddySpinner = document.querySelector("#buddy-spinner");

const state = {
  cursorPoint: { x: 32, y: 32 },
  currentMode: "idle",
  latestMessage: "",
  isVisible: true,
  activePoint: null
};

window.clicky.onOverlayCursor((cursorPoint) => {
  state.cursorPoint = cursorPoint;
  if (!state.activePoint) {
    moveBuddyTo(state.cursorPoint.x + 26, state.cursorPoint.y + 24);
  }
});

window.clicky.onOverlayState((payload) => {
  if (payload.type === "hide") {
    state.isVisible = false;
    state.activePoint = null;
    render();
    return;
  }

  if (payload.type === "clear-point") {
    state.activePoint = null;
    render();
    return;
  }

  if (payload.type === "point") {
    state.activePoint = {
      x: payload.x,
      y: payload.y,
      label: payload.label,
      spokenText: payload.spokenText
    };
    state.isVisible = true;
    state.currentMode = "pointing";
    render();
    window.setTimeout(() => {
      state.activePoint = null;
      render();
    }, 3200);
    return;
  }

  if (payload.type === "state") {
    state.isVisible = payload.visible;
    state.currentMode = payload.mode;
    state.latestMessage = payload.message || "";
    render();
  }
});

function render() {
  overlayRoot.classList.toggle("hidden", !state.isVisible);

  const bubbleText = buildBubbleText();
  buddyBubbleText.textContent = bubbleText;
  buddyBubble.classList.toggle("hidden", !bubbleText);
  buddySpinner.classList.toggle("hidden", state.currentMode !== "processing");

  if (state.activePoint) {
    moveBuddyTo(state.activePoint.x, state.activePoint.y);
  } else {
    moveBuddyTo(state.cursorPoint.x + 26, state.cursorPoint.y + 24);
  }
}

function buildBubbleText() {
  if (state.currentMode === "listening") {
    return "listening...";
  }

  if (state.currentMode === "processing") {
    return "thinking...";
  }

  if (state.activePoint?.label) {
    return state.activePoint.label;
  }

  if (state.currentMode === "responding") {
    return state.latestMessage;
  }

  return "";
}

function moveBuddyTo(x, y) {
  buddyAnchor.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
}
