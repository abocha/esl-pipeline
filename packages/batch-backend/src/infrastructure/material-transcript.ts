import { ASSIGNMENT_SOURCE_TEXT_MAX_LENGTH, youtubeVideoId } from '@esl-pipeline/contracts';

const RESPONSE_MAX_BYTES = 1_000_000;

export class MaterialTranscriptError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'MaterialTranscriptError';
  }
}

export interface MaterialTranscriptConfig {
  apiKey?: string;
  timeoutMs: number;
}

/** Only the normalized external video identity leaves the backend. Never retry paid requests. */
export async function fetchYouTubeMaterialTranscript(
  sourceUrl: string,
  config: MaterialTranscriptConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sourceUrl: string; sourceText: string }> {
  const videoId = youtubeVideoId(sourceUrl);
  if (!videoId) {
    throw new MaterialTranscriptError(
      'unsupported_video_url',
      400,
      'Enter a supported YouTube video link.',
    );
  }
  if (!config.apiKey?.trim()) {
    throw new MaterialTranscriptError(
      'transcript_unconfigured',
      503,
      'Transcript fetching is unavailable. Paste source text below or get it manually.',
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const endpoint = new URL('https://transcriptapi.com/api/v2/youtube/transcript');
    endpoint.searchParams.set('video_url', videoId);
    endpoint.searchParams.set('format', 'json');
    endpoint.searchParams.set('include_timestamp', 'false');
    const response = await fetchImpl(endpoint, {
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 402)
        throw new MaterialTranscriptError(
          'transcript_credits_exhausted',
          503,
          'Transcript fetching is unavailable. Paste source text below or get it manually.',
        );
      if ([404, 422].includes(response.status))
        throw new MaterialTranscriptError(
          'transcript_unavailable',
          422,
          'Captions could not be retrieved for this video. Paste source text below or try getting it manually.',
        );
      if (response.status === 429)
        throw new MaterialTranscriptError(
          'transcript_rate_limited',
          429,
          'Transcript fetching is busy. Try again later, or paste source text below.',
        );
      throw new MaterialTranscriptError(
        'transcript_provider_failed',
        502,
        'We couldn’t fetch a transcript. Paste source text below or get it manually.',
      );
    }
    const size = Number(response.headers.get('content-length'));
    if (size > RESPONSE_MAX_BYTES) {
      await response.body?.cancel();
      throw oversized();
    }
    if (!response.body) throw malformed();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > RESPONSE_MAX_BYTES) {
          await reader.cancel();
          throw oversized();
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw malformed();
    }
    if (!parsed || typeof parsed !== 'object') throw malformed();
    const data = parsed as { video_id?: unknown; transcript?: unknown };
    if (data.video_id !== videoId || !Array.isArray(data.transcript) || !data.transcript.length)
      throw malformed();
    const segments: string[] = [];
    for (const segment of data.transcript) {
      if (!segment || typeof segment !== 'object' || typeof segment.text !== 'string')
        throw malformed();
      segments.push(segment.text.trim());
    }
    const sourceText = segments.join('\n').trim();
    if (!sourceText) throw malformed();
    if (sourceText.length > ASSIGNMENT_SOURCE_TEXT_MAX_LENGTH) throw oversized();
    return { sourceUrl: `https://www.youtube.com/watch?v=${videoId}`, sourceText };
  } catch (error) {
    if (error instanceof MaterialTranscriptError) throw error;
    if (controller.signal.aborted)
      throw new MaterialTranscriptError(
        'transcript_timeout',
        504,
        'Transcript fetching timed out. Try again, or paste source text below.',
      );
    // Provider bodies, URLs and credentials are deliberately absent from public errors and logs.
    throw new MaterialTranscriptError(
      'transcript_provider_failed',
      502,
      'We couldn’t fetch a transcript. Paste source text below or get it manually.',
    );
  } finally {
    clearTimeout(timeout);
  }
}

function malformed(): MaterialTranscriptError {
  return new MaterialTranscriptError(
    'transcript_invalid_response',
    502,
    'The transcript response was unusable. Paste source text below or get it manually.',
  );
}

function oversized(): MaterialTranscriptError {
  return new MaterialTranscriptError(
    'transcript_too_large',
    422,
    `This transcript is too long. Paste an excerpt of at most ${ASSIGNMENT_SOURCE_TEXT_MAX_LENGTH.toLocaleString('en-US')} characters.`,
  );
}
