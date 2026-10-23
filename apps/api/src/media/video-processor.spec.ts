import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { AuthError } from '../auth/auth.error.js';
import { ImageProcessor } from './image-processor.js';
import { ffmpegPath, parseInput, VideoProcessor } from './video-processor.js';

const ffmpeg = promisify(execFile);
let dir: string;
const processor = new VideoProcessor(new ImageProcessor());

// Synthetic clips made by the same ffmpeg: no binary fixtures in Git.
async function clip(name: string, args: string[]): Promise<string> {
  const file = join(dir, name);
  await ffmpeg(ffmpegPath(), ['-hide_banner', '-y', ...args, file]);
  return file;
}
const testsrc = (size: string, seconds: number, rate = 25) => [
  '-f',
  'lavfi',
  '-i',
  `testsrc=size=${size}:rate=${rate}:duration=${seconds}`,
];
const tone = (seconds: number) => [
  '-f',
  'lavfi',
  '-i',
  `sine=frequency=440:duration=${seconds}`,
];
async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AuthError) return error.code;
    throw error;
  }
  throw new Error('accepted an invalid video');
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'instagram-video-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('VideoProcessor', () => {
  it('transcodes to H.264/AAC MP4 within 1080 px, drops metadata and makes a poster', async () => {
    const input = await clip('landscape.mov', [
      ...testsrc('1920x1080', 2),
      ...tone(2),
      '-metadata',
      'title=secret-location',
      '-c:v',
      'libx264',
      '-c:a',
      'aac',
      '-shortest',
    ]);
    const work = await mkdtemp(join(dir, 'work-'));
    const result = await processor.process(input, work);
    expect(result.width).toBe(1080);
    expect(result.height).toBe(608);
    expect(Math.abs(result.durationMs - 2000)).toBeLessThan(150);

    const { stderr } = await ffmpeg(ffmpegPath(), [
      '-hide_banner',
      '-i',
      result.file,
    ]).catch((error: { stderr: string }) => error);
    expect(stderr).toMatch(/Video: h264 \(Main\)/);
    expect(stderr).toMatch(/Audio: aac/);
    expect(stderr).not.toContain('secret-location');

    const full = await sharp(result.full).metadata();
    const thumb = await sharp(result.thumb).metadata();
    expect(full.format).toBe('webp');
    expect([full.width, full.height]).toEqual([1080, 608]);
    expect([thumb.width, thumb.height]).toEqual([480, 480]);
  }, 60_000);

  it('accepts a silent portrait WebM and keeps the long side at 1080', async () => {
    const input = await clip('portrait.webm', [
      ...testsrc('720x1280', 1),
      '-c:v',
      'libvpx',
      '-b:v',
      '500k',
    ]);
    const info = await processor.inspect(input);
    expect(info).toMatchObject({ width: 720, height: 1280, hasAudio: false });
    const result = await processor.process(
      input,
      await mkdtemp(join(dir, 'work-')),
    );
    expect([result.width, result.height]).toEqual([608, 1080]);
  }, 60_000);

  it('refuses videos longer than 90 seconds before encoding', async () => {
    const input = await clip('long.mp4', [
      ...testsrc('160x120', 95, 1),
      '-c:v',
      'libx264',
    ]);
    expect(await rejection(processor.inspect(input))).toBe('VIDEO_TOO_LONG');
  }, 60_000);

  it('refuses damaged files, pictures, audio-only files and oversize frames', async () => {
    const garbage = join(dir, 'garbage.mp4');
    await writeFile(garbage, randomBytes(4096));
    const picture = join(dir, 'picture.mp4');
    await writeFile(
      picture,
      await sharp({
        create: { width: 64, height: 64, channels: 3, background: '#000' },
      })
        .png()
        .toBuffer(),
    );
    const audio = await clip('audio.m4a', [...tone(1), '-c:a', 'aac']);
    const wide = await clip('wide.mp4', [
      ...testsrc('4160x96', 0.2),
      '-c:v',
      'libx264',
    ]);
    for (const file of [garbage, picture, audio, wide])
      expect(await rejection(processor.inspect(file))).toBe('INVALID_VIDEO');
  }, 60_000);
});

describe('parseInput', () => {
  const header = (container: string, duration: string, streams: string) =>
    `Input #0, ${container}, from 'x':\n  Duration: ${duration}, start: 0.000000, bitrate: 1 kb/s\n${streams}`;
  const video =
    '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 640x360 [SAR 1:1 DAR 16:9], 25 fps\n';

  it('reads duration, size and audio', () => {
    expect(
      parseInput(
        header(
          'mov,mp4,m4a,3gp,3g2,mj2',
          '00:01:29.96',
          video + '  Stream #0:1: Audio: aac (LC), 44100 Hz, stereo\n',
        ),
      ),
    ).toEqual({ durationMs: 89_960, width: 640, height: 360, hasAudio: true });
  });

  it('ignores cover art and unknown containers', () => {
    expect(() =>
      parseInput(
        header(
          'mov,mp4,m4a,3gp,3g2,mj2',
          '00:00:03.00',
          '  Stream #0:0: Audio: aac\n  Stream #0:1: Video: mjpeg, yuvj420p, 300x300, 90k tbr (attached pic)\n',
        ),
      ),
    ).toThrow(AuthError);
    expect(() => parseInput(header('avi', '00:00:03.00', video))).toThrow(
      AuthError,
    );
    expect(() =>
      parseInput(header('mov,mp4,m4a,3gp,3g2,mj2', 'N/A', video)),
    ).toThrow(AuthError);
  });
});
