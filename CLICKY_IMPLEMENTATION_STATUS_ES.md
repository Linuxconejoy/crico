# Clicky - Estado de Implementacion Aplicado

Fecha: 2026-05-07

Este documento resume lo que ya fue aplicado en codigo sobre la base de la auditoria de `CLICKY_AUDIT_ES.md`.

## Alcance ejecutado

Se implemento el bloque fundacional `P0` orientado a seguridad, readiness del backend y defaults mas seguros.

No se implementaron en esta ronda las iniciativas `P1` y `P2` de expansion funcional, porque requieren un ciclo aparte de producto, UX y validacion multiplataforma.

## Segunda ronda aplicada

Despues del bloque `P0`, se ejecuto una segunda ronda selectiva de `P1` enfocada en cuatro objetivos:

- controles reales de privacidad y retencion en Windows
- optimizacion segura de captura en background sin romper el pointing
- memoria educativa ligera en macOS
- hygiene de updates y observabilidad operativa del Worker

## Tercera ronda aplicada

Despues de consolidar `P0` y la primera tanda de `P1`, se ejecuto una tercera ronda enfocada en:

- approvals seguras para acciones sensibles del agent mode en Windows
- primer guided walkthrough utilizable sobre el pointing ya existente
- tests automatizados del Worker
- micro-mejora de guided UX en macOS
- documentacion operativa del Worker

## Cambios aplicados

### 1. Worker protegido y validado

Archivos:
- `worker/src/index.ts`
- `worker/wrangler.toml`

Cambios:
- Header fijo de autenticacion de app: `x-clicky-app-key`
- Secreto opcional del backend: `CLICKY_APP_KEY`
- Rate limiting por ruta e IP de cliente
- Limites de tamano de payload por endpoint
- Validacion estricta de JSON y contenido
- Validacion minima de payloads de `/chat` y `/tts`
- Endpoint `GET /health` para readiness operativa
- Respuestas de error mas controladas y sin filtrar secretos

### 2. Windows con defaults seguros y chequeo real de backend

Archivos:
- `windows-app/src/main/configStore.js`
- `windows-app/src/main/main.js`
- `windows-app/src/panel/panel.js`
- `windows-app/src/panel/panel.html`

Cambios:
- `agentModeEnabled`, `visualHistoryEnabled` y `autoTriggersEnabled` quedan `false` por defecto
- Nuevo soporte para header de autenticacion configurable
- Validacion de URL del Worker antes de usar voz, chat o TTS
- Estado de readiness visible en UI
- Test activo de `/chat`, `/tts` y `/transcribe-token`
- Mensajes de onboarding tecnico cuando el backend no esta listo

### 3. Windows agent mode endurecido

Archivos:
- `windows-app/src/main/agentTools.js`
- `windows-app/src/shared/agentToolDefinitions.js`

Cambios:
- Restriccion de paths a roots aprobados del workspace
- `open_path` bloquea ejecutables y archivos peligrosos
- `write_file` solo permite escritura de archivos de texto y dentro del workspace permitido
- `run_command` queda limitado a inspeccion read-only
- Bloqueo de pipes, chaining, redirecciones y patrones destructivos
- Allowlist de comandos y subcomandos `git`

### 4. macOS con backend configurable y readiness visible

Archivos:
- `leanring-buddy/AppBundleConfiguration.swift`
- `leanring-buddy/Info.plist`
- `leanring-buddy/CompanionManager.swift`
- `leanring-buddy/AssemblyAIStreamingTranscriptionProvider.swift`
- `leanring-buddy/ClaudeAPI.swift`
- `leanring-buddy/ElevenLabsTTSClient.swift`

Cambios:
- La URL del Worker ya no queda hardcodeada: sale de `Info.plist`
- Nuevo `ClickyWorkerAppKey` para auth cliente -> Worker
- Readiness real del backend antes de asumir que STT esta disponible
- Header `x-clicky-app-key` enviado desde chat, TTS y transcribe token
- Mensaje de estado del backend visible desde el panel
- Correccion del flujo TTS para no volver a `idle` antes de terminar el audio

### 5. macOS con consentimiento explicito para analytics y login item

Archivos:
- `leanring-buddy/CompanionPanelView.swift`
- `leanring-buddy/ClickyAnalytics.swift`
- `leanring-buddy/leanring_buddyApp.swift`

Cambios:
- `Share analytics` queda apagado por defecto
- `Launch at Login` queda apagado por defecto
- El boton `Start` ya no exige email
- Analytics solo se inicializa y envia eventos si el usuario hace opt-in
- Login item sincronizado con preferencia explicita del usuario

### 6. Windows con privacidad y memoria mas controlables

Archivos:
- `windows-app/src/main/configStore.js`
- `windows-app/src/main/memoryStore.js`
- `windows-app/src/main/main.js`
- `windows-app/src/main/preload.cjs`
- `windows-app/src/main/screenCapture.js`
- `windows-app/src/panel/panel.js`
- `windows-app/src/panel/panel.html`
- `windows-app/src/panel/panel.css`

Cambios:
- Nuevo `visualHistoryRetentionDays` con poda automatica al arrancar y al guardar settings
- Borrado granular desde UI:
  - reset de profile memory
  - limpieza de app context history
  - limpieza total de visual history
  - borrado total de memoria persistente
  - borrado por item dentro de visual history
- `clear chat` se mantiene separado del storage persistente para no mezclar alcances
- Nuevo `screenCaptureMode` para background watcher
- Los prompts interactivos siguen en `all-displays` para no romper la precision del pointing
- El proactive watcher puede reducir exposicion/costo usando `cursor-display`

### 7. Windows con tests utiles

Archivos:
- `windows-app/package.json`
- `windows-app/test/pointing.test.js`
- `windows-app/test/contextSummaries.test.js`

Cambios:
- Test suite built-in con `node --test`
- Cobertura inicial para:
  - parsing de `[POINT]`
  - seleccion de target capture
  - mapeo de coordenadas screenshot -> display
  - summaries de contexto, memoria y visual history

### 8. Worker con mejor observabilidad

Archivos:
- `worker/src/index.ts`
- `worker/wrangler.toml`

Cambios:
- `requestId` consistente y reusable via headers
- Headers operativos en todas las respuestas
- Metadata de rate limiting expuesta de forma util
- `/health` mucho mas diagnostico
- Errores con trazabilidad y sanitizacion defensiva
- Metadata no secreta de entorno/version via `WORKER_ENVIRONMENT` y `WORKER_VERSION`

### 9. macOS con memoria educativa ligera

Archivos:
- `leanring-buddy/ClickyLearningProfile.swift`
- `leanring-buddy/CompanionManager.swift`
- `leanring-buddy/CompanionPanelView.swift`

Cambios:
- Perfil local persistente con:
  - preferred language
  - teaching style
  - learning focus
  - durable context
- Ese perfil entra al prompt activo y adapta respuestas de Clicky
- El panel muestra cuando hay memoria activa y permite limpiar el perfil

### 10. macOS con update path menos riesgoso

Archivos:
- `leanring-buddy/leanring_buddyApp.swift`
- `leanring-buddy/Info.plist`

Cambios:
- Metadata legacy de Sparkle reemplazada por placeholders explicitos
- `ClickyUpdatesEnabled = false` por defecto
- `SUEnableAutomaticChecks = false`
- `SUAutomaticallyUpdate = false`
- Sparkle solo arranca si feed URL y public key pasan validacion explicita
- Limpieza de overrides legacy en `UserDefaults`

### 11. Windows con approvals seguras para agent mode

Archivos:
- `windows-app/src/main/main.js`
- `windows-app/src/main/preload.cjs`
- `windows-app/src/panel/agentApproval.js`
- `windows-app/src/panel/agentLoop.js`
- `windows-app/src/panel/panel.js`
- `windows-app/src/panel/panel.html`
- `windows-app/src/panel/panel.css`

Cambios:
- El gate real de approval vive en `main.js`
- `open_path` y `write_file` ya no se ejecutan sin decision explicita del usuario
- El panel recibe requests de approval y responde con `approve` o `deny`
- El panel no se oculta por blur mientras exista una approval pendiente
- Si el usuario niega la accion, el agente recibe un `tool_result` bloqueado y puede continuar o reformular

### 12. Windows con primer guided walkthrough

Archivos:
- `windows-app/src/main/configStore.js`
- `windows-app/src/panel/guidedWalkthrough.js`
- `windows-app/src/panel/panel.js`
- `windows-app/src/panel/panel.html`

Cambios:
- Nuevo toggle `guidedWalkthroughEnabled`
- Clicky puede convertir una peticion en una secuencia guiada corta
- El panel muestra:
  - titulo del walkthrough
  - paso actual
  - `repeat`
  - `next step`
  - `end walkthrough`
- El walkthrough reutiliza el pointing existente y no cambia el contrato de `[POINT]`

### 13. Worker con tests reales

Archivos:
- `worker/package.json`
- `worker/test/index.test.mjs`

Cambios:
- Base de tests con runner nativo de Node
- Cobertura para:
  - `/health`
  - fallback de `requestId`
  - auth requerida
  - rate limiting
  - errores de parsing
  - sanitizacion y trazabilidad de upstream

### 14. Worker con documentacion operativa

Archivos:
- `README.md`
- `worker/README.md`

Cambios:
- Documentacion actualizada del contrato del Worker
- Flujo de setup, deploy, smoke tests y observabilidad
- Explicacion de `CLICKY_APP_KEY`, `/health` y headers operativos

### 15. macOS con CTA guiado despues del pointing

Archivos:
- `leanring-buddy/ClickyLearningProfile.swift`
- `leanring-buddy/CompanionManager.swift`
- `leanring-buddy/OverlayWindow.swift`

Cambios:
- Cuando Clicky apunta a un elemento en macOS, ahora puede mostrar un hint visual para continuar en modo guiado
- El hint se adapta al learning profile y al idioma preferido
- No interfiere con onboarding ni con el pipeline principal de voz

## Configuracion requerida para dejarlo operativo

### Worker

Definir en Cloudflare:
- `ANTHROPIC_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `ASSEMBLYAI_API_KEY`

Opcional pero recomendado:
- secreto `CLICKY_APP_KEY`

### Windows

En Settings:
- `Worker URL`
- `Worker auth header name`: `x-clicky-app-key`
- `Worker auth header value`: mismo valor de `CLICKY_APP_KEY`

Despues correr `test backend` hasta que `/chat`, `/tts` y `/transcribe-token` queden en `ready`.

### macOS

En `Info.plist`:
- `ClickyWorkerBaseURL`
- `ClickyWorkerAppKey`

El valor de `ClickyWorkerAppKey` debe coincidir con el secreto `CLICKY_APP_KEY` del Worker cuando ese secreto este configurado.

## Verificacion ejecutada

- `windows-app`: `npm run check` paso correctamente
- `windows-app`: los tests nuevos de `node --test` pasaron correctamente
- `windows-app`: `26` tests verdes despues de approvals + guided walkthrough
- `worker`: revision manual del codigo endurecido, sin compilacion automatizada local disponible en este entorno
- `worker`: `npm test` paso con `8` tests verdes
- `macOS`: revision estatica y de coherencia; no se corrio `xcodebuild` para no invalidar permisos TCC del entorno

## Pendiente para una siguiente ronda

- Testing automatizado del Worker
- Packaging y smoke test del build macOS
- Persistencia segura de secretos en Windows
- Unificacion de memoria/contexto entre macOS y Windows
- Guided walkthrough mas robusto con refresco por paso y validacion de cambio de pantalla
- Expansion funcional `P1` y `P2`
