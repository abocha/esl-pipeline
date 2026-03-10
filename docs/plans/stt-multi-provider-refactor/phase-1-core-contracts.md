# Phase 1 - Core Contracts

## Goals

1. Introduce shared STT provider contract surface.
2. Mirror TTS core registry/engine behavior for provider resolution.

## Deliverables

1. `@esl-pipeline/stt-core` package with:
   - `SttProviderId`
   - normalized transcript segment/result types
   - `SttProviderAdapter` interface
   - registry helpers (`register`, `get`, `build`)
   - default-provider/order resolution from env
2. `@esl-pipeline/contracts` additive STT types for API surfaces.

## Constraints

1. Keep output transcript formats unchanged (`timeline`, `stack`).
2. Preserve backward compatibility for existing API consumers.
