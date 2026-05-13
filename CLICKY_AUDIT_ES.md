# Clicky Product Audit

Fecha: 2026-05-07

## Executive Summary

Clicky ya valida su idea central: un companion de IA que observa la pantalla, escucha al usuario, responde con voz y puede senalar elementos de interfaz. La base actual tiene dos productos con madurez desigual:

- macOS esta mas pulido en la experiencia principal de "buddy" y pointing.
- Windows es mas ambicioso: agrega memoria persistente, historial visual, nudges proactivos y agent mode.
- El Cloudflare Worker cumple como proxy minimo, pero hoy es demasiado fino para un producto que quiera escalar con control de costo, seguridad y observabilidad.

El problema principal no es falta de features. El problema principal es que Clicky sigue teniendo forma de prototipo avanzado:

- configuracion critica hardcodeada o inconsistente
- defaults demasiado agresivos para privacidad y seguridad
- poca cobertura automatizada
- fuerte brecha funcional entre macOS y Windows
- release/update story incompleta o heredada

La recomendacion general es:

1. cerrar P0 de confiabilidad, privacidad y seguridad
2. unificar capacidades core entre plataformas
3. despues expandir hacia memoria inteligente, coaching educativo y colaboracion guiada

## Estado Actual Confirmado

### Funciones core presentes

- Push-to-talk global
- Captura de pantalla multi-monitor
- Analisis multimodal con Claude
- TTS con ElevenLabs
- Pointing con tags `[POINT:x,y:label(:screenN)]`
- UI companion flotante y overlay visual

### Solo macOS

- onboarding con video
- panel mas orientado a setup/permisos
- login item automatico
- analytics con PostHog

### Solo Windows

- memoria persistente local
- historial visual con screenshots en disco
- contexto segun app en foco
- nudges proactivos por estancamiento/error
- modo agente con lectura/escritura de archivos y comandos PowerShell
- fallback de push-to-talk si falla el listener nativo

### Infraestructura

- Worker con 3 rutas:
  - `POST /chat`
  - `POST /tts`
  - `POST /transcribe-token`

## Diagnostico de Funciones Existentes

### 1. Push-to-talk y transcripcion

Estado:
- funcional en ambas plataformas
- mejor resuelto en tolerancia operativa en Windows por el fallback del shortcut
- mas sofisticado en macOS por la capa de providers y manejo fino del audio

Problemas:
- macOS depende de URLs placeholder hardcodeadas para Claude/TTS/AssemblyAI
- macOS elige AssemblyAI como si siempre estuviera configurado
- Windows fija transcripcion a ingles aunque permita preferred language
- no hay fallback de producto realmente robusto cuando falla un proveedor externo

Upgrade:
- mover URLs y proveedor por defecto a configuracion runtime
- agregar health checks de STT/TTS/backend al inicio
- fallback real por provider con retry policy y degradacion elegante
- soporte de idioma por usuario y por sesion

Prioridad: P0

### 2. Screen capture y contexto visual

Estado:
- feature central, bien alineada con la propuesta de valor
- multi-monitor correctamente resuelta a nivel base

Problemas:
- cada interaccion captura todas las pantallas
- Windows ademas captura pantallas periodicamente para nudges proactivos
- alto costo de tokens, latencia, privacidad y consumo local

Upgrade:
- capturar solo la pantalla relevante por defecto
- escalar a multi-screen solo si el modelo o la tarea lo requiere
- introducir ROI capture opcional para pointing y tareas guiadas
- agregar modo "screen summary only" para prompts de baja complejidad

Prioridad: P0 en costo/privacidad, P1 en optimizacion avanzada

### 3. Pointing y overlay

Estado:
- es la funcionalidad mas diferenciadora del producto
- tecnicamente bien aterrizada en ambas plataformas

Problemas:
- overlay permanente puede consumir bateria/CPU
- en macOS el estado de respuesta no refleja bien la reproduccion real del audio
- no hay un modo de navegacion guiada mas rico que el simple point target

Upgrade:
- sincronizar estado UI con playback real
- reducir polling/render loops cuando el usuario esta idle
- evolucionar de single point a step-by-step guided mode

Prioridad: P1

### 4. TTS

Estado:
- funcional y coherente con el "buddy"

Problemas:
- latencia evitable, sobre todo en macOS
- dependencia unica de ElevenLabs para voz premium
- no hay estrategia clara de fallback entre calidad, costo y disponibilidad

Upgrade:
- streaming o chunked playback
- fallback entre voz premium y voz del sistema
- voice profiles por idioma, contexto o nivel educativo

Prioridad: P0 para latencia/fallback, P2 para personalizacion

### 5. Onboarding, setup y configuracion

Estado:
- macOS tiene mas onboarding visual
- Windows tiene mas settings pero menos guia de primera ejecucion

Problemas:
- macOS exige email antes de empezar
- macOS activa login item sin opt-in explicito
- Windows arranca con Worker URL placeholder y defaults avanzados activados
- no existe un setup wizard coherente entre plataformas

Upgrade:
- wizard unico de primera ejecucion
- validacion del Worker URL con test de conectividad
- opt-in explicito para login at startup, visual history, nudges y agent mode
- modo demo/local limitado cuando el backend no esta listo

Prioridad: P0

### 6. Memoria persistente y contexto

Estado:
- Windows ya demuestra una direccion potente
- macOS practicamente no tiene memoria durable de producto

Problemas:
- fuerte asimetria entre plataformas
- screenshots y memoria se guardan en disco sin cifrado
- no hay retencion, borrado o controles granulares suficientemente visibles
- clear chat no equivale a borrar memoria visual

Upgrade:
- memoria unificada cross-platform
- politicas de retencion configurables
- borrado completo por categoria
- redaccion de datos sensibles antes de persistir
- opcion local-only y opcion synced profile futura

Prioridad: P0 en privacidad/control, P1 en unificacion

### 7. Agent mode

Estado:
- es la funcion mas estrategica del lado Windows
- acerca a Clicky al espacio de copilots operativos

Problemas:
- activado por defecto
- puede escribir archivos y correr comandos con barreras insuficientes
- renderer con `sandbox: false`
- sin aprobacion por accion ni workspace scoping fuerte

Upgrade:
- agent mode opt-in
- aprobacion explicita por mutacion
- workspace allowlist
- politicas de herramientas por modo
- auditoria de acciones y rollback assist

Prioridad: P0

### 8. Worker / backend proxy

Estado:
- cumple para demo y desarrollo

Problemas:
- sin auth
- sin rate limiting
- sin validacion fuerte de payloads
- sin observabilidad real
- cualquiera con la URL puede quemar presupuesto

Upgrade:
- auth ligera por instalacion/sesion
- rate limits y quotas
- validacion de schema y tamano
- logs, metrics y alertas por proveedor/ruta
- feature flags y cost controls por modelo

Prioridad: P0

### 9. Release, updates y testing

Estado:
- hay esqueleto de release en macOS
- Windows tiene packaging, pero no una historia madura de updates

Problemas:
- nombres heredados de otro producto en release script/appcast/bundle metadata
- Sparkle esta apagado al launch
- Windows no muestra updater maduro
- cobertura de tests baja; en Windows practicamente nula

Upgrade:
- limpiar branding/metadata/release pipeline
- reactivar o terminar la ruta de auto-update
- agregar tests de contratos, parsing, multi-monitor mapping y flows criticos

Prioridad: P1

## Propuestas de Mejora Priorizadas

### P0 - Hacer Clicky productizable

1. Externalizar configuracion critica
- Worker URL, provider defaults, feature flags y analytics deben salir del codigo hardcodeado.

2. Rehacer privacy by default
- `agentMode`, `visualHistory` y `autoTriggers` deben arrancar desactivados.
- analytics de transcript/response deben ser opt-in o redacted.

3. Fortalecer seguridad operativa
- agent actions mutantes con confirmacion
- workspace scoping
- Worker con auth + rate limit + payload validation

4. Robustecer el pipeline de voz
- fallback real entre STT/TTS/providers
- estados correctos de reproduccion
- retries y degradacion controlada

5. Crear un onboarding de verdad
- setup wizard, health checks, permisos, prueba de voz, prueba de pointing y validacion del Worker

### P1 - Reducir friccion y unificar plataformas

1. Paridad de producto entre macOS y Windows
- memoria, contexto, nudges y configuracion moderna deben vivir en ambas plataformas

2. Optimizar screen intelligence
- captura selectiva
- menos polling
- mejor seleccion de pantalla/region

3. Mejorar operacion y release
- update pipeline real
- branding coherente
- observabilidad de errores y costos

4. Testing util
- tests de provider fallback
- tests de `[POINT]`
- tests de mapeo de coordenadas multi-monitor
- tests de config migration y memory retention

### P2 - Expandir valor educativo y diferenciacion

1. Memory-aware tutoring
- Clicky recuerda objetivos, nivel, curso y bloqueos frecuentes

2. Guided task mode
- no solo apunta: guia paso a paso, espera confirmacion y corrige

3. Multi-language teaching persona
- voz, STT y estilo pedagogico por idioma

4. Adaptive pedagogy
- elige entre explicar, preguntar, demostrar o dar hints segun el contexto

## Nuevas Funciones Recomendadas

### 1. Guided Walkthrough Mode

Que es:
- flujo donde Clicky divide una tarea en pasos, apunta cada paso y espera confirmacion

Por que vale la pena:
- extiende la ventaja actual de pointing
- convierte a Clicky en tutor operativo, no solo asistente reactivo

Esfuerzo:
- medio

### 2. Learning Session Memory

Que es:
- memoria de objetivos de aprendizaje, temas vistos, errores recurrentes y preferencias de explicacion

Por que vale la pena:
- encaja perfecto con el posicionamiento de "AI teacher"
- mejora continuidad y personalizacion

Esfuerzo:
- medio

### 3. Safe Agent Actions with Approval

Que es:
- acciones locales con confirmacion contextual: "abrir", "leer", "editar", "ejecutar", "aplicar"

Por que vale la pena:
- conserva el potencial del agent mode sin asustar al usuario ni abrir demasiado riesgo

Esfuerzo:
- medio

### 4. Contextual Mini Lessons

Que es:
- cuando detecta bloqueo o error, Clicky ofrece una explicacion corta y un "why this matters"

Por que vale la pena:
- eleva el producto desde soporte tactico a herramienta educativa

Esfuerzo:
- bajo/medio

### 5. Privacy Modes

Que es:
- perfiles como `minimal`, `standard`, `memory-rich`, `local-only`

Por que vale la pena:
- reduce ansiedad de adopcion
- habilita uso en trabajo sensible y ambientes corporativos

Esfuerzo:
- medio

### 6. Workspace / App Integrations

Que es:
- detectores y prompts especializados para VS Code, Cursor, Xcode, Figma, browser devtools, terminal

Por que vale la pena:
- Clicky ya tiene deteccion de contexto en Windows; esto lo vuelve mas util y menos generico

Esfuerzo:
- medio/alto

### 7. Review and Practice Mode

Que es:
- despues de ayudar, Clicky puede preguntar si el usuario quiere una mini practica o quiz

Por que vale la pena:
- refuerza la propuesta educativa
- convierte sesiones pasivas en aprendizaje activo

Esfuerzo:
- medio

## Matriz Impacto vs Esfuerzo

| Item | Impacto | Esfuerzo | Prioridad |
|---|---|---:|---|
| Externalizar Worker URL y health checks | Alto | Medio | P0 |
| Desactivar defaults agresivos de privacidad/agent mode | Alto | Bajo | P0 |
| Auth + rate limiting en Worker | Alto | Medio | P0 |
| Fallback real STT/TTS | Alto | Medio | P0 |
| Setup wizard cross-platform | Alto | Medio | P0 |
| Workspace scoping + approvals para agent mode | Alto | Medio | P0 |
| Captura selectiva de pantalla | Alto | Medio | P1 |
| Paridad de memoria/contexto entre plataformas | Alto | Alto | P1 |
| Reactivar/update pipeline coherente | Medio | Medio | P1 |
| Testing de flows criticos | Alto | Medio | P1 |
| Guided Walkthrough Mode | Alto | Medio | P1 |
| Learning Session Memory | Alto | Medio | P1 |
| Privacy modes | Medio | Medio | P1 |
| Integraciones por app/workspace | Alto | Alto | P2 |
| Contextual mini lessons | Medio | Bajo | P2 |
| Review and Practice Mode | Medio | Medio | P2 |

## Riesgos y Consideraciones Tecnicas

### Riesgos de plataforma

- macOS depende de TCC, ScreenCaptureKit y permisos delicados
- Windows depende de Electron, helper global de teclado, PowerShell y APIs Win32
- la paridad funcional real va a requerir una capa de producto mas unificada, no solo feature-by-feature

### Riesgos de seguridad

- agent mode actual tiene demasiado poder relativo para estar on by default
- Worker sin auth puede disparar costo y abuso
- persistencia local de screenshots/contexto puede generar riesgos de compliance

### Riesgos de privacidad

- Clicky toca pantalla, voz, texto y memoria local
- sin controles de consentimiento, redaccion y retencion, escalar a equipos o educacion formal sera dificil

### Riesgos de deuda tecnica

- codigo legado/no usado
- metadata de release inconsistente
- configuracion hardcodeada
- cobertura automatizada insuficiente

## Roadmap Recomendado

### Fase 1 - 2 a 4 semanas

- externalizar configuracion
- setup wizard
- auth/rate limit del Worker
- defaults seguros
- approvals basicos para agent mode
- fix de fallback y estados de voz

### Fase 2 - 4 a 8 semanas

- memoria unificada
- captura selectiva
- privacy modes
- tests de flujos criticos
- update pipeline estable

### Fase 3 - 8 a 12 semanas

- guided walkthrough mode
- mini lessons
- aprendizaje adaptativo
- integraciones profundas por app

## Dictamen Final

Clicky no necesita perseguir muchas features nuevas antes de madurar el nucleo. Ya tiene una propuesta diferenciada. El mayor multiplicador ahora es hacerla confiable, segura, configurable y consistente entre plataformas.

La prioridad correcta es:

- primero: productizar el core
- segundo: unificar memoria, contexto y control
- tercero: expandir la capa educativa

Si se ejecuta en ese orden, Clicky puede pasar de demo llamativa a companion educativo realmente defendible.
