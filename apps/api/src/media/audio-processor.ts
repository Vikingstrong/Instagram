import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { voiceMessageRules } from '@instagram/contracts';
import { ffmpegPath } from './video-processor.js';
import { AuthError } from '../auth/auth.error.js';

// Bounded stdout, stderr, wall time and protocol access. Never log decoder input.
function run(args: string[], maxBytes = 64 * 1024) {
  return new Promise<{ code: number | null; data: Buffer; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(ffmpegPath(), args, { windowsHide: true });
      const chunks: Buffer[] = [];
      let length = 0;
      let overflow = false;
      let stderr = '';
      const timeout = setTimeout(() => child.kill('SIGKILL'), 30_000);
      child.stdout.on('data', (data: Buffer) => {
        length += data.length;
        if (length > maxBytes) {
          overflow = true;
          child.kill('SIGKILL');
        } else chunks.push(data);
      });
      child.stderr.on('data', (data: Buffer) => {
        stderr = (stderr + data.toString()).slice(-64 * 1024);
      });
      child.on('error', () => {
        clearTimeout(timeout);
        reject(new AuthError('INVALID_AUDIO'));
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (overflow) reject(new AuthError('AUDIO_TOO_LONG'));
        else resolve({ code, data: Buffer.concat(chunks), stderr });
      });
    },
  );
}

@Injectable()
export class AudioProcessor {
  private busy = false;
  private readonly waiting: (() => void)[] = [];
  private readonly idleWaiters: (() => void)[] = [];

  idle(): Promise<void> {
    return this.busy
      ? new Promise((resolve) => this.idleWaiters.push(resolve))
      : Promise.resolve();
  }

  async process(
    input: Buffer,
    work: string,
  ): Promise<{ file: string; durationMs: number; opus: string }> {
    if (!input.length) throw new AuthError('INVALID_AUDIO');
    if (input.length > voiceMessageRules.maxBytes)
      throw new AuthError('AUDIO_TOO_LARGE');
    // One encoder at a time and at most four waiting uploads.
    if (this.busy) {
      if (this.waiting.length >= 4)
        throw new AuthError('SERVICE_UNAVAILABLE', 2);
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else this.busy = true;
    try {
      const original = join(work, 'original');
      const pcm = join(work, 'decoded.pcm');
      const file = join(work, 'audio.m4a');
      const opus = join(work, 'audio.webm');
      await writeFile(original, input, { mode: 0o600 });
      const options = [
        '-hide_banner',
        '-nostdin',
        '-protocol_whitelist',
        'file,pipe',
        '-format_whitelist',
        'mov,matroska,webm,ogg,wav,mp3',
        '-threads',
        '1',
      ];
      const probe = await run([...options, '-i', original]);
      const container = /Input #0, ([^ ]+), from /.exec(probe.stderr)?.[1];
      if (
        !container ||
        !/^(?:mov,mp4,m4a,3gp,3g2,mj2|matroska,webm|ogg|wav|mp3)$/.test(
          container,
        ) ||
        !/Stream #0:\d+[^\n]*: Audio: /.test(probe.stderr) ||
        /Stream #0:\d+[^\n]*: Video: /.test(probe.stderr)
      )
        throw new AuthError('INVALID_AUDIO');
      // Browser MediaRecorder WebM may have no container duration. Decode only
      // 180.1s and measure samples; a forged/missing duration cannot bypass this.
      const decoded = await run(
        [
          ...options,
          '-i',
          original,
          '-map',
          '0:a:0',
          '-vn',
          '-t',
          '180.1',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-f',
          's16le',
          'pipe:1',
        ],
        180_200 * 32,
      );
      if (decoded.code !== 0 || !decoded.data.length || decoded.data.length % 2)
        throw new AuthError('INVALID_AUDIO');
      const durationMs = Math.ceil(decoded.data.length / 32);
      if (durationMs > voiceMessageRules.maxDurationMs)
        throw new AuthError('AUDIO_TOO_LONG');
      await writeFile(pcm, decoded.data, { mode: 0o600 });
      const encoded = await run([
        '-hide_banner',
        '-nostdin',
        '-y',
        '-f',
        's16le',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-i',
        pcm,
        '-map_metadata',
        '-1',
        '-map_chapters',
        '-1',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-threads',
        '1',
        '-movflags',
        '+faststart',
        file,
      ]);
      if (encoded.code !== 0 || !(await readFile(file)).length)
        throw new AuthError('INVALID_AUDIO');
      const webm = await run([
        '-hide_banner',
        '-nostdin',
        '-y',
        '-f',
        's16le',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-i',
        pcm,
        '-map_metadata',
        '-1',
        '-map_chapters',
        '-1',
        '-c:a',
        'libopus',
        '-b:a',
        '32k',
        '-threads',
        '1',
        opus,
      ]);
      if (webm.code !== 0) throw new AuthError('INVALID_AUDIO');
      return { file, opus, durationMs };
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else {
        this.busy = false;
        this.idleWaiters.splice(0).forEach((resolve) => resolve());
      }
    }
  }
}
