import { Inject, Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { videoUploadRules } from '@instagram/contracts';
import { AuthError } from '../auth/auth.error.js';
import { ImageProcessor, type ProcessedImage } from './image-processor.js';

export type VideoInfo = {
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

export type ProcessedVideo = {
  // The transcoded MP4 inside the work directory.
  file: string;
  durationMs: number;
} & ProcessedImage;

const require = createRequire(import.meta.url);
// The pinned ffmpeg-static binary; FFMPEG_PATH may point to a system ffmpeg.
export function ffmpegPath(env: NodeJS.ProcessEnv = process.env): string {
  const path = env.FFMPEG_PATH || (require('ffmpeg-static') as string | null);
  if (!path) throw new Error('No ffmpeg binary for this platform.');
  return path;
}

const TIMEOUT_MS = 5 * 60_000;
// Containers ffmpeg reports for MP4/MOV and WebM input.
const containers = /^(?:mov,mp4,m4a,3gp,3g2,mj2|matroska,webm)$/;
// A little slack: containers round the duration.
const DURATION_SLACK_MS = 500;
// Longest side of the result; even sizes are required by H.264.
const SCALE =
  "scale=w='if(gte(iw,ih),trunc(min(1080,iw)/2)*2,-2)':h='if(gte(iw,ih),-2,trunc(min(1080,ih)/2)*2)',format=yuv420p";

type Run = { code: number | null; stdout: Buffer; stderr: string };

// Runs ffmpeg without a shell; stderr is kept only up to a small tail.
function run(binary: string, args: string[], timeoutMs: number): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    const out: Buffer[] = [];
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-64 * 1024);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out), stderr });
    });
  });
}

// Reads what ffmpeg says about an input. No ffprobe: the same binary both
// checks and transcodes. The checked facts are the container, the duration
// and a real video stream (cover art of an audio file does not count).
export function parseInput(stderr: string): VideoInfo {
  const container = /Input #0, ([^ ]+), from /.exec(stderr)?.[1];
  const duration = /Duration: (\d+):(\d{2}):(\d{2})\.(\d+)/.exec(stderr);
  const videos = [...stderr.matchAll(/Stream #0:\d+[^\n]*: Video: ([^\n]*)/g)]
    .map((match) => match[1]!)
    .filter((line) => !line.includes('(attached pic)'));
  const size = videos.length
    ? /, (\d{1,5})x(\d{1,5})[ ,[]/.exec(videos[0]!)
    : null;
  if (!container || !containers.test(container) || !duration || !size)
    throw new AuthError('INVALID_VIDEO');
  const [, hours, minutes, seconds, fraction] = duration;
  const durationMs =
    ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 +
    Math.round(Number(`0.${fraction}`) * 1000);
  const width = Number(size[1]);
  const height = Number(size[2]);
  if (
    durationMs <= 0 ||
    width <= 0 ||
    height <= 0 ||
    width > videoUploadRules.maxDimension ||
    height > videoUploadRules.maxDimension
  )
    throw new AuthError('INVALID_VIDEO');
  if (durationMs > videoUploadRules.maxDurationMs + DURATION_SLACK_MS)
    throw new AuthError('VIDEO_TOO_LONG');
  return {
    durationMs,
    width,
    height,
    hasAudio: /Stream #0:\d+[^\n]*: Audio: /.test(stderr),
  };
}

// FR-10 video pipeline: check the decoded input, transcode it to H.264/AAC
// MP4 (longest side up to 1080 px, metadata dropped, moov atom first for
// streaming) and take a poster frame through the image pipeline. One video
// at a time: transcoding is CPU-heavy and shares the single API process.
@Injectable()
export class VideoProcessor {
  private busy: Promise<unknown> = Promise.resolve();
  private readonly binary = ffmpegPath();

  constructor(
    @Inject(ImageProcessor) private readonly images: ImageProcessor,
  ) {}

  async inspect(file: string): Promise<VideoInfo> {
    const result = await run(
      this.binary,
      ['-hide_banner', '-nostdin', '-i', file],
      30_000,
    );
    return parseInput(result.stderr);
  }

  process(input: string, workDir: string): Promise<ProcessedVideo> {
    const next = this.busy.then(
      () => this.transcode(input, workDir),
      () => this.transcode(input, workDir),
    );
    this.busy = next.catch(() => undefined);
    return next;
  }

  private async transcode(
    input: string,
    workDir: string,
  ): Promise<ProcessedVideo> {
    // Refuses wrong containers, missing video, oversize and overlong input
    // before any encoding work.
    await this.inspect(input);
    const file = join(workDir, 'video.mp4');
    const encoded = await run(
      this.binary,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-i',
        input,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-map_metadata',
        '-1',
        '-map_chapters',
        '-1',
        '-t',
        String((videoUploadRules.maxDurationMs + DURATION_SLACK_MS) / 1000),
        '-vf',
        SCALE,
        '-c:v',
        'libx264',
        '-profile:v',
        'main',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        file,
      ],
      TIMEOUT_MS,
    );
    if (encoded.code !== 0) throw new AuthError('INVALID_VIDEO');
    const result = await this.inspect(file);
    // Poster: a frame at 1 s (or mid-way through a shorter clip).
    const at = Math.min(1, result.durationMs / 2000).toFixed(3);
    const frame = await run(
      this.binary,
      [
        '-hide_banner',
        '-nostdin',
        '-ss',
        at,
        '-i',
        file,
        '-frames:v',
        '1',
        '-f',
        'image2pipe',
        '-c:v',
        'png',
        'pipe:1',
      ],
      60_000,
    );
    if (frame.code !== 0 || frame.stdout.length === 0)
      throw new AuthError('INVALID_VIDEO');
    const poster = await this.images.process(frame.stdout);
    return {
      file,
      durationMs: result.durationMs,
      ...poster,
      // The video's own size, not the poster's resized one.
      width: result.width,
      height: result.height,
    };
  }
}
