import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uploadFile = vi.hoisted(() => vi.fn());
vi.mock('../src/index.js', () => ({ uploadFile }));
vi.mock('@esl-pipeline/shared-infrastructure', () => ({ loadApplicationEnv: vi.fn() }));

const argv = process.argv;
const exitCode = process.exitCode;
beforeEach(() => {
  vi.resetModules();
  uploadFile
    .mockReset()
    .mockResolvedValue({ key: 'lessons/audio.mp3', url: 'https://example.com/audio.mp3' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.exitCode = undefined;
});
afterEach(() => {
  process.argv = argv;
  process.exitCode = exitCode;
  vi.restoreAllMocks();
});
async function run(...args: string[]) {
  process.argv = [process.execPath, 'storage-uploader', ...args];
  await import('../bin/cli.js');
}
describe('storage-uploader CLI', () => {
  it('forwards all four flags and prints the upload result', async () => {
    await run('--file', 'audio.mp3', '--prefix', 'lessons', '--public-read', '--presign', '3600');
    expect(uploadFile).toHaveBeenCalledWith('audio.mp3', {
      backend: 's3',
      prefix: 'lessons',
      public: true,
      presignExpiresIn: 3600,
    });
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ key: 'lessons/audio.mp3', url: 'https://example.com/audio.mp3' }, null, 2),
    );
    expect(process.exitCode).toBeUndefined();
  });
  it.each(['--help', '-h'])('prints help without requiring a file (%s)', async (flag) => {
    await run(flag);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Usage: storage-uploader'));
    expect(uploadFile).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
  it.each([
    [],
    ['--file'],
    ['--unknown'],
    ['--file', 'audio.mp3', '--presign', 'bad'],
    ['--file', 'audio.mp3', '--presign', '0'],
    ['--file', 'audio.mp3', '--presign', '1.5'],
  ])('rejects invalid arguments %j before uploading', async (...args) => {
    await run(...args);
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.any(String));
    expect(uploadFile).not.toHaveBeenCalled();
  });
  it('reports upload failures and exits unsuccessfully', async () => {
    uploadFile.mockRejectedValue(new Error('Upload failed'));
    await run('--file', 'audio.mp3');
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Upload failed');
  });
});
