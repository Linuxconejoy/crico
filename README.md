# Clicky for Windows

This is a native Windows desktop build of Clicky using Electron. It reuses the same Cloudflare Worker as the macOS app, so your Anthropic, AssemblyAI, and ElevenLabs keys still stay on the server.

## What it includes

- System tray app with a floating control panel
- Global push-to-talk using `Ctrl + Alt`
- Screen capture across all connected displays
- Claude streaming chat through the existing `/chat` worker route
- ElevenLabs playback through the existing `/tts` worker route
- AssemblyAI real-time transcription through the existing `/transcribe-token` worker route
- Transparent always-on-top overlay with a cursor companion that can point to `[POINT:x,y:label]` targets
- Manual prompt box as a fallback when you want to test without voice

## Setup

1. Make sure the Cloudflare Worker from the root project is already deployed.
2. In the root repo, open `windows-app`.
3. Install dependencies:

```bash
npm install
```

4. Start the app:

```bash
npm start
```

5. Paste your worker URL into the settings panel the first time you run it.

Example:

```text
https://your-worker-name.your-subdomain.workers.dev
```

## Notes

- The overlay is intentionally click-through so it never steals focus.
- If you turn off `Show Clicky when idle`, the companion only appears during active interactions.
- The manual prompt still captures your screen, so it is useful for testing the pointing flow without touching the microphone.
- Packaging is available with `npm run dist`.

## Packaging outputs

- `npm run dist` builds both the NSIS installer and the portable executable.
- `npm run dist:installer` builds only the installer.
- `npm run dist:portable` builds only the portable executable.

Expected artifacts in `dist/`:

- `Clicky Setup <version>.exe`
- `Clicky Portable <version>.exe`
- `win-unpacked/Clicky.exe`

## Windows signing

Electron Builder will sign the Windows artifacts automatically when one of these environment-variable pairs is present:

- `CSC_LINK` + `CSC_KEY_PASSWORD`
- `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD`

`CSC_LINK` or `WIN_CSC_LINK` can point to a local `.pfx` file or a remote certificate URL. If those variables are missing, the build still succeeds but the resulting `.exe` remains unsigned and Windows SmartScreen can warn on first launch.
