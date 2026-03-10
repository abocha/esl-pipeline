import { describeHttpServerIntegrationSuite } from './transport.http-server.integration.harness.js';

describeHttpServerIntegrationSuite(
  'transport/http-server - integration (in-process) [recordings-prompt-packages]',
  ({
    app,
    createDraftModule,
    createPromptPackageModule,
    deriveStudentId,
    expect,
    getPromptPackageModule,
    getRecordingModule,
    getRecordingTranscriptModule,
    it,
    listRecordingsModule,
    ProfilePathError,
    recordingRepositoryModule,
    retryRecordingModule,
    transcriptRepositoryModule,
    updateRecordingTranscriptModule,
    vi,
  }) => {
  it('POST /recordings/upload reuses existing transcript when hash already exists', async () => {
    const listRecordingsBySha256 = vi.spyOn(recordingRepositoryModule, 'listRecordingsBySha256');
    const getTranscriptByRecordingId = vi.spyOn(
      transcriptRepositoryModule,
      'getTranscriptByRecordingId',
    );
    const insertRecording = vi.spyOn(recordingRepositoryModule, 'insertRecording');

    listRecordingsBySha256.mockResolvedValueOnce([
      {
        id: 'recording-cached',
        source: 'upload',
        studentId: deriveStudentId('Anna'),
        sourcePath: 'lesson.mp3',
        storageUri: 'memory://recordings/recording-cached.mp3',
        sha256: 'abc123',
        bytes: 1024,
        durationSec: 90,
        channels: 1,
        status: 'transcribed',
        error: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:05:00.000Z'),
      },
    ]);
    getTranscriptByRecordingId.mockResolvedValueOnce({
      id: 'transcript-cached',
      recordingId: 'recording-cached',
      storageUri: 'memory://transcripts/transcript-cached.txt',
      rawResponseUri: null,
      mode: 'timeline',
      model: 'nova-3',
      language: 'en',
      sttProvider: 'deepgram',
      fallbackUsed: false,
      summaryJson: null,
      createdAt: new Date('2024-01-01T00:05:00.000Z'),
      updatedAt: new Date('2024-01-01T00:05:00.000Z'),
    });
    insertRecording.mockClear();

    const boundary = '----esl-test-boundary';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="file"; filename="lesson.mp3"\r\n' +
          'Content-Type: audio/mpeg\r\n\r\n',
      ),
      Buffer.from('mock-audio-content'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/recordings/upload',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recordingId: 'recording-cached',
      transcriptId: 'transcript-cached',
      cacheHit: true,
      cacheReason: 'transcript_reused',
      cacheRecordingId: 'recording-cached',
    });
    expect(insertRecording).not.toHaveBeenCalled();
  });

  it('POST /recordings/upload matches cached transcript by effective provider when query omits sttProvider', async () => {
    const listRecordingsBySha256 = vi.spyOn(recordingRepositoryModule, 'listRecordingsBySha256');
    const getTranscriptByRecordingId = vi.spyOn(
      transcriptRepositoryModule,
      'getTranscriptByRecordingId',
    );
    const insertRecording = vi.spyOn(recordingRepositoryModule, 'insertRecording');

    listRecordingsBySha256.mockResolvedValueOnce([
      {
        id: 'recording-elevenlabs',
        source: 'upload',
        studentId: deriveStudentId('Anna'),
        sourcePath: 'lesson.mp3',
        storageUri: 'memory://recordings/recording-elevenlabs.mp3',
        sha256: 'abc123',
        bytes: 1024,
        durationSec: 90,
        channels: 1,
        status: 'transcribed',
        error: null,
        createdAt: new Date('2024-01-02T00:00:00.000Z'),
        updatedAt: new Date('2024-01-02T00:05:00.000Z'),
      },
      {
        id: 'recording-deepgram',
        source: 'upload',
        studentId: deriveStudentId('Anna'),
        sourcePath: 'lesson.mp3',
        storageUri: 'memory://recordings/recording-deepgram.mp3',
        sha256: 'abc123',
        bytes: 1024,
        durationSec: 90,
        channels: 1,
        status: 'transcribed',
        error: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:05:00.000Z'),
      },
    ]);
    getTranscriptByRecordingId
      .mockResolvedValueOnce({
        id: 'transcript-elevenlabs',
        recordingId: 'recording-elevenlabs',
        storageUri: 'memory://transcripts/transcript-elevenlabs.txt',
        rawResponseUri: null,
        mode: 'timeline',
        model: 'scribe_v1',
        language: 'en',
        sttProvider: 'elevenlabs',
        fallbackUsed: false,
        summaryJson: { provider: 'elevenlabs' },
        createdAt: new Date('2024-01-02T00:05:00.000Z'),
        updatedAt: new Date('2024-01-02T00:05:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'transcript-deepgram',
        recordingId: 'recording-deepgram',
        storageUri: 'memory://transcripts/transcript-deepgram.txt',
        rawResponseUri: null,
        mode: 'timeline',
        model: 'nova-3',
        language: 'en',
        sttProvider: 'deepgram',
        fallbackUsed: false,
        summaryJson: { provider: 'deepgram' },
        createdAt: new Date('2024-01-01T00:05:00.000Z'),
        updatedAt: new Date('2024-01-01T00:05:00.000Z'),
      });
    insertRecording.mockClear();

    const boundary = '----esl-test-boundary-2';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="file"; filename="lesson.mp3"\r\n' +
          'Content-Type: audio/mpeg\r\n\r\n',
      ),
      Buffer.from('mock-audio-content'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/recordings/upload',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    // Test env default STT provider is deepgram, so deepgram transcript should be selected.
    expect(response.json()).toMatchObject({
      recordingId: 'recording-deepgram',
      transcriptId: 'transcript-deepgram',
      cacheHit: true,
      cacheReason: 'transcript_reused',
      cacheRecordingId: 'recording-deepgram',
    });
    expect(insertRecording).not.toHaveBeenCalled();
  });

  it('POST /recordings/upload honors explicit sttProvider against mixed cached transcripts', async () => {
    const listRecordingsBySha256 = vi.spyOn(recordingRepositoryModule, 'listRecordingsBySha256');
    const getTranscriptByRecordingId = vi.spyOn(
      transcriptRepositoryModule,
      'getTranscriptByRecordingId',
    );
    const insertRecording = vi.spyOn(recordingRepositoryModule, 'insertRecording');

    listRecordingsBySha256.mockResolvedValueOnce([
      {
        id: 'recording-deepgram',
        source: 'upload',
        studentId: deriveStudentId('Anna'),
        sourcePath: 'lesson.mp3',
        storageUri: 'memory://recordings/recording-deepgram.mp3',
        sha256: 'abc123',
        bytes: 1024,
        durationSec: 90,
        channels: 1,
        status: 'transcribed',
        error: null,
        createdAt: new Date('2024-01-02T00:00:00.000Z'),
        updatedAt: new Date('2024-01-02T00:05:00.000Z'),
      },
      {
        id: 'recording-elevenlabs',
        source: 'upload',
        studentId: deriveStudentId('Anna'),
        sourcePath: 'lesson.mp3',
        storageUri: 'memory://recordings/recording-elevenlabs.mp3',
        sha256: 'abc123',
        bytes: 1024,
        durationSec: 90,
        channels: 1,
        status: 'transcribed',
        error: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:05:00.000Z'),
      },
    ]);
    getTranscriptByRecordingId
      .mockResolvedValueOnce({
        id: 'transcript-deepgram',
        recordingId: 'recording-deepgram',
        storageUri: 'memory://transcripts/transcript-deepgram.txt',
        rawResponseUri: null,
        mode: 'timeline',
        model: 'nova-3',
        language: 'en',
        sttProvider: 'deepgram',
        fallbackUsed: false,
        summaryJson: { provider: 'deepgram' },
        createdAt: new Date('2024-01-02T00:05:00.000Z'),
        updatedAt: new Date('2024-01-02T00:05:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'transcript-elevenlabs',
        recordingId: 'recording-elevenlabs',
        storageUri: 'memory://transcripts/transcript-elevenlabs.txt',
        rawResponseUri: null,
        mode: 'timeline',
        model: 'scribe_v1',
        language: 'en',
        sttProvider: 'elevenlabs',
        fallbackUsed: false,
        summaryJson: { provider: 'elevenlabs' },
        createdAt: new Date('2024-01-01T00:05:00.000Z'),
        updatedAt: new Date('2024-01-01T00:05:00.000Z'),
      });
    insertRecording.mockClear();

    const boundary = '----esl-test-boundary-3';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="file"; filename="lesson.mp3"\r\n' +
          'Content-Type: audio/mpeg\r\n\r\n',
      ),
      Buffer.from('mock-audio-content'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/recordings/upload?sttProvider=elevenlabs',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recordingId: 'recording-elevenlabs',
      transcriptId: 'transcript-elevenlabs',
      cacheHit: true,
      cacheReason: 'transcript_reused',
      cacheRecordingId: 'recording-elevenlabs',
    });
    expect(insertRecording).not.toHaveBeenCalled();
  });

  it('GET /recordings returns paginated recording list', async () => {
    const listRecordings = vi.spyOn(listRecordingsModule, 'listRecordingsWithDefaults');
    listRecordings.mockClear();
    listRecordings.mockResolvedValue({
      items: [
        {
          recordingId: 'recording-1',
          status: 'transcribed',
          transcriptId: 'transcript-1',
          error: null,
          source: 'upload',
          studentId: null,
          displayName: 'recording-1.opus',
          durationSec: 120,
          channels: 2,
          bytes: 2048,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:10:00.000Z',
        },
      ],
      limit: 10,
      offset: 5,
      total: 42,
      order: 'asc',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/recordings?status=transcribed&limit=10&offset=5&order=asc',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          recordingId: 'recording-1',
          status: 'transcribed',
          transcriptId: 'transcript-1',
          error: null,
          source: 'upload',
          studentId: null,
          displayName: 'recording-1.opus',
          durationSec: 120,
          channels: 2,
          bytes: 2048,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:10:00.000Z',
        },
      ],
      limit: 10,
      offset: 5,
      total: 42,
      order: 'asc',
    });
    expect(listRecordings).toHaveBeenCalledWith({
      statuses: ['transcribed'],
      sources: null,
      search: null,
      studentId: null,
      limit: 10,
      offset: 5,
      order: 'asc',
    });
  });

  it('GET /recordings maps student filter to studentId', async () => {
    const listRecordings = vi.spyOn(listRecordingsModule, 'listRecordingsWithDefaults');
    listRecordings.mockResolvedValue({
      items: [],
      limit: 50,
      offset: 0,
      total: 0,
      order: 'desc',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/recordings?student=Anna',
    });

    expect(response.statusCode).toBe(200);
    expect(listRecordings).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: deriveStudentId('Anna'),
      }),
    );
  });

  it('GET /recordings maps source and query filters', async () => {
    const listRecordings = vi.spyOn(listRecordingsModule, 'listRecordingsWithDefaults');
    listRecordings.mockResolvedValue({
      items: [],
      limit: 50,
      offset: 0,
      total: 0,
      order: 'desc',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/recordings?source=upload&q=lesson',
    });

    expect(response.statusCode).toBe(200);
    expect(listRecordings).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: ['upload'],
        search: 'lesson',
      }),
    );
  });

  it('GET /recordings/:id returns recording payload', async () => {
    const getRecording = vi.spyOn(getRecordingModule, 'getRecording');
    getRecording.mockClear();
    getRecording.mockResolvedValue({
      recordingId: 'recording-1',
      status: 'queued',
      transcriptId: null,
      error: null,
      source: 'upload',
      studentId: null,
      displayName: 'recording-1.opus',
      durationSec: null,
      channels: null,
      bytes: 1234,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:05:00.000Z',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/recordings/recording-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      recordingId: 'recording-1',
      status: 'queued',
      transcriptId: null,
      error: null,
      source: 'upload',
      studentId: null,
      displayName: 'recording-1.opus',
      durationSec: null,
      channels: null,
      bytes: 1234,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:05:00.000Z',
    });
    expect(getRecording).toHaveBeenCalledWith('recording-1');
  });

  it('GET /recordings/:id returns 404 when missing', async () => {
    const getRecording = vi.spyOn(getRecordingModule, 'getRecording');
    getRecording.mockClear();
    getRecording.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/recordings/missing',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('POST /recordings/:id/transcribe enqueues retry', async () => {
    const retryRecording = vi.spyOn(retryRecordingModule, 'retryRecordingTranscription');
    retryRecording.mockClear();
    retryRecording.mockResolvedValue({
      recordingId: 'recording-1',
      status: 'queued',
      transcriptId: null,
      error: null,
      source: 'upload',
      studentId: null,
      displayName: 'recording-1.opus',
      durationSec: null,
      channels: null,
      bytes: 1234,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:05:00.000Z',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/recordings/recording-1/transcribe',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      recordingId: 'recording-1',
      status: 'queued',
      transcriptId: null,
      error: null,
      source: 'upload',
      studentId: null,
      displayName: 'recording-1.opus',
      durationSec: null,
      channels: null,
      bytes: 1234,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:05:00.000Z',
    });
    expect(retryRecording).toHaveBeenCalledWith(
      'recording-1',
      { sttProvider: undefined },
      expect.objectContaining({ enqueue: expect.any(Function) }),
    );
  });

  it('POST /recordings/:id/transcribe forwards explicit STT provider override', async () => {
    const retryRecording = vi.spyOn(retryRecordingModule, 'retryRecordingTranscription');
    retryRecording.mockClear();
    retryRecording.mockResolvedValue({
      recordingId: 'recording-1',
      status: 'queued',
      transcriptId: null,
      error: null,
      source: 'upload',
      studentId: null,
      displayName: 'recording-1.opus',
      durationSec: null,
      channels: null,
      bytes: 1234,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:05:00.000Z',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/recordings/recording-1/transcribe',
      payload: { sttProvider: 'elevenlabs' },
    });

    expect(response.statusCode).toBe(200);
    expect(retryRecording).toHaveBeenCalledWith(
      'recording-1',
      { sttProvider: 'elevenlabs' },
      expect.objectContaining({ enqueue: expect.any(Function) }),
    );
  });

  it('GET /recordings/:id/transcript returns transcript payload', async () => {
    const getRecordingTranscript = vi.spyOn(getRecordingTranscriptModule, 'getRecordingTranscript');
    getRecordingTranscript.mockClear();
    getRecordingTranscript.mockResolvedValue({
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      text: 'Hello transcript',
      summaryJson: { channels: 2 },
      model: 'nova-3',
      language: 'en',
      mode: 'timeline',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/recordings/recording-1/transcript',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      text: 'Hello transcript',
      summaryJson: { channels: 2 },
      model: 'nova-3',
      language: 'en',
      mode: 'timeline',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });
    expect(getRecordingTranscript).toHaveBeenCalledWith('recording-1');
  });

  it('GET /recordings/:id/transcript returns 404 when missing', async () => {
    const getRecordingTranscript = vi.spyOn(getRecordingTranscriptModule, 'getRecordingTranscript');
    getRecordingTranscript.mockClear();
    getRecordingTranscript.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/recordings/missing/transcript',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('PUT /recordings/:id/transcript updates transcript text', async () => {
    const updateRecordingTranscript = vi.spyOn(
      updateRecordingTranscriptModule,
      'updateRecordingTranscript',
    );
    updateRecordingTranscript.mockClear();
    updateRecordingTranscript.mockResolvedValue({
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      text: 'Updated text',
      summaryJson: null,
      model: 'nova-3',
      language: 'en',
      mode: 'timeline',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:20:00.000Z',
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/recordings/recording-1/transcript',
      payload: { text: 'Updated text' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      text: 'Updated text',
      summaryJson: null,
      model: 'nova-3',
      language: 'en',
      mode: 'timeline',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:20:00.000Z',
    });
    expect(updateRecordingTranscript).toHaveBeenCalledWith({
      recordingId: 'recording-1',
      text: 'Updated text',
    });
  });

  it('PUT /recordings/:id/transcript returns 404 when missing', async () => {
    const updateRecordingTranscript = vi.spyOn(
      updateRecordingTranscriptModule,
      'updateRecordingTranscript',
    );
    updateRecordingTranscript.mockClear();
    updateRecordingTranscript.mockResolvedValue(null);

    const response = await app.inject({
      method: 'PUT',
      url: '/recordings/missing/transcript',
      payload: { text: 'Updated text' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('POST /recordings/:id/prompt-package returns assembled payload', async () => {
    const createPromptPackage = vi.spyOn(createPromptPackageModule, 'createPromptPackage');
    createPromptPackage.mockClear();
    createPromptPackage.mockResolvedValue({
      id: 'prompt-1',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      studentId: null,
      profilePath: '/profiles/p1.md',
      templateVersion: '/templates/t1.md',
      notes: 'Some notes',
      storageUri: 'local://prompt-packages/prompt-1.txt',
      text: 'PROMPT TEXT',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/recordings/recording-1/prompt-package',
      payload: { notes: 'Some notes', profilePath: '/profiles/p1.md' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'prompt-1',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      studentId: null,
      profilePath: '/profiles/p1.md',
      templateVersion: '/templates/t1.md',
      notes: 'Some notes',
      storageUri: 'local://prompt-packages/prompt-1.txt',
      text: 'PROMPT TEXT',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });
    expect(createPromptPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: 'recording-1',
        notes: 'Some notes',
        profilePath: '/profiles/p1.md',
      }),
    );
  });

  it('POST /recordings/:id/prompt-package returns 404 when transcript missing', async () => {
    const createPromptPackage = vi.spyOn(createPromptPackageModule, 'createPromptPackage');
    createPromptPackage.mockClear();
    createPromptPackage.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/recordings/missing/prompt-package',
      payload: { notes: 'Some notes' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('POST /recordings/:id/prompt-package rejects profilePath outside repo', async () => {
    const createPromptPackage = vi.spyOn(createPromptPackageModule, 'createPromptPackage');
    createPromptPackage.mockClear();
    createPromptPackage.mockRejectedValue(
      new ProfilePathError(
        'profilePath must resolve within the configured profile root',
        'profile_path_outside_root',
      ),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/recordings/recording-1/prompt-package',
      payload: { profilePath: '/etc/passwd' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'validation_failed',
      message: 'profilePath must resolve within the configured profile root',
      code: 'profile_path_outside_root',
    });
  });

  it('GET /prompt-packages/:id returns prompt package payload', async () => {
    const getPromptPackage = vi.spyOn(getPromptPackageModule, 'getPromptPackage');
    getPromptPackage.mockClear();
    getPromptPackage.mockResolvedValue({
      id: 'prompt-1',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      studentId: 'student-1',
      profilePath: '/profiles/p1.md',
      templateVersion: '/templates/t1.md',
      notes: 'Some notes',
      storageUri: 'local://prompt-packages/prompt-1.txt',
      text: 'PROMPT TEXT',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/prompt-packages/prompt-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'prompt-1',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      studentId: 'student-1',
      profilePath: '/profiles/p1.md',
      templateVersion: '/templates/t1.md',
      notes: 'Some notes',
      storageUri: 'local://prompt-packages/prompt-1.txt',
      text: 'PROMPT TEXT',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });
    expect(getPromptPackage).toHaveBeenCalledWith('prompt-1');
  });

  it('GET /prompt-packages/:id returns 404 when missing', async () => {
    const getPromptPackage = vi.spyOn(getPromptPackageModule, 'getPromptPackage');
    getPromptPackage.mockClear();
    getPromptPackage.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/prompt-packages/missing',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('GET /prompt-packages/:id/lineage returns lineage payload', async () => {
    const getPromptPackageLineage = vi.spyOn(getPromptPackageModule, 'getPromptPackageLineage');
    getPromptPackageLineage.mockClear();
    getPromptPackageLineage.mockResolvedValue({
      promptPackageId: 'prompt-1',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      studentId: 'student-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
      profile: {
        snapshot: {
          profileId: 'profile.md',
          revisionId: 'revision-1',
          hash: 'hash-1',
          versionLabel: 'v1',
          status: 'active',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        current: {
          profileId: 'profile.md',
          revisionId: 'revision-2',
          hash: 'hash-2',
          versionLabel: 'v2',
          status: 'active',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
        drift: {
          detected: true,
          reason: 'profile_content_changed',
          currentProfileHash: 'hash-2',
          currentProfileRevisionId: 'revision-2',
          currentProfileUpdatedAt: '2024-01-02T00:00:00.000Z',
        },
      },
      template: {
        snapshot: {
          templateId: 'template.md',
          revisionId: 'template-revision-1',
          hash: 'template-hash-1',
          versionLabel: 'v1',
          status: 'active',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        current: {
          templateId: 'template.md',
          revisionId: 'template-revision-1',
          hash: 'template-hash-1',
          versionLabel: 'v1',
          status: 'active',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        drift: null,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/prompt-packages/prompt-1/lineage',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      promptPackageId: 'prompt-1',
      profile: {
        snapshot: {
          profileId: 'profile.md',
          revisionId: 'revision-1',
        },
      },
      template: {
        snapshot: {
          templateId: 'template.md',
          revisionId: 'template-revision-1',
        },
      },
    });
  });

  it('POST /prompt-packages/:id/draft returns draft payload', async () => {
    const createDraft = vi.spyOn(createDraftModule, 'createDraft');
    createDraft.mockClear();
    createDraft.mockResolvedValue({
      id: 'draft-1',
      promptPackageId: 'prompt-1',
      studentId: 'student-1',
      storageUri: 'local://drafts/draft-1.md',
      createdBy: 'test-user-id',
      text: 'DRAFT TEXT',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/prompt-packages/prompt-1/draft',
      payload: { text: 'DRAFT TEXT' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'draft-1',
      promptPackageId: 'prompt-1',
      studentId: 'student-1',
      storageUri: 'local://drafts/draft-1.md',
      createdBy: 'test-user-id',
      text: 'DRAFT TEXT',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });
    expect(createDraft).toHaveBeenCalledWith({
      promptPackageId: 'prompt-1',
      text: 'DRAFT TEXT',
      createdBy: 'test-user-id',
    });
  });

  it('POST /prompt-packages/:id/draft returns 404 when missing', async () => {
    const createDraft = vi.spyOn(createDraftModule, 'createDraft');
    createDraft.mockClear();
    createDraft.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/prompt-packages/missing/draft',
      payload: { text: 'DRAFT TEXT' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  },
);
