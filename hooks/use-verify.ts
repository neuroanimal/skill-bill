import { useRef, useState } from 'react';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Verification: whether material on the phone is already safely stored on disk.
 *
 * Why: manually comparing a photo in the Photos app against a file in the directory
 * tree (name, time, place) means thousands of taps across 12.5k files. Here the
 * phone computes a content digest and asks the server whether it has exactly that file.
 *
 * Why MD5: it is the only digest Expo Go can compute on its own
 * (`getInfoAsync(uri, { md5: true })`). For detecting corruption and truncated
 * transfers it suffices; its cryptographic weakness is irrelevant here.
 *
 * Why not by name: after months iOS reuses the same IMG_XXXX names, and the
 * name-based dedup in client.py may have skipped a file with a repeated name.
 * A matching name is therefore evidence, not proof — the proof is the content.
 */

/** How we compute the digest. Determined by a probe, as Expo Go's abilities are not obvious. */
export type HashStrategy =
  /** getInfoAsync on localUri returns an MD5 — cheapest, no copying. */
  | 'localUri-md5'
  /** localUri yields only the size — weaker verification, without a digest. */
  | 'localUri-size'
  /** The asset must be copied into the sandbox, then hashed — costliest, but certain. */
  | 'sandbox-md5'
  /** Nothing works. */
  | 'none';

export type VerifyStatus =
  | 'verified'
  | 'size-match'
  | 'name-mismatch'
  | 'missing'
  | 'error';

export interface AssetVerdict {
  id: string;
  filename: string;
  size?: number;
  md5?: string;
  status: VerifyStatus;
  /** Where it sits on disk — to show the user. */
  place?: string;
  path?: string;
  /** How many copies of this content are on disk. */
  copies?: number;
  note?: string;
}

export interface ProbeResult {
  strategy: HashStrategy;
  lines: string[];
}

/**
 * A compact disk index held on the phone.
 *
 * `md5` and `name_size` store positions in the `paths` array rather than the paths
 * themselves — without that the same path would sit in the bundle twice and its size
 * grows from 1.9 MB to 4.6 MB.
 */
export interface Bundle {
  paths: string[];
  md5: Record<string, number>;
  name_size: Record<string, number>;
  files: number;
  unique_contents: number;
  built_at: string;
  /** When the phone fetched the bundle — to show how fresh it is. */
  fetched_at?: string;
  /**
   * An index by name alone, without size: name -> position in paths.
   *
   * This does NOT come from the server — we build it on the phone from the
   * `name_size` keys so as not to enlarge the downloaded bundle. It serves to tell
   * "there is nothing like it" apart from "there is a file of that name, but a
   * different one", which is an important hint when checking a mismatch by hand.
   */
  byName?: Record<string, number>;
}

// The bundle is stored in the documents directory, not in the cache: iOS may purge
// the cache when short of space, and a multi-hour run would then break for no reason.
const BUNDLE_FILE = 'verify-bundle.json';

export function useVerify(serverUrl: string) {
  const [log, setLog] = useState<string[]>([]);
  const cancelRef = useRef(false);

  const addLog = (line: string) => {
    setLog(prev => [...prev.slice(-400), line]);
  };

  const requestCancel = () => {
    cancelRef.current = true;
  };
  const resetCancel = () => {
    cancelRef.current = false;
  };

  /**
   * Determines the cheapest working method of computing a digest.
   *
   * Necessary, because in Expo Go access to Photos library files is restricted in a
   * way that cannot be read off the documentation: `readAsStringAsync` on the path
   * /var/mobile/Media/DCIM/... ends with "is not readable", yet `getInfoAsync` reads
   * metadata by a different route and may work. We check this on one item instead of
   * assuming the worse case for all — the difference is copying, or not copying,
   * several tens of gigabytes.
   */
  const probe = async (asset: { id: string; uri: string; filename: string }): Promise<ProbeResult> => {
    const lines: string[] = [];
    lines.push(`probing on: ${asset.filename}`);

    let info: MediaLibrary.AssetInfo | null = null;
    try {
      info = await MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: false });
      lines.push(`localUri: ${(info as any).localUri ? 'present' : 'MISSING'}`);
    } catch (e) {
      lines.push(`getAssetInfoAsync: ERROR ${String(e)}`);
    }

    const localUri = (info as any)?.localUri as string | undefined;

    // Attempt 1: MD5 straight from localUri — if it works, verification is nearly free
    if (localUri) {
      try {
        const res = await FileSystem.getInfoAsync(localUri, { md5: true });
        const size = (res as any).size;
        const md5 = (res as any).md5;
        lines.push(`getInfoAsync(localUri): exists=${res.exists} size=${size ?? '-'} md5=${md5 ? 'present' : 'none'}`);
        if (res.exists && md5) {
          lines.push('>>> strategy: localUri-md5 (cheapest, no copying)');
          return { strategy: 'localUri-md5', lines };
        }
        if (res.exists && typeof size === 'number' && size > 0) {
          lines.push('>>> localUri yields a size but no MD5');
          // We do not stop here: a size without a digest is weak verification, so we
          // also check whether the sandbox route is available.
        }
      } catch (e) {
        lines.push(`getInfoAsync(localUri): ERROR ${String(e)}`);
      }
    }

    // Attempt 2: sandbox copy + MD5 — the route known from uploading, so it should work
    try {
      const dest = `${FileSystem.cacheDirectory}probe_${asset.filename.split('#')[0]}`;
      const old = await FileSystem.getInfoAsync(dest);
      if (old.exists) {
        await FileSystem.deleteAsync(dest, { idempotent: true });
      }
      await FileSystem.copyAsync({ from: asset.uri, to: dest });
      const res = await FileSystem.getInfoAsync(dest, { md5: true });
      const md5 = (res as any).md5;
      lines.push(`sandbox: size=${(res as any).size ?? '-'} md5=${md5 ? md5.slice(0, 8) + '...' : 'none'}`);
      await FileSystem.deleteAsync(dest, { idempotent: true });
      if (md5) {
        lines.push('>>> strategy: sandbox-md5 (copying required, slower)');
        return { strategy: 'sandbox-md5', lines };
      }
    } catch (e) {
      lines.push(`sandbox: ERROR ${String(e)}`);
    }

    // Last resort: size alone from localUri
    if (localUri) {
      lines.push('>>> strategy: localUri-size (size only, verification incomplete)');
      return { strategy: 'localUri-size', lines };
    }

    lines.push('>>> no working method could be determined');
    return { strategy: 'none', lines };
  };

  /**
   * Derives an index by name alone from the "name|size" keys.
   *
   * Done on the phone rather than sent by the server, because the keys already carry
   * every name needed — sending them a second time would enlarge the bundle by some
   * 350 KB without adding any new information.
   *
   * Thanks to this, offline verdicts agree with the server's also when the name
   * matches but the size does not — without it such a case came out as "missing"
   * instead of "name-mismatch" (checked on 1500 cases).
   */
  const prepareBundle = (bundle: Bundle): Bundle => {
    if (bundle.byName) {
      return bundle;
    }
    const byName: Record<string, number> = {};
    for (const key of Object.keys(bundle.name_size)) {
      const cut = key.lastIndexOf('|');
      if (cut > 0) {
        const name = key.slice(0, cut);
        // The first hit is enough: all we need is the information that a file of
        // that name exists somewhere.
        if (byName[name] === undefined) {
          byName[name] = bundle.name_size[key];
        }
      }
    }
    return { ...bundle, byName };
  };

  /**
   * Fetches the compact disk index from the server and stores it on the phone.
   *
   * This is the ONLY moment at which verification needs the server and the network.
   * The rest of the run takes hours and works solely off this file — were we instead
   * to query the server item by item, every tunnel drop (and ngrok does that
   * regularly) would ruin a whole batch.
   */
  const fetchBundle = async (): Promise<Bundle | null> => {
    try {
      addLog('fetching disk index...');
      const resp = await fetch(`${serverUrl}/verify/bundle`);
      if (!resp.ok) {
        addLog(`fetch error: HTTP ${resp.status}`);
        return null;
      }
      const data = await resp.json();
      if (!data.paths || !data.md5) {
        addLog('server returned a bundle in an unknown format');
        return null;
      }

      const bundle: Bundle = { ...data, fetched_at: new Date().toISOString() };
      const dest = `${FileSystem.documentDirectory}${BUNDLE_FILE}`;
      // Stored WITHOUT the by-name index — it is reproducible, so keeping it in the
      // file would only enlarge the write.
      await FileSystem.writeAsStringAsync(dest, JSON.stringify(bundle));
      addLog(`index saved: ${bundle.files} files, ${bundle.unique_contents} unique contents`);
      return prepareBundle(bundle);
    } catch (e) {
      addLog(`index fetch error: ${String(e)}`);
      return null;
    }
  };

  /** Reads the index stored earlier on the phone. Allows working without the server. */
  const loadCachedBundle = async (): Promise<Bundle | null> => {
    try {
      const dest = `${FileSystem.documentDirectory}${BUNDLE_FILE}`;
      const info = await FileSystem.getInfoAsync(dest);
      if (!info.exists) {
        return null;
      }
      const raw = await FileSystem.readAsStringAsync(dest);
      const bundle = JSON.parse(raw) as Bundle;
      addLog(`index from phone storage: ${bundle.files} files (fetched ${bundle.fetched_at?.slice(0, 16)})`);
      return prepareBundle(bundle);
    } catch (e) {
      addLog(`index read error: ${String(e)}`);
      return null;
    }
  };

  /**
   * Decides offline whether the disk holds the given material.
   *
   * The logic is deliberately identical to the server's (verify_index.check_one), so
   * that both modes give the same answer for the same data:
   *   hit by MD5                  -> verified (content identical bit for bit)
   *   hit by name and size        -> size-match when we have no MD5,
   *                                  name-mismatch when we have one and it missed
   *   no hit                      -> missing
   */
  const judge = (
    bundle: Bundle,
    filename: string,
    size?: number,
    md5?: string
  ): { status: VerifyStatus; path?: string } => {
    if (md5) {
      const hit = bundle.md5[md5.toLowerCase()];
      if (hit !== undefined) {
        return { status: 'verified', path: bundle.paths[hit] };
      }
    }

    if (size !== undefined) {
      const key = `${filename.toLowerCase()}|${size}`;
      const hit = bundle.name_size[key];
      if (hit !== undefined) {
        // Name and size match, but the digest did not hit above — so the content is
        // DIFFERENT. Not the same material, despite the matching name.
        return {
          status: md5 ? 'name-mismatch' : 'size-match',
          path: bundle.paths[hit],
        };
      }
    }

    // The name alone matches, the size does not. We say so explicitly rather than
    // reporting absence: the user then has a hint where on disk to look for a file of
    // that name and compare it by hand.
    const nameHit = bundle.byName?.[filename.toLowerCase()];
    if (nameHit !== undefined) {
      return { status: 'name-mismatch', path: bundle.paths[nameHit] };
    }

    return { status: 'missing' };
  };

  /** Computes the size and (if the strategy allows) the MD5 of a single item. */
  const fingerprint = async (
    asset: { id: string; uri: string; filename: string },
    strategy: HashStrategy
  ): Promise<{ size?: number; md5?: string; error?: string }> => {
    try {
      if (strategy === 'localUri-md5' || strategy === 'localUri-size') {
        const info = await MediaLibrary.getAssetInfoAsync(asset.id, {
          shouldDownloadFromNetwork: false,
        });
        const localUri = (info as any).localUri;
        if (!localUri) {
          return { error: 'no localUri' };
        }
        const res = await FileSystem.getInfoAsync(localUri, {
          md5: strategy === 'localUri-md5',
        });
        return { size: (res as any).size, md5: (res as any).md5 };
      }

      if (strategy === 'sandbox-md5') {
        // We strip the #bookmark fragment that iOS appends to localUri.
        const clean = asset.filename.split('#')[0];
        const dest = `${FileSystem.cacheDirectory}vfy_${clean}`;
        const old = await FileSystem.getInfoAsync(dest);
        if (old.exists) {
          await FileSystem.deleteAsync(dest, { idempotent: true });
        }
        await FileSystem.copyAsync({ from: asset.uri, to: dest });
        const res = await FileSystem.getInfoAsync(dest, { md5: true });
        // The copy is removed at once — the phone is short of space, and across well
        // over ten thousand items leftover copies would fill the disk.
        await FileSystem.deleteAsync(dest, { idempotent: true });
        return { size: (res as any).size, md5: (res as any).md5 };
      }

      return { error: 'no strategy' };
    } catch (e) {
      return { error: String(e) };
    }
  };

  /**
   * Verifies a list of items against the index held on the phone.
   *
   * Without the network: the server was needed only to fetch the index. Thanks to
   * that, a run over well above ten thousand items can take hours, survive a tunnel
   * drop, and even the laptop being switched off.
   *
   * Results are handed back through onProgress after every item, because computing a
   * digest is slow and a counter advancing in batches would look like the app hanging.
   */
  const verifyAssets = async (
    assets: { id: string; uri: string; filename: string }[],
    strategy: HashStrategy,
    bundle: Bundle,
    onProgress?: (done: number, total: number, verdicts: AssetVerdict[]) => void
  ): Promise<AssetVerdict[]> => {
    resetCancel();
    const out: AssetVerdict[] = [];

    for (let i = 0; i < assets.length; i += 1) {
      if (cancelRef.current) {
        addLog(`cancelled at ${i}/${assets.length}`);
        break;
      }

      const asset = assets[i];
      const fp = await fingerprint(asset, strategy);

      if (fp.error) {
        out.push({
          id: asset.id,
          filename: asset.filename,
          status: 'error',
          note: fp.error,
        });
      } else {
        const verdict = judge(bundle, asset.filename, fp.size, fp.md5);
        out.push({
          id: asset.id,
          filename: asset.filename,
          size: fp.size,
          md5: fp.md5,
          status: verdict.status,
          path: verdict.path,
        });
      }

      onProgress?.(i + 1, assets.length, out);
    }

    return out;
  };

  /**
   * Verifies the ENTIRE library, paging through it on its own.
   *
   * Necessary because verifying only the loaded page meant 78 manual rounds for
   * 15.6k items. Pages are fetched with the `after` cursor so the full asset list is
   * never held in memory at once; only the verdicts accumulate, and those are small.
   *
   * The verdicts are returned for every item, including ones the screen never
   * displayed as a tile — counting and deletion work off the verdicts, not off the
   * visible list, so the interface stays responsive with tens of thousands of items.
   */
  const verifyWholeLibrary = async (
    strategy: HashStrategy,
    bundle: Bundle,
    mediaTypes: MediaLibrary.MediaTypeValue[],
    pageSize = 200,
    onProgress?: (done: number, total: number, verdicts: AssetVerdict[]) => void,
    alreadyDone?: Set<string>
  ): Promise<AssetVerdict[]> => {
    resetCancel();
    const out: AssetVerdict[] = [];
    let after: string | undefined;
    let hasNext = true;
    let total = 0;
    let done = 0;

    while (hasNext && !cancelRef.current) {
      let page;
      try {
        page = await MediaLibrary.getAssetsAsync({
          mediaType: mediaTypes,
          first: pageSize,
          ...(after ? { after } : {}),
          sortBy: [[MediaLibrary.SortBy.creationTime, true]],
        });
      } catch (e) {
        addLog(`page fetch error: ${String(e)}`);
        break;
      }

      if (total === 0) {
        total = page.totalCount;
        addLog(`library: ${total} items to check`);
      }

      for (const a of page.assets) {
        if (cancelRef.current) {
          break;
        }
        done += 1;

        const filename = a.filename || `asset_${a.id}`;

        // Skip what a previous run already settled — lets an interrupted pass be
        // resumed without recomputing digests that are already known.
        if (alreadyDone?.has(a.id)) {
          onProgress?.(done, total, out);
          continue;
        }

        const fp = await fingerprint({ id: a.id, uri: a.uri, filename }, strategy);
        if (fp.error) {
          out.push({ id: a.id, filename, status: 'error', note: fp.error });
        } else {
          const verdict = judge(bundle, filename, fp.size, fp.md5);
          out.push({
            id: a.id,
            filename,
            size: fp.size,
            md5: fp.md5,
            status: verdict.status,
            path: verdict.path,
          });
        }

        // Progress after every item; with 15k items a per-page counter would look
        // like the app had frozen.
        onProgress?.(done, total, out);
      }

      hasNext = page.hasNextPage;
      after = page.endCursor;
    }

    if (cancelRef.current) {
      addLog(`cancelled after ${done}/${total}`);
    }
    return out;
  };

  /**
   * Deletes ONE confirmed item — to check whether deletion works in Expo Go at all,
   * before setting thousands of items in motion.
   *
   * A separate function, because it is not known up front whether Expo Go has write
   * permission to the Photos library. Reading works (verified), but deletion requires
   * consent to modify and may behave differently. Cheaper to check on a single photo
   * than to discover the problem halfway through a multi-hour run.
   */
  const deleteOneAsTest = async (verdicts: AssetVerdict[]): Promise<string | null> => {
    const safe = verdicts.find(v => v.status === 'verified' && v.md5);
    if (!safe) {
      addLog('no verified items — nothing to test on');
      return null;
    }
    addLog(`deletion test on: ${safe.filename}`);
    try {
      const ok = await MediaLibrary.deleteAssetsAsync([safe.id]);
      addLog(ok
        ? `deletion WORKS — ${safe.filename} moved to Recently Deleted`
        : 'deletion refused (cancelled in the dialog, or no permission)');
      // The deleted asset's id is returned so the caller can drop just that one item
      // from its state. Wiping all verdicts instead (as this once did) threw away the
      // whole verification run and left the confirmed counter at zero.
      return ok ? safe.id : null;
    } catch (e) {
      // The most important case to recognise: Expo Go without the right to modify
      // the library. A development build would then be required.
      addLog(`deletion UNAVAILABLE: ${String(e)}`);
      return null;
    }
  };

  /**
   * Deletes digest-confirmed material from the phone.
   *
   * Two safety barriers, because the operation is practically irreversible (iOS keeps
   * deleted items for 30 days, but recovering thousands of them is illusory):
   *   1. Only the 'verified' status is accepted, i.e. a matching MD5. The filter lives
   *      in the code, not merely in the interface — a mistake on screen cannot lead to
   *      unverified material being deleted.
   *   2. iOS itself shows its own confirmation dialog for the whole batch.
   *
   * Returns the ids actually deleted.
   */
  const deleteVerified = async (
    verdicts: AssetVerdict[],
    chunkSize = 1000,
    onProgress?: (done: number, total: number) => void
  ): Promise<string[]> => {
    const safe = verdicts.filter(v => v.status === 'verified' && v.md5);
    if (safe.length === 0) {
      addLog('nothing to delete — no items with the verified status');
      return [];
    }

    // Deleted in chunks rather than in one call: a single array of fifteen thousand
    // ids is an untested load for PhotoKit, and a failure halfway would leave us
    // unsure what was removed. A chunk also gives iOS a natural confirmation point,
    // so the run can still be abandoned partway.
    const deleted: string[] = [];
    for (let i = 0; i < safe.length; i += chunkSize) {
      const slice = safe.slice(i, i + chunkSize);
      addLog(`deleting ${i + 1}-${i + slice.length} of ${safe.length}...`);
      try {
        const ok = await MediaLibrary.deleteAssetsAsync(slice.map(v => v.id));
        if (!ok) {
          addLog('iOS refused the deletion (or it was cancelled in the dialog)');
          break;
        }
        deleted.push(...slice.map(v => v.id));
        onProgress?.(deleted.length, safe.length);
      } catch (e) {
        addLog(`deletion failed at item ${i + 1}: ${String(e)}`);
        break;
      }
    }

    addLog(`deleted ${deleted.length} of ${safe.length}. `
      + 'Reclaim space in Photos > Recently Deleted.');
    return deleted;
  };

  return {
    log,
    addLog,
    probe,
    fetchBundle,
    loadCachedBundle,
    verifyAssets,
    verifyWholeLibrary,
    deleteOneAsTest,
    deleteVerified,
    requestCancel,
  };
}
