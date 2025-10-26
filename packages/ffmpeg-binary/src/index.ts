import { platform, arch } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

export function getPlatformTriplet(): string {
  const os = platform();
  let osPart: string;
  if (os === 'linux') osPart = 'linux';
  else if (os === 'darwin') osPart = 'macos';
  else if (os === 'win32') osPart = 'win32';
  else throw new Error(`Unsupported platform: ${os}`);

  const archPart = arch() === 'x64' ? 'x64' : arch() === 'arm64' ? 'arm64' : 'unknown';
  return `${osPart}-${archPart}`;
}

export function getVendoredArchivePath(): string {
  const triplet = getPlatformTriplet();
  return join(PKG_ROOT, 'bin', `${triplet}.tar.xz`);
}

export function getExtractedCachePath(): string {
  const triplet = getPlatformTriplet();
  return join(PKG_ROOT, 'dist', 'bin', triplet, 'ffmpeg');
}

export async function ensureExtracted(): Promise<void> {
  const cachePath = getExtractedCachePath();
  const archivePath = getVendoredArchivePath();

  // Check if already extracted and valid
  if (existsSync(cachePath) && await isExecutable(cachePath)) {
    return;
  }

  // Check if archive exists
  if (!existsSync(archivePath)) {
    throw new Error(`Vendored archive not found: ${archivePath}`);
  }

  // Use lock file for concurrency
  const lockPath = `${cachePath}.lock`;
  const lockFd = await fs.open(lockPath, 'wx').catch(() => null);
  if (!lockFd) {
    throw new Error('Another process is extracting FFmpeg');
  }

  try {
    await extractArchive(archivePath, cachePath);
  } finally {
    await lockFd.close();
    await fs.unlink(lockPath).catch(() => {});
  }
}

async function extractArchive(archivePath: string, outputPath: string): Promise<void> {
  const outputDir = dirname(outputPath);
  const stagingDir = `${outputDir}.staging`;

  // Clean staging
  await fs.rm(stagingDir, { recursive: true, force: true });

  // Create staging
  await fs.mkdir(stagingDir, { recursive: true });

  // Extract to staging
  if (platform() === 'win32') {
    await extractZip(archivePath, stagingDir);
  } else {
    await extractTarXz(archivePath, stagingDir);
  }

  // Find ffmpeg binary in staging
  const ffmpegPath = await findFfmpegInDir(stagingDir);
  if (!ffmpegPath) {
    throw new Error('FFmpeg binary not found in extracted archive');
  }

  // Move to final location atomically
  await fs.rename(ffmpegPath, outputPath);

  // Set permissions
  if (platform() !== 'win32') {
    await fs.chmod(outputPath, 0o755);
  }

  // Write BUILD.txt
  const buildInfo = `Extracted at ${new Date().toISOString()}\nVersion: ${process.env.npm_package_version || 'unknown'}\n`;
  await fs.writeFile(join(dirname(outputPath), 'BUILD.txt'), buildInfo);

  // Clean staging
  await fs.rm(stagingDir, { recursive: true, force: true });
}

async function extractTarXz(input: string, outDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('tar', ['-xJf', input, '--strip-components=1', '-C', outDir], { stdio: 'inherit' });
    proc.on('error', reject);
    proc.on('exit', code => code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`)));
  });
}

async function extractZip(input: string, outDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cmd = 'powershell';
    const args = ['-NoProfile', '-Command', `Expand-Archive -Path "${input}" -DestinationPath "${outDir}" -Force`];
    const proc = spawn(cmd, args, { stdio: 'inherit' });
    proc.on('error', reject);
    proc.on('exit', code => code === 0 ? resolve() : reject(new Error(`Expand-Archive exited with ${code}`)));
  });
}

async function findFfmpegInDir(dir: string): Promise<string | null> {
  // Simple search for ffmpeg binary
  const candidates = ['ffmpeg', 'ffmpeg.exe', 'bin/ffmpeg', 'bin/ffmpeg.exe'];
  for (const candidate of candidates) {
    const path = join(dir, candidate);
    if (existsSync(path)) return path;
  }
  return null;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await fs.access(path, fs.constants.F_OK | fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function isExecutableCmd(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, ['-version'], { stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('exit', code => resolve(code === 0));
  });
}

export async function getFfmpegPath(): Promise<string> {
  // 1. FFMPEG_PATH env var
  if (process.env.FFMPEG_PATH) {
    if (await isExecutable(process.env.FFMPEG_PATH)) {
      return process.env.FFMPEG_PATH;
    }
  }

  // 2. Extracted cache
  const cachePath = getExtractedCachePath();
  if (existsSync(cachePath) && await isExecutable(cachePath)) {
    return cachePath;
  }

  // 3. Vendored archive - extract if exists
  const archivePath = getVendoredArchivePath();
  if (existsSync(archivePath)) {
    await ensureExtracted();
    if (existsSync(cachePath) && await isExecutable(cachePath)) {
      return cachePath;
    }
  }

  // 4. System PATH
  const systemPath = platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  if (await isExecutableCmd(systemPath)) {
    return systemPath;
  }

  throw new Error('FFmpeg not found. Please install FFmpeg or set FFMPEG_PATH environment variable.');
}