import * as FileSystem from 'expo-file-system/legacy';

/**
 * Parallel upload of file chunks with automatic tuning.
 *
 * Why parallel: the bottleneck is not throughput but the number of round trips to
 * the server. With ~130 ms of latency on the ngrok tunnel, a chunk sent only after
 * the previous one is acknowledged wastes that time idling. Several chunks in
 * flight make the latencies overlap instead of adding up.
 *
 * Why tuning: the tunnel has an unknown limit on how much data it will digest at
 * once. A single 256 KB chunk sometimes went through, 1.4 MB never did, and four
 * parallel 128 KB chunks (half a megabyte in flight) produced runs of errors.
 * Rather than guessing the right settings, we start cautiously, back off after
 * errors and climb back up after a longer run of successes.
 *
 * Requires a server that accepts chunks at any position (X-Offset) and remembers
 * the received ranges — otherwise fragments arriving out of order would leave
 * holes in the file.
 */

export interface ParallelOptions {
  /** How many chunks in flight at the start. May be reduced while running. */
  parallel: number;
  /** Chunk size at the start, in raw bytes (before base64). */
  chunkSize: number;
  /** How many times to retry the same chunk before giving up. */
  maxRetries: number;
  /** Lower bound on chunk size — we never go below it. */
  minChunkSize?: number;
  /** Upper bound on chunk size when climbing back up. */
  maxChunkSize?: number;
  /**
   * Cancellation query, checked before every chunk.
   *
   * Necessary, because without it cancellation only takes effect between files —
   * with half-gigabyte material the Stop button would be ignored for a quarter
   * of an hour.
   */
  isCancelled?: () => boolean;
}

export interface ParallelResult {
  ok: boolean;
  targetFile?: string;
  /** How many chunk retries were needed — a measure of the tunnel's unreliability. */
  retries: number;
  /** The settings the transfer settled on. */
  finalChunkSize: number;
  finalParallel: number;
  /** Whether the user cancelled (rather than an error) — then we report no failure. */
  cancelled: boolean;
}

/** How many consecutive failures trigger backing the settings off. */
const FAILURES_BEFORE_SHRINK = 2;
/** How many consecutive successes allow cautiously raising the settings. */
const SUCCESSES_BEFORE_GROW = 25;

export async function sendChunksParallel(
  serverUrl: string,
  sessionId: string,
  fileUri: string,
  fileSize: number,
  startOffset: number,
  opts: ParallelOptions,
  log: (msg: string, type?: 'info' | 'error' | 'success') => void
): Promise<ParallelResult> {
  const minChunk = opts.minChunkSize ?? 16 * 1024;
  // A 1 MB ceiling, not 256 KB: the original limit was chosen for a Wi-Fi network
  // that was corrupting the transmission (tls: bad record MAC). On a clean link the
  // tuning reached the old maximum with zero retries, so it was set too low.
  // Should the link prove unreliable again, the back-off mechanism will descend
  // on its own.
  const maxChunk = opts.maxChunkSize ?? 1024 * 1024;

  // State shared by all workers. JS is single-threaded and preemption only happens
  // at an await, so no locks are needed for consistency.
  const state = {
    cursor: startOffset,
    chunkSize: opts.chunkSize,
    activeLimit: opts.parallel,
    failStreak: 0,
    okStreak: 0,
    retries: 0,
    aborted: false,
    cancelled: false,
    targetFile: undefined as string | undefined,
    lastPct: -1,
  };

  /** Whether the user has requested cancellation. */
  const cancelled = () => Boolean(opts.isCancelled?.());

  /** Back off after a run of errors: smaller chunk first, then fewer connections. */
  const shrink = () => {
    if (state.chunkSize > minChunk) {
      state.chunkSize = Math.max(minChunk, Math.floor(state.chunkSize / 2));
      log(`reducing chunk to ${state.chunkSize / 1024} KB`);
      return;
    }
    // The chunk is already at its smallest — reduce the number of concurrent
    // connections instead. We always keep one, or the transfer would halt.
    if (state.activeLimit > 1) {
      state.activeLimit -= 1;
      log(`reducing parallelism to ${state.activeLimit}`);
    }
  };

  /** Climb back up after a long run of successes — connections first, then chunk size. */
  const grow = () => {
    if (state.activeLimit < opts.parallel) {
      state.activeLimit += 1;
      log(`raising parallelism to ${state.activeLimit}`);
      return;
    }
    if (state.chunkSize < maxChunk) {
      state.chunkSize = Math.min(maxChunk, state.chunkSize * 2);
      log(`raising chunk to ${state.chunkSize / 1024} KB`);
    }
  };

  const sendOne = async (offset: number, length: number): Promise<boolean> => {
    let chunkB64: string;
    try {
      chunkB64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
        position: offset,
        length,
      });
    } catch (e) {
      log(`read error at ${offset}: ${String(e)}`, 'error');
      return false;
    }

    try {
      const resp = await fetch(`${serverUrl}/upload-chunk`, {
        method: 'POST',
        headers: {
          // text/plain, not application/octet-stream: the body is a base64 string,
          // and with octet-stream fetch in React Native declared a Content-Length
          // and then sent no body (Flask: ClientDisconnected, client: 503 from ngrok).
          'Content-Type': 'text/plain',
          'X-Session-Id': sessionId,
          'X-Offset': String(offset),
          'X-Encoding': 'base64',
        },
        body: chunkB64,
      });

      if (!resp.ok) {
        return false;
      }

      const data = await resp.json();
      if (data.status === 'done') {
        state.targetFile = data.target_file;
      }

      // Progress comes from `received` (the server's sum of ranges) — with
      // parallelism a local counter does not tell what actually arrived.
      const pct = Math.floor((data.received / fileSize) * 10) * 10;
      if (pct !== state.lastPct) {
        state.lastPct = pct;
        log(`${pct}% (${data.received}/${fileSize} B)`);
      }
      return true;
    } catch (e) {
      return false;
    }
  };

  /** One worker: takes positions from the shared cursor until the file ends. */
  const worker = async (id: number) => {
    while (!state.aborted) {
      // Cancellation is checked before every chunk, not only between files —
      // otherwise Stop would not respond for the whole transfer of large material.
      if (cancelled()) {
        state.cancelled = true;
        state.aborted = true;
        return;
      }

      // The worker withdraws when tuning dropped the limit below its own number
      if (id >= state.activeLimit) {
        return;
      }

      const offset = state.cursor;
      if (offset >= fileSize) {
        return;
      }
      // The size is read at the moment the position is taken, so a change made
      // mid-transfer applies from the next chunk and does not disturb those in flight.
      const length = Math.min(state.chunkSize, fileSize - offset);
      state.cursor = offset + length;

      let attempt = 0;
      let sent = false;
      while (attempt <= opts.maxRetries && !state.aborted) {
        // Also inside the retry loop: on an unreliable link the delays reach
        // seconds, and the user should not have to wait for the retries to run out.
        if (cancelled()) {
          state.cancelled = true;
          state.aborted = true;
          return;
        }
        sent = await sendOne(offset, length);
        if (sent) {
          break;
        }
        attempt += 1;
        state.retries += 1;
        state.okStreak = 0;
        state.failStreak += 1;
        if (state.failStreak >= FAILURES_BEFORE_SHRINK) {
          state.failStreak = 0;
          shrink();
        }
        // The delay grows with each attempt — the ngrok tunnel drops regularly
        // (tls: bad record MAC) and needs a moment to come back up.
        await new Promise(res => setTimeout(res, 300 * attempt));
      }

      if (!sent) {
        // We distinguish cancellation from failure: after Stop we print no error,
        // because nothing broke and the transfer will resume from the saved point.
        if (!state.cancelled) {
          log(`giving up at ${offset} B after ${opts.maxRetries} attempts`, 'error');
        }
        state.aborted = true;
        return;
      }

      state.failStreak = 0;
      state.okStreak += 1;
      if (state.okStreak >= SUCCESSES_BEFORE_GROW) {
        state.okStreak = 0;
        grow();
      }
    }
  };

  const workers = [];
  for (let i = 0; i < opts.parallel; i += 1) {
    workers.push(worker(i));
  }
  await Promise.all(workers);

  return {
    ok: !state.aborted,
    targetFile: state.targetFile,
    retries: state.retries,
    finalChunkSize: state.chunkSize,
    finalParallel: state.activeLimit,
    cancelled: state.cancelled,
  };
}
