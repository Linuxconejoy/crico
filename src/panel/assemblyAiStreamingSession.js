const targetSampleRate = 16000;
const finalTranscriptTimeoutMilliseconds = 2800;

export class AssemblyAIStreamingSession {
  constructor({ workerBaseUrl, onTranscriptUpdate }) {
    this.workerBaseUrl = workerBaseUrl;
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.webSocket = null;
    this.audioContext = null;
    this.microphoneStream = null;
    this.microphoneSource = null;
    this.scriptProcessor = null;
    this.latestTranscriptText = "";
    this.latestNonEmptyTranscriptText = "";
    this.pendingFinalTranscriptResolver = null;
    this.pendingFinalTranscriptTimeout = null;
    this.hasOpenedWebSocket = false;
    this.isCleaningUp = false;
  }

  async start() {
    const { token } = await window.clicky.getTranscribeToken(this.workerBaseUrl);
    await this.openWebSocket(token);
    await this.startMicrophoneCapture();
  }

  async stopAndFinalize() {
    const finalTranscriptPromise = new Promise((resolve) => {
      this.pendingFinalTranscriptResolver = resolve;
      this.pendingFinalTranscriptTimeout = globalThis.setTimeout(() => {
        this.resolveFinalTranscript(this.getResolvedTranscriptText());
      }, finalTranscriptTimeoutMilliseconds);
    });

    try {
      if (this.webSocket?.readyState === WebSocket.OPEN) {
        this.webSocket.send(JSON.stringify({ type: "ForceEndpoint" }));
      }
    } catch (error) {
      console.warn("AssemblyAI finalize request failed:", error);
    }

    this.stopAudioCapture();
    const finalTranscript = await finalTranscriptPromise;
    this.cleanup();
    return finalTranscript.trim();
  }

  cancel() {
    this.resolveFinalTranscript("");
    this.cleanup();
  }

  async openWebSocket(token) {
    const websocketUrl = new URL("wss://streaming.assemblyai.com/v3/ws");
    websocketUrl.searchParams.set("sample_rate", String(targetSampleRate));
    websocketUrl.searchParams.set("token", token);
    websocketUrl.searchParams.set("format_turns", "true");
    websocketUrl.searchParams.set("speech_model", "universal-streaming-english");

    await new Promise((resolve, reject) => {
      let hasSettledHandshake = false;
      const handshakeTimeout = window.setTimeout(() => {
        settleHandshakeWithError("AssemblyAI websocket timed out before opening.");
      }, 10000);

      const settleHandshakeAsOpen = () => {
        if (hasSettledHandshake) {
          return;
        }

        hasSettledHandshake = true;
        window.clearTimeout(handshakeTimeout);
        resolve();
      };

      const settleHandshakeWithError = (message) => {
        if (hasSettledHandshake) {
          return;
        }

        hasSettledHandshake = true;
        window.clearTimeout(handshakeTimeout);
        reject(new Error(message));
      };

      this.hasOpenedWebSocket = false;
      this.isCleaningUp = false;
      this.webSocket = new WebSocket(websocketUrl.toString());

      this.webSocket.addEventListener("open", () => {
        this.hasOpenedWebSocket = true;
        settleHandshakeAsOpen();
      });

      this.webSocket.addEventListener("error", () => {
        if (!this.hasOpenedWebSocket && this.webSocket?.readyState === WebSocket.CLOSED && !this.isCleaningUp) {
          settleHandshakeWithError("AssemblyAI websocket could not be opened.");
        }
      });

      this.webSocket.addEventListener("message", (event) => {
        this.handleWebSocketMessage(event.data);
      });

      this.webSocket.addEventListener("close", (event) => {
        if (!this.hasOpenedWebSocket && !this.isCleaningUp) {
      const closeReasonSuffix = event.reason ? `: ${event.reason}` : "";
      settleHandshakeWithError(`AssemblyAI websocket closed before opening (code ${event.code}${closeReasonSuffix}).`);
      return;
    }

    if (!this.pendingFinalTranscriptResolver) {
      return;
    }

    this.resolveFinalTranscript(this.getResolvedTranscriptText());
  });
    });
  }

  async startMicrophoneCapture() {
    this.microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    this.audioContext = new AudioContext();
    this.microphoneSource = this.audioContext.createMediaStreamSource(this.microphoneStream);
    this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.scriptProcessor.onaudioprocess = (event) => {
      if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
        return;
      }

      const inputBuffer = event.inputBuffer;
      const monoChannelData = inputBuffer.getChannelData(0);
      const pcm16Buffer = convertFloat32ToPCM16Buffer(monoChannelData, this.audioContext.sampleRate);

      if (pcm16Buffer.byteLength > 0) {
        this.webSocket.send(pcm16Buffer);
      }
    };

    this.microphoneSource.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioContext.destination);
  }

  handleWebSocketMessage(messageText) {
    let payload;
    try {
      payload = JSON.parse(messageText);
    } catch {
      return;
    }

    if (payload.type !== "Turn") {
      return;
    }

    if (typeof payload.transcript === "string") {
      const normalizedTranscript = payload.transcript.trim();
      if (normalizedTranscript) {
        this.latestTranscriptText = normalizedTranscript;
        this.latestNonEmptyTranscriptText = normalizedTranscript;
        this.onTranscriptUpdate?.(normalizedTranscript);
      }
    }

    if (payload.end_of_turn) {
      this.resolveFinalTranscript(this.getResolvedTranscriptText());
    }
  }

  stopAudioCapture() {
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor.onaudioprocess = null;
      this.scriptProcessor = null;
    }

    if (this.microphoneSource) {
      this.microphoneSource.disconnect();
      this.microphoneSource = null;
    }

    if (this.microphoneStream) {
      for (const track of this.microphoneStream.getTracks()) {
        track.stop();
      }
      this.microphoneStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }

  resolveFinalTranscript(finalTranscriptText) {
    if (!this.pendingFinalTranscriptResolver) {
      return;
    }

    globalThis.clearTimeout(this.pendingFinalTranscriptTimeout);
    this.pendingFinalTranscriptTimeout = null;

    const resolver = this.pendingFinalTranscriptResolver;
    this.pendingFinalTranscriptResolver = null;
    resolver(finalTranscriptText);
  }

  getResolvedTranscriptText() {
    return this.latestNonEmptyTranscriptText || this.latestTranscriptText.trim();
  }

  cleanup() {
    this.stopAudioCapture();

    if (this.webSocket) {
      try {
        this.isCleaningUp = true;
        if (this.webSocket.readyState === WebSocket.OPEN) {
          this.webSocket.send(JSON.stringify({ type: "Terminate" }));
        }
        this.webSocket.close();
      } catch (error) {
        console.warn("AssemblyAI websocket close failed:", error);
      }
      this.webSocket = null;
    }

    this.hasOpenedWebSocket = false;
  }
}

function convertFloat32ToPCM16Buffer(float32Samples, inputSampleRate) {
  if (!float32Samples?.length) {
    return new ArrayBuffer(0);
  }

  const sampleRateRatio = inputSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.round(float32Samples.length / sampleRateRatio));
  const pcm16Samples = new Int16Array(outputLength);

  let inputIndex = 0;

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const nextInputIndex = Math.round((outputIndex + 1) * sampleRateRatio);
    let accumulatedSample = 0;
    let sampleCount = 0;

    for (let channelSampleIndex = Math.round(inputIndex); channelSampleIndex < nextInputIndex && channelSampleIndex < float32Samples.length; channelSampleIndex += 1) {
      accumulatedSample += float32Samples[channelSampleIndex];
      sampleCount += 1;
    }

    const averagedSample = sampleCount > 0
      ? accumulatedSample / sampleCount
      : float32Samples[Math.min(Math.round(inputIndex), float32Samples.length - 1)];

    const clampedSample = Math.max(-1, Math.min(1, averagedSample));
    pcm16Samples[outputIndex] = clampedSample < 0
      ? clampedSample * 0x8000
      : clampedSample * 0x7fff;

    inputIndex = nextInputIndex;
  }

  return pcm16Samples.buffer;
}
