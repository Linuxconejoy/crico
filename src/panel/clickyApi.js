export async function streamClaudeResponse({
  requestId,
  workerBaseUrl,
  requestBody,
  onTextChunk
}) {
  return new Promise((resolve, reject) => {
    const unsubscribe = window.clicky.onChatEvent((event) => {
      if (event.requestId !== requestId) {
        return;
      }

      if (event.type === "delta") {
        onTextChunk?.(event.accumulatedText);
        return;
      }

      unsubscribe();

      if (event.type === "done") {
        resolve(event.accumulatedText);
        return;
      }

      if (event.type === "aborted") {
        reject(new Error("Chat request aborted."));
        return;
      }

      reject(new Error(event.message || "Unknown chat request error."));
    });

    window.clicky.startChatStream({
      requestId,
      workerBaseUrl,
      requestBody
    });
  });
}

export async function fetchTTSAudio({ workerBaseUrl, text }) {
  return window.clicky.fetchTTSAudio({
    workerBaseUrl,
    text
  });
}
