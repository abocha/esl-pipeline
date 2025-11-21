# @esl-pipeline/tts-elevenlabs

High-performance Text-to-Speech and Text-to-Dialogue synthesis using ElevenLabs API. Converts `:::study-text` content from Markdown files into high-quality MP3 assets with speaker voice assignment.

## Features

- **Real ElevenLabs API Integration**: Full API support with proper authentication
- **Voice Sync**: Automatic voice synchronization with ElevenLabs account
- **Speaker Assignment**: Flexible speaker-to-voice mapping
- **Multiple Output Formats**: MP3, Opus, and other audio formats
- **Chunking & Concurrency**: Handles large content with intelligent chunking
- **Caching**: SHA-256 based caching for optimal performance

## New: Dual TTS Mode Support

This package now supports both **Text-to-Speech** and **Text-to-Dialogue** APIs for enhanced audio generation:

### Supported Modes

- **Auto** (default): Automatically detects content type and selects appropriate mode
- **Dialogue**: Forces use of ElevenLabs Text-to-Dialogue API for multi-speaker content
- **Monologue**: Uses traditional Text-to-Speech API for single-speaker content

### API Models

- **Dialogue Mode**: ElevenLabs v3 (`model_id: "eleven_v3"`) - Optimized for multi-speaker conversations
- **Monologue Mode**: ElevenLabs v2 (`model_id: "eleven_multilingual_v2"`) - Optimized for single-speaker narration

### Environment Variables

Add these new environment variables to control TTS mode:

```bash
# TTS mode selection: auto, dialogue, or monologue
ELEVENLABS_TTS_MODE=auto

# Dialogue mode settings (optional)
ELEVENLABS_DIALOGUE_LANGUAGE=en
ELEVENLABS_DIALOGUE_STABILITY=0.5
ELEVENLABS_DIALOGUE_SEED=42
```

### CLI Usage Examples

```bash
# Auto-detect mode (default behavior)
tts-elevenlabs --md lesson.md --voice-map voices.yml

# Force dialogue mode
tts-elevenlabs --md lesson.md --voice-map voices.yml --tts-mode dialogue

# Force monologue mode
tts-elevenlabs --md lesson.md --voice-map voices.yml -m monologue

# Dialogue mode with custom settings
tts-elevenlabs --md lesson.md \
  --voice-map voices.yml \
  --tts-mode dialogue \
  --dialogue-language en \
  --dialogue-stability 0.7 \
  --dialogue-seed 42
```

### Voice Mapping

Dialogue mode requires speaker-to-voice mappings in your voice configuration:

```yaml
# configs/voices.yml (example)
speakers:
  Alex:
    voice_id: '21m00Tcm4TlvDq8ikWAM' # Rachel voice
  Sarah:
    voice_id: 'AZnzlk1XvdvUeBnXmlld' # Bella voice

# Or use profiles
speaker_profiles:
  - id: 'teacher'
    gender: 'female'
    accent: 'american'
  - id: 'student'
    gender: 'male'
    accent: 'british'
```

### Programmatic Usage

```typescript
import { buildStudyTextMp3 } from '@esl-pipeline/tts-elevenlabs';

// Auto mode (recommended)
const result1 = await buildStudyTextMp3({
  md: 'lesson.md',
  voicesYml: 'voices.yml',
  ttsMode: 'auto', // Will detect content type automatically
});

// Force dialogue mode
const result2 = await buildStudyTextMp3({
  md: 'lesson.md',
  voicesYml: 'voices.yml',
  ttsMode: 'dialogue',
  dialogueLanguage: 'en',
  dialogueStability: 0.7,
  dialogueSeed: 42,
});
```

### Backward Compatibility

✅ **Fully backward compatible** - Existing usage works without changes:

- Default mode is 'auto' which defaults to monologue for backward compatibility
- All existing CLI flags and options remain unchanged
- No breaking changes to API or output format

### Performance Benefits

Dialogue mode provides:

- **Fewer API calls**: 1 request vs. N requests (where N = dialogue lines)
- **Better speaker continuity**: Natural voice transitions between speakers
- **Reduced latency**: Parallel processing within ElevenLabs
- **Improved caching**: Single cache file vs. many small files

### Error Handling

Dialogue mode validates all speakers have voice mappings:

```
Error: No voice mapping found for speaker "Alex".
Available speakers: Sarah, Bob, Teacher
```

To fix: Add the missing speaker to your voice configuration.

### See Also

- [NOTES-elevenlabs.md](NOTES-elevenlabs.md) - Detailed API documentation
- [DESIGN-dual-mode.md](DESIGN-dual-mode.md) - Technical design document
- Tests: [tests/dialogue.test.ts](tests/dialogue.test.ts), [tests/mode-selection.test.ts](tests/mode-selection.test.ts)

## CLI

```
tts-elevenlabs --md lesson.md --voice-map ./configs/voices.yml --out ./out [--tts-mode auto|dialogue|monologue] [--preview]
```

Outputs JSON containing the destination path and hash with speaker metadata.

## API Reference

### buildStudyTextMp3()

Main function for converting study text to MP3 audio files.

#### Parameters

##### BuildStudyTextOptions

```typescript
interface BuildStudyTextOptions {
  md: string;
  voicesYml: string;
  outputDir?: string;
  cacheDir?: string;
  voiceMap?: Record<string, string>;
  voiceSettings?: VoiceSettings;
  outputFormat?: string;

  // New options for dual TTS mode
  ttsMode?: 'auto' | 'dialogue' | 'monologue';
  dialogueLanguage?: string;
  dialogueStability?: number;
  dialogueSeed?: number;
}
```

#### Returns

```typescript
interface BuildStudyTextResult {
  outputPath: string;
  audioDuration: number;
  speakers?: string[];
  dialogueUsed: boolean;
  hash: string;
}
```

### syncVoices()

Synchronize available voices from ElevenLabs account.

```typescript
import { syncVoices } from '@esl-pipeline/tts-elevenlabs';

await syncVoices({
  output: './configs/elevenlabs.voices.json',
});
```

## Installation

```bash
npm install @esl-pipeline/tts-elevenlabs
# or
pnpm add @esl-pipeline/tts-elevenlabs
# or
yarn add @esl-pipeline/tts-elevenlabs
```

## Setup

1. **Set Environment Variables**:

   ```bash
   export ELEVENLABS_API_KEY=your_api_key_here
   export ELEVENLABS_TTS_MODE=auto  # Optional: defaults to auto
   ```

2. **Configure Voices** (see `bin/voices.ts` for interactive setup):

   ```bash
   tts-elevenlabs voices --sync  # Sync from your ElevenLabs account
   tts-elevenlabs voices --interactive  # Interactive voice mapping setup
   ```

3. **Create Voice Configuration**:
   ```yaml
   # configs/voices.yml
   speakers:
     Teacher:
       voice_id: '21m00Tcm4TlvDq8ikWAM'
     Student:
       voice_id: 'AZnzlk1XvdvUeBnXmlld'
   ```

## Changelog

### v2.0.0 - 2025-11-12

#### Added

- **Dual TTS Mode Support**: Automatic content-type detection with mode selection
- **Text-to-Dialogue API**: Support for multi-speaker conversations using ElevenLabs v3
- **CLI Flags**: `--tts-mode`, `--dialogue-language`, `--dialogue-stability`, `--dialogue-seed`
- **Environment Variables**: `ELEVENLABS_TTS_MODE`, `ELEVENLABS_DIALOGUE_LANGUAGE`, etc.
- **Comprehensive Tests**: 48 tests covering all new functionality
- **Documentation**: API notes and updated README

#### Changed

- Enhanced `buildStudyTextMp3()` to support mode selection
- Extended `BuildStudyTextOptions` with new optional fields
- Improved speaker continuity in dialogue mode

#### Fixed

- Better error messages for missing voice mappings
- Proper cleanup of temporary files in all scenarios

#### Breaking Changes

- **None** - Fully backward compatible

### v1.0.0 - 2024-XX-XX

- Initial release with basic Text-to-Speech support
- Speaker assignment functionality
- Basic ElevenLabs API integration
