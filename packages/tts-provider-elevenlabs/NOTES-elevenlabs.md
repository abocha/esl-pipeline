# ElevenLabs API Documentation Notes

## Text-to-Dialogue API

**Endpoint**: `POST https://api.elevenlabs.io/v1/text-to-dialogue`

**Purpose**: Multi-speaker dialogue synthesis using ElevenLabs v3 model

> Implementation note: this package now calls the official `@elevenlabs/elevenlabs-js` SDK
> (`client.textToDialogue.convert`) with camelCase request fields.

### Request Format

```json
{
  "inputs": [
    {
      "text": "Hello world",
      "voiceId": "voice_id_here"
    }
  ],
  "modelId": "eleven_v3",
  "languageCode": "en",
  "settings": {
    "stability": 0.5
  },
  "seed": 42,
  "applyTextNormalization": "auto"
}
```

### Headers

- `xi-api-key`: Your API key
- `Content-Type`: application/json

### Query Parameters

- `output_format`: Optional, defaults to `mp3_44100_128`
  - Supported: `mp3_22050_32`, `mp3_44100_128`, `mp3_44100_192`, `pcm_44100`, `opus_48000_128`, etc.

### Response

- **Type**: `application/octet-stream`
- **Content**: Binary audio file

### Key Differences from Text-to-Speech

| Feature  | Text-to-Dialogue           | Text-to-Speech                  |
| -------- | -------------------------- | ------------------------------- |
| Model    | `eleven_v3`                | `eleven_multilingual_v2`        |
| Input    | Array of `{text, voiceId}` | Single `text` string            |
| Speakers | Multiple per request       | One per request                 |
| Endpoint | `/v1/text-to-dialogue`     | `/v1/text-to-speech/{voice_id}` |
| Use Case | Conversations, dialogues   | Monologues, narration           |

### Best Practices

1. **Speaker Continuity**: Dialogue API maintains better speaker consistency across turns
2. **Deterministic Output**: Use `seed` parameter for reproducible results
3. **Chunking**: Large dialogues are automatically chunked (>100 inputs or >5000 chars)
4. **Error Handling**: Always provide descriptive errors for missing voice mappings

## Implementation Notes

- **Timeout**: 60 seconds for dialogue API calls
- **Retries**: Built-in retry logic for 429/5xx errors
- **Cache**: SHA-256 hash based on inputs and options
- **Cleanup**: Temporary files automatically cleaned up after synthesis
