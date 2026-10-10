import { useRef, useState } from 'react';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { sendChunksParallel } from './upload-chunks';

export interface UploadLog {
  timestamp: Date;
  message: string;
  type: 'info' | 'error' | 'success';
}

export interface PreparedFile {
  /** A file:// path inside the app sandbox — readable by FileSystem */
  uri: string;
  /** Rozmiar w bajtach */
  size: number;
}

export function useUpload(serverUrl: string) {
  const [logs, setLogs] = useState<UploadLog[]>([]);

  // Logs must not be sent to the server during a transfer: a concurrent POST /log
  // competes with POST /upload-chunk on the same tunnel and breaks the transfer
  // (the first fragment goes through, the next fails immediately).
  // Logs then land in a buffer and go to the server once the upload finishes.
  const remoteMuted = useRef(false);
  const bufferedRemote = useRef<{ level: string; message: string }[]>([]);

  // Cancellation request. A ref, not state: the upload loop must see the change
  // immediately, whereas a state value would stay stale inside the closure.
  const cancelRequested = useRef(false);

  /** Raises a cancellation request — takes effect mid-file, not only between files. */
  const requestCancel = () => {
    cancelRequested.current = true;
  };

  /** Clears the cancellation request — called at the start of every queue run. */
  const resetCancel = () => {
    cancelRequested.current = false;
  };

  const addLog = (message: string, type: UploadLog['type'] = 'info') => {
    setLogs(prev => [...prev, { timestamp: new Date(), message, type }]);

    if (remoteMuted.current) {
      bufferedRemote.current.push({ level: type, message });
      return;
    }

    // Mirror the log to the server console — transcribing from the phone screen is
    // inconvenient. Deliberately without await: logging must not block the main flow.
    fetch(`${serverUrl}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: type, message }),
    }).catch(() => {
      // Server unreachable — the log stays on the screen only
    });
  };

  /** Sends the buffered logs in one request — called after the transfer completes. */
  const flushBufferedLogs = async () => {
    const lines = bufferedRemote.current;
    bufferedRemote.current = [];
    if (lines.length === 0) {
      return;
    }
    try {
      await fetch(`${serverUrl}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines }),
      });
    } catch (e) {
      // The buffer is lost, but the logs are visible on the screen
    }
  };

  /**
   * Fetches full asset info from Photos.
   * Returns the ph:// URI (the library identifier) — that is what we use for copying,
   * because localUri (/var/mobile/Media/...) is outside the Expo Go sandbox and unreadable.
   */
  const getAssetInfo = async (assetId: string) => {
    try {
      const info = await MediaLibrary.getAssetInfoAsync(assetId, {
        shouldDownloadFromNetwork: false,
      });
      return info;
    } catch (e) {
      addLog(`getAssetInfoAsync error: ${String(e)}`, 'error');
      return null;
    }
  };

  /**
   * Kopiuje asset z biblioteki Photos do katalogu cache aplikacji.
   *
   * Why the copy is necessary: in Expo Go we have no entitlement to read
   * /var/mobile/Media/DCIM/... — every readAsStringAsync on that path ends with
   * "is not readable". copyAsync, by contrast, goes through the native Photos
   * framework and can pull the original into the sandbox.
   *
   * Note: this momentarily doubles the space used on the phone, which is why the
   * file is removed immediately after sending (see cleanupTempFile).
   */
  const copyAssetToSandbox = async (assetUri: string, fileName: string): Promise<PreparedFile | null> => {
    // localUri from Photos has a #<bookmark-base64> fragment appended — it has to be
    // cut off, otherwise the destination path becomes invalid.
    const cleanName = fileName.split('#')[0];
    const dest = `${FileSystem.cacheDirectory}upload_${cleanName}`;

    try {
      // Overwrite any leftover from an interrupted attempt
      const existing = await FileSystem.getInfoAsync(dest);
      if (existing.exists) {
        await FileSystem.deleteAsync(dest, { idempotent: true });
      }

      addLog(`Copying to sandbox: ${cleanName}`, 'info');
      await FileSystem.copyAsync({ from: assetUri, to: dest });

      const info = await FileSystem.getInfoAsync(dest);
      if (!info.exists) {
        addLog('Copy finished but file missing', 'error');
        return null;
      }

      const size = (info as any).size || 0;
      addLog(`Copied: ${size} B (${(size / 1024 / 1024).toFixed(2)} MB)`, 'success');
      return { uri: dest, size };
    } catch (e) {
      addLog(`copyAsync error: ${String(e)}`, 'error');
      return null;
    }
  };

  /** Removes the sandbox copy — always call after an upload finishes (or is cancelled). */
  const cleanupTempFile = async (uri: string) => {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
      addLog('Temp file removed', 'info');
    } catch (e) {
      addLog(`cleanup error: ${String(e)}`, 'error');
    }
  };

  const registerSession = async (
    sessionId: string,
    fileName: string,
    fileSize: number,
    metadata: Record<string, any>
  ): Promise<boolean> => {
    try {
      addLog(`Registering: ${sessionId}`, 'info');
      const resp = await fetch(`${serverUrl}/manifest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          file: { name: fileName, size: fileSize, ...metadata },
        }),
      });

      if (!resp.ok) {
        addLog(`Register failed: HTTP ${resp.status}`, 'error');
        return false;
      }

      const data = await resp.json();
      addLog(`Registered. Target: ${data.target_dir}`, 'success');
      addLog(`Already on server: ${data.uploaded} B`, 'info');
      return true;
    } catch (e) {
      addLog(`Register error: ${String(e)}`, 'error');
      return false;
    }
  };

  /**
   * Sends a file in fragments with resume support.
   *
   * The position of the next fragment comes from the server's response (`uploaded`),
   * not from a local counter — the server is the only source of truth about how many
   * bytes actually arrived. When the connection drops mid-request, a local counter
   * and the state of the file on disk can diverge.
   *
   * The body goes as base64, because React Native cannot send raw bytes through
   * fetch — the server decodes it based on the X-Encoding header.
   */
  /**
   * Sends a file in parallel, several chunks at a time.
   *
   * Replaces the sequential sendFileInChunks (which stays in the file in case
   * parallelism turns out too aggressive for the tunnel). The starting point comes
   * from /probe, so resuming works as before.
   */
  const sendFileParallel = async (
    sessionId: string,
    fileUri: string,
    fileSize: number,
    // Start: 3 connections of 64 KB. The tuning has headroom both ways — on a clean
    // link it reaches 3x1 MB, on an unreliable one it drops to 1x16 KB.
    // The earlier start of 4x128 KB was too aggressive on a network that lost data.
    parallel = 3,
    chunkSize = 64 * 1024
  ): Promise<boolean> => {
    remoteMuted.current = true;
    const startedAt = Date.now();
    try {
      let startOffset = 0;
      try {
        const probe = await fetch(`${serverUrl}/probe?session_id=${encodeURIComponent(sessionId)}`);
        if (probe.ok) {
          startOffset = (await probe.json()).uploaded || 0;
          if (startOffset > 0) {
            addLog(`Resuming at ${startOffset} B`, 'info');
          }
        }
      } catch (e) {
        addLog(`probe error: ${String(e)}`, 'error');
      }

      const result = await sendChunksParallel(
        serverUrl, sessionId, fileUri, fileSize, startOffset,
        { parallel, chunkSize, maxRetries: 5, isCancelled: () => cancelRequested.current },
        addLog
      );

      const secs = (Date.now() - startedAt) / 1000;
      if (result.cancelled) {
        addLog('Cancelled — will resume from the saved point', 'info');
        return false;
      }
      if (result.ok) {
        const kbps = ((fileSize - startOffset) / 1024 / secs).toFixed(0);
        // The final settings are shown on purpose: they say what this tunnel is
        // actually stable at, so one can see whether the tuning had to back off.
        addLog(
          `Sent in ${secs.toFixed(1)}s (${kbps} kB/s, retries ${result.retries}, ` +
          `${result.finalParallel}×${result.finalChunkSize / 1024}KB)`,
          'success'
        );
      }
      return result.ok;
    } finally {
      remoteMuted.current = false;
      await flushBufferedLogs();
    }
  };

  const sendFileInChunks = async (
    sessionId: string,
    fileUri: string,
    fileSize: number,
    // 256 KB of raw data = ~350 KB once base64-encoded.
    // At 1 MB the ngrok tunnel (free plan) cut the request off mid-body: the client
    // got a 503 from ngrok and Flask a 400 from Werkzeug while reading the body.
    // The chunk size is tuned during the transfer rather than fixed up front.
    //
    // The reason: the bottleneck is not throughput but the number of requests — each
    // pays a full round trip to the ngrok edge (~130 ms) and the chunks go serially.
    // 28 MB at 32 KB is ~925 requests, i.e. minutes of pure waiting.
    //
    // The upper bound is not known in advance: 256 KB went through once, 1.4 MB never
    // did, and the tunnel is at times unstable (tls: bad record MAC). Rather than
    // guessing, we start cautiously, double after a run of successes and back off
    // after an error — the transfer finds the boundary itself, and a wrong guess
    // costs only a single retry.
    startChunkSize = 64 * 1024,
    maxChunkSize = 512 * 1024,
    minChunkSize = 16 * 1024,
    // How many times to retry a single chunk before declaring the transfer broken.
    // With hundreds of requests per file, one stumble must not kill the whole run.
    maxRetriesPerChunk = 5
  ): Promise<boolean> => {
    // The whole transfer runs with remote logging muted — see remoteMuted.
    remoteMuted.current = true;
    try {
      return await runChunkLoop(sessionId, fileUri, fileSize, {
        startChunkSize,
        maxChunkSize,
        minChunkSize,
        maxRetriesPerChunk,
      });
    } finally {
      remoteMuted.current = false;
      await flushBufferedLogs();
    }
  };

  /**
   * The actual upload loop. Split out of sendFileInChunks so that the log muting
   * covers every exit from the loop (including returns in the error branches).
   */
  const runChunkLoop = async (
    sessionId: string,
    fileUri: string,
    fileSize: number,
    opts: {
      startChunkSize: number;
      maxChunkSize: number;
      minChunkSize: number;
      maxRetriesPerChunk: number;
    }
  ): Promise<boolean> => {
    // Ask the server which byte to continue from (0 for a new file)
    let offset = 0;
    try {
      const probe = await fetch(`${serverUrl}/probe?session_id=${encodeURIComponent(sessionId)}`);
      if (probe.ok) {
        offset = (await probe.json()).uploaded || 0;
        if (offset > 0) {
          addLog(`Resuming at ${offset} B`, 'info');
        }
      }
    } catch (e) {
      addLog(`probe error: ${String(e)}`, 'error');
    }

    let lastReported = -1;
    let failuresInARow = 0;

    // Chunk-size tuning state
    let chunkSize = opts.startChunkSize;
    let okStreak = 0;
    // How many consecutive successful chunks are needed before trying to double the
    // size. Too few = constant up-and-down swings; too many = slow to reach the optimum.
    const streakToGrow = 3;
    const startedAt = Date.now();

    while (offset < fileSize) {
      const length = Math.min(chunkSize, fileSize - offset);

      let chunkB64: string;
      try {
        chunkB64 = await FileSystem.readAsStringAsync(fileUri, {
          encoding: FileSystem.EncodingType.Base64,
          position: offset,
          length,
        });
      } catch (e) {
        addLog(`read error at ${offset}: ${String(e)}`, 'error');
        return false;
      }

      let resp: Response | null = null;
      try {
        resp = await fetch(`${serverUrl}/upload-chunk`, {
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
      } catch (e) {
        resp = null;
      }

      // The chunk did not arrive (a network error, or rejection by the tunnel/server).
      // We do not guess the state — we ask the server what it actually has and retry
      // from that point.
      if (!resp || (!resp.ok && resp.status !== 409)) {
        failuresInARow += 1;
        okStreak = 0;
        const status = resp ? `HTTP ${resp.status}` : 'network error';

        // Shrink the chunk — we have most likely just exceeded what the tunnel can
        // push through in a single request.
        if (chunkSize > opts.minChunkSize) {
          chunkSize = Math.max(opts.minChunkSize, Math.floor(chunkSize / 2));
          addLog(`${status} — chunk down to ${chunkSize / 1024} KB`, 'info');
        }

        if (failuresInARow > opts.maxRetriesPerChunk) {
          addLog(`Aborted at ${offset} B after ${opts.maxRetriesPerChunk} retries (${status})`, 'error');
          return false;
        }

        // The delay grows with every attempt — giving the tunnel time to recover.
        await new Promise(res => setTimeout(res, 300 * failuresInARow));

        const serverOffset = await fetchServerOffset(sessionId);
        if (serverOffset === null) {
          continue;
        }
        offset = serverOffset;
        continue;
      }

      // The server's state differs from ours — move to its position (it is the truth)
      if (resp.status === 409) {
        const data = await resp.json();
        if (typeof data.expected === 'number') {
          addLog(`Offset mismatch, jumping to ${data.expected}`, 'info');
          offset = data.expected;
          continue;
        }
        addLog(`Conflict: ${data.message}`, 'error');
        return false;
      }

      const data = await resp.json();
      offset = data.uploaded;
      failuresInARow = 0;
      okStreak += 1;

      // A run of successes — try a bigger chunk, i.e. fewer round trips per megabyte
      if (okStreak >= streakToGrow && chunkSize < opts.maxChunkSize) {
        chunkSize = Math.min(opts.maxChunkSize, chunkSize * 2);
        okStreak = 0;
        addLog(`chunk up to ${chunkSize / 1024} KB`, 'info');
      }

      // Log every 10% — otherwise a large file would flood the screen (hundreds of chunks)
      const pct = Math.floor((offset / fileSize) * 10) * 10;
      if (pct !== lastReported) {
        lastReported = pct;
        const kbps = offset / 1024 / ((Date.now() - startedAt) / 1000);
        addLog(`${pct}% (${offset}/${fileSize} B, ${kbps.toFixed(0)} kB/s)`, 'info');
      }

      if (data.status === 'done') {
        const secs = (Date.now() - startedAt) / 1000;
        addLog(`Saved in ${secs.toFixed(1)}s: ${data.target_file}`, 'success');
        return true;
      }
    }

    return true;
  };

  /** Asks the server how many bytes it has stored — used to resume after a chunk error. */
  const fetchServerOffset = async (sessionId: string): Promise<number | null> => {
    try {
      const resp = await fetch(`${serverUrl}/probe?session_id=${encodeURIComponent(sessionId)}`);
      if (!resp.ok) {
        return null;
      }
      return (await resp.json()).uploaded ?? null;
    } catch (e) {
      return null;
    }
  };

  /**
   * Sends a file in one request, natively (no base64 and no string in JS).
   *
   * The reason: fetch in React Native declared a Content-Length and then dropped the
   * connection before sending the body (Flask: ClientDisconnected, client: 503).
   * The same fragment sent with curl through the same tunnel went through without
   * error, so the problem lies in the JS layer, not in the tunnel or the backend.
   *
   * uploadAsync streams the file from disk in native code. The limitation: it cannot
   * send a slice of a file, so resuming here is at whole-file level rather than per
   * fragment. That is why we send with offset 0 and the server must start from zero
   * (see resetSession).
   */
  const uploadWholeFile = async (
    sessionId: string,
    fileUri: string
  ): Promise<boolean> => {
    remoteMuted.current = true;
    try {
      addLog('Native upload (single request)...', 'info');

      const result = await FileSystem.uploadAsync(`${serverUrl}/upload-chunk`, fileUri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          'X-Session-Id': sessionId,
          'X-Offset': '0',
          // no X-Encoding: the body is raw bytes, the server does not decode base64
        },
      });

      if (result.status !== 200) {
        addLog(`Upload failed: HTTP ${result.status} — ${String(result.body).slice(0, 200)}`, 'error');
        return false;
      }

      const data = JSON.parse(result.body);
      addLog(`${data.uploaded}/${data.size} B`, 'info');
      if (data.status === 'done') {
        addLog(`Saved: ${data.target_file}`, 'success');
        return true;
      }

      addLog(`Server reports incomplete: ${data.uploaded}/${data.size}`, 'error');
      return false;
    } catch (e) {
      addLog(`uploadAsync error: ${String(e)}`, 'error');
      return false;
    } finally {
      remoteMuted.current = false;
      await flushBufferedLogs();
    }
  };

  /**
   * Returns the library's albums along with their item counts.
   *
   * Albums are the natural unit of selection: iOS groups material into them itself
   * (Camera Roll, Screenshots, WhatsApp, ...), which covers the requirement of
   * "separate source = separate subdirectory" without manual classification.
   */
  const listAlbums = async () => {
    try {
      const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });

      // For each album we fetch the video and photo counts separately — otherwise
      // there is no telling whether the album contains anything we want at all.
      const described = await Promise.all(
        albums.map(async album => {
          const videos = await MediaLibrary.getAssetsAsync({
            album,
            mediaType: ['video'],
            first: 1,
          });
          const photos = await MediaLibrary.getAssetsAsync({
            album,
            mediaType: ['photo'],
            first: 1,
          });
          return {
            id: album.id,
            title: album.title,
            total: album.assetCount ?? 0,
            videos: videos.totalCount ?? 0,
            photos: photos.totalCount ?? 0,
          };
        })
      );

      // Empty albums only clutter the list
      const nonEmpty = described.filter(a => a.videos > 0 || a.photos > 0);
      nonEmpty.sort((a, b) => b.total - a.total);

      addLog(`Albums: ${nonEmpty.length} non-empty of ${albums.length}`, 'success');
      return nonEmpty;
    } catch (e) {
      addLog(`listAlbums error: ${String(e)}`, 'error');
      return [];
    }
  };

  /**
   * Identyfikator sesji dla assetu.
   *
   * We use the Photos asset identifier rather than a filename plus size: the size is
   * only known after copying into the sandbox, while the queue must be able to ask
   * "do you already have this file" BEFORE performing an expensive copy.
   *
   * On iOS the identifier contains slashes (UUID/L0/001), so we sanitise it into a
   * form safe to use as a filename on the server side.
   */
  const sessionIdFor = (assetId: string) => assetId.replace(/[^A-Za-z0-9_-]/g, '_');

  /** Asks the server whether the file is already fully downloaded. */
  const isAlreadyUploaded = async (sessionId: string): Promise<boolean> => {
    try {
      const resp = await fetch(`${serverUrl}/have?session_id=${encodeURIComponent(sessionId)}`);
      if (!resp.ok) {
        return false;
      }
      return (await resp.json()).done === true;
    } catch (e) {
      // No answer is treated as "not held" — better to send twice than to skip a
      // file that is not on disk.
      return false;
    }
  };

  /**
   * Processes a single asset from start to finish.
   * Returns 'skipped' (already on the server), 'done' or 'failed'.
   */
  const uploadAsset = async (asset: {
    id: string;
    uri: string;
    filename: string;
    width: number;
    height: number;
    duration: number;
    mediaType: string;
  }): Promise<'done' | 'skipped' | 'failed'> => {
    const sessionId = sessionIdFor(asset.id);

    // Cancellation is checked before copying: copying large material takes time and
    // space on the phone, so after Stop there is no point starting it.
    if (cancelRequested.current) {
      return 'failed';
    }

    if (await isAlreadyUploaded(sessionId)) {
      addLog(`skip (already on server): ${asset.filename}`, 'info');
      return 'skipped';
    }

    const info = await getAssetInfo(asset.id);
    if (!info) {
      return 'failed';
    }

    const prepared = await copyAssetToSandbox(asset.uri, asset.filename);
    if (!prepared) {
      return 'failed';
    }

    const location = (info as any).location || {};
    const ok = await registerSession(sessionId, asset.filename, prepared.size, {
      timestamp: (info as any).creationTime || (info as any).modificationTime,
      latitude: location.latitude ?? 0,
      longitude: location.longitude ?? 0,
      width: asset.width,
      height: asset.height,
      duration: asset.duration,
      mediaType: asset.mediaType,
    });

    if (!ok) {
      await cleanupTempFile(prepared.uri);
      return 'failed';
    }

    const sent = await sendFileParallel(sessionId, prepared.uri, prepared.size);

    // The copy is always removed — including after a failure. The phone is short of
    // space, and resuming relies on the server-side state anyway, not on this copy.
    await cleanupTempFile(prepared.uri);

    return sent ? 'done' : 'failed';
  };

  return {
    logs,
    addLog,
    getAssetInfo,
    copyAssetToSandbox,
    cleanupTempFile,
    registerSession,
    sendFileInChunks,
    sendFileParallel,
    uploadWholeFile,
    listAlbums,
    uploadAsset,
    sessionIdFor,
    isAlreadyUploaded,
    requestCancel,
    resetCancel,
  };
}
