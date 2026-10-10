import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, ActivityIndicator, TextInput } from 'react-native';
// Image from expo-image, not from react-native: the built-in RN component does not
// know the ph:// scheme and reports "No suitable URL request handler found".
// expo-image supports Photos library identifiers on iOS.
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import { useUpload } from '@/hooks/use-upload';

// ngrok tunnel address of the Flask backend in WSL.
// MUST be at module scope — as a const inside the component it would be used before
// initialisation in the useUpload() call and the hook would receive undefined.
const SERVER_BASE = 'https://setting-revisable-pacific.ngrok-free.dev';

// How many assets we load per page of the list and how many we fetch at a time when
// walking a whole album.
const PAGE_SIZE = 100;

interface AlbumInfo {
  id: string;
  title: string;
  total: number;
  videos: number;
  photos: number;
}

interface MediaAsset {
  id: string;
  uri: string;
  width: number;
  height: number;
  duration: number;
  // MediaLibrary also returns 'audio' and 'unknown', so we take its own type instead
  // of narrowing to 'photo' | 'video' — otherwise every mapping would need a cast.
  mediaType: MediaLibrary.MediaTypeValue;
  filename: string;
  /** Creation date in ms — for display on the tile and for local sorting. */
  creationTime: number;
}

/** What we show: videos only, photos only, or everything. */
type MediaKind = 'video' | 'photo' | 'both';

/**
 * List ordering.
 *
 * Sorting by name is done locally — MediaLibrary cannot do it.
 * 'longest'/'shortest' sort by duration, not by file size: MediaLibrary does not
 * expose the size in query results (we only learn it after copying the asset into the
 * sandbox). For recordings from one camera the duration is nevertheless a good proxy
 * for size, because the bitrate is constant.
 */
type SortMode = 'oldest' | 'newest' | 'name' | 'longest' | 'shortest';

interface QueueStats {
  total: number;
  index: number;
  done: number;
  skipped: number;
  failed: number;
}

export default function UploadTestScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [albums, setAlbums] = useState<AlbumInfo[]>([]);
  // null = the whole library, otherwise the selected album
  const [activeAlbum, setActiveAlbum] = useState<AlbumInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [serverStatus, setServerStatus] = useState<string>('checking');
  const [mediaKind, setMediaKind] = useState<MediaKind>('video');
  const [sortMode, setSortMode] = useState<SortMode>('oldest');
  // Pagination cursor from MediaLibrary. Without loading more, only the first
  // PAGE_SIZE items are visible, while the library holds thousands.
  const [endCursor, setEndCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  // Filter by a name fragment — operates on the loaded items, because MediaLibrary
  // cannot search by name on its side.
  const [nameFilter, setNameFilter] = useState('');

  // Selection: asset identifiers. A Set, because membership is checked on every
  // tile render.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Anchor for range selection (the most recently tapped tile)
  const [anchorId, setAnchorId] = useState<string | null>(null);

  const [queue, setQueue] = useState<QueueStats | null>(null);
  // A ref, not state: the queue loop must see the current value immediately, whereas
  // state inside the closure would stay stale for the rest of the run.
  const cancelRef = useRef(false);

  const {
    logs,
    addLog,
    listAlbums,
    uploadAsset,
    requestCancel,
    resetCancel,
  } = useUpload(SERVER_BASE);

  useEffect(() => {
    checkServer();
    requestPermission();
  }, []);

  const checkServer = async () => {
    try {
      const resp = await fetch(`${SERVER_BASE}/ping`);
      if (resp.ok) {
        setServerStatus('online');
        addLog('Server online', 'success');
      } else {
        setServerStatus(`error ${resp.status}`);
        addLog(`Server error: ${resp.status}`, 'error');
      }
    } catch (e) {
      setServerStatus('offline');
      addLog('Server offline', 'error');
    }
  };

  const requestPermission = async () => {
    const result = await MediaLibrary.requestPermissionsAsync();
    setHasPermission(result.status === 'granted');
    if (result.status === 'granted') {
      loadAlbums();
      loadAssets(null);
    }
  };

  const loadAlbums = async () => {
    const found = await listAlbums();
    setAlbums(found);
  };

  /**
   * Loads files from the selected album or from the whole library.
   *
   * `kind` and `sort` arrive as arguments rather than from state, because this
   * function is called directly after a toggle changes — at that moment the state is
   * not yet updated.
   */
  const loadAssets = async (
    album: AlbumInfo | null,
    kind: MediaKind = mediaKind,
    sort: SortMode = sortMode
  ) => {
    setIsLoading(true);
    addLog(album ? `Loading from "${album.title}"...` : 'Loading library...', 'info');
    try {
      const types: MediaLibrary.MediaTypeValue[] =
        kind === 'both' ? ['video', 'photo'] : [kind];

      // Sorting by name and by duration is handled locally: MediaLibrary does not
      // sort by name at all, and it does sort by duration, but only in combination
      // with fetching a page — the ordering across appended pages has to be unified
      // on our side anyway.
      const byDate = sort === 'oldest' || sort === 'newest';
      const ascending = sort === 'oldest';
      const sortSpec: MediaLibrary.SortByValue[] = byDate
        ? [[MediaLibrary.SortBy.creationTime, ascending]]
        : sort === 'longest' || sort === 'shortest'
          ? [[MediaLibrary.SortBy.duration, sort === 'shortest']]
          : [[MediaLibrary.SortBy.creationTime, false]];

      const page = await MediaLibrary.getAssetsAsync({
        ...(album ? { album: album.id } : {}),
        mediaType: types,
        first: PAGE_SIZE,
        sortBy: sortSpec,
      });

      let mapped = page.assets.map(a => ({
        id: a.id,
        uri: a.uri,
        width: a.width,
        height: a.height,
        duration: a.duration,
        mediaType: a.mediaType,
        filename: a.filename || `asset_${a.id}`,
        creationTime: a.creationTime,
      }));

      if (sort === 'name') {
        mapped = [...mapped].sort((x, y) => x.filename.localeCompare(y.filename));
      }

      setAssets(mapped);
      setSelected(new Set());
      setAnchorId(null);
      setEndCursor(page.endCursor);
      setHasMore(page.hasNextPage);
      setTotalCount(page.totalCount);
      addLog(`Loaded ${mapped.length} of ${page.totalCount}`, 'success');
    } catch (e) {
      addLog(`Load error: ${String(e)}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Loads the next page and appends it to the list.
   *
   * Sorting by name is applied to the whole list after appending, so the order stays
   * consistent — otherwise a new page would land at the end regardless of names.
   */
  const loadMore = async () => {
    if (!hasMore || isLoading) {
      return;
    }
    setIsLoading(true);
    try {
      const types: MediaLibrary.MediaTypeValue[] =
        mediaKind === 'both' ? ['video', 'photo'] : [mediaKind];

      const page = await MediaLibrary.getAssetsAsync({
        ...(activeAlbum ? { album: activeAlbum.id } : {}),
        mediaType: types,
        first: PAGE_SIZE,
        after: endCursor,
        sortBy: sortMode === 'longest' || sortMode === 'shortest'
          ? [[MediaLibrary.SortBy.duration, sortMode === 'shortest']]
          : [[MediaLibrary.SortBy.creationTime, sortMode === 'oldest']],
      });

      const mapped = page.assets.map(a => ({
        id: a.id,
        uri: a.uri,
        width: a.width,
        height: a.height,
        duration: a.duration,
        mediaType: a.mediaType,
        filename: a.filename || `asset_${a.id}`,
        creationTime: a.creationTime,
      }));

      setAssets(prev => {
        const combined = [...prev, ...mapped];
        return sortMode === 'name'
          ? combined.sort((x, y) => x.filename.localeCompare(y.filename))
          : combined;
      });
      setEndCursor(page.endCursor);
      setHasMore(page.hasNextPage);
      addLog(`+${mapped.length} (total visible grows)`, 'success');
    } catch (e) {
      addLog(`loadMore error: ${String(e)}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const changeKind = (kind: MediaKind) => {
    setMediaKind(kind);
    loadAssets(activeAlbum, kind, sortMode);
  };

  const changeSort = (sort: SortMode) => {
    setSortMode(sort);
    loadAssets(activeAlbum, mediaKind, sort);
  };

  const selectAlbum = (album: AlbumInfo | null) => {
    setActiveAlbum(album);
    loadAssets(album);
  };

  // --- Zaznaczanie ---

  /** Tapping a tile: toggles the selection and sets the anchor for a range. */
  const toggleOne = (assetId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
    setAnchorId(assetId);
  };

  /**
   * Long-pressing a tile: selects everything from the anchor up to this tile.
   * Without an anchor it behaves like an ordinary tap.
   */
  const selectRangeTo = (assetId: string) => {
    if (!anchorId) {
      toggleOne(assetId);
      return;
    }

    const from = visible.findIndex(a => a.id === anchorId);
    const to = visible.findIndex(a => a.id === assetId);
    if (from < 0 || to < 0) {
      return;
    }

    const [lo, hi] = from <= to ? [from, to] : [to, from];
    setSelected(prev => {
      const next = new Set(prev);
      for (let i = lo; i <= hi; i += 1) {
        next.add(visible[i].id);
      }
      return next;
    });
    addLog(`Range selected: ${hi - lo + 1} items`, 'info');
  };

  const selectAllLoaded = () => {
    // We select what is visible after filtering — otherwise the button would also
    // take filtered-out items, which the user cannot verify by eye.
    setSelected(new Set(visible.map(a => a.id)));
    addLog(`Selected: ${visible.length}`, 'info');
  };

  const clearSelection = () => {
    setSelected(new Set());
    setAnchorId(null);
  };

  // --- Kolejka ---

  /** Sends a list of assets one by one, reporting progress and honouring Stop. */
  const runQueue = async (list: MediaAsset[]) => {
    if (list.length === 0) {
      addLog('Nothing to upload', 'info');
      return;
    }

    cancelRef.current = false;
    resetCancel();
    const stats: QueueStats = { total: list.length, index: 0, done: 0, skipped: 0, failed: 0 };
    setQueue({ ...stats });
    addLog(`=== Queue: ${list.length} files ===`, 'info');

    for (const asset of list) {
      if (cancelRef.current) {
        addLog('Queue stopped by user', 'info');
        break;
      }

      stats.index += 1;
      setQueue({ ...stats });
      addLog(`[${stats.index}/${stats.total}] ${asset.filename}`, 'info');

      const result = await uploadAsset(asset);
      if (result === 'done') {
        stats.done += 1;
      } else if (result === 'skipped') {
        stats.skipped += 1;
      } else {
        stats.failed += 1;
        // We do not abort the whole queue because of one file — the rest may go
        // through, and the failed ones are resumed on the next run.
        addLog(`failed: ${asset.filename}`, 'error');
      }
      setQueue({ ...stats });
    }

    addLog(
      `=== Queue finished: ${stats.done} sent, ${stats.skipped} skipped, ${stats.failed} failed ===`,
      stats.failed > 0 ? 'error' : 'success'
    );
    setQueue(null);
  };

  const uploadSelected = () => {
    const list = assets.filter(a => selected.has(a.id));
    runQueue(list);
  };

  /**
   * Downloads a whole album (or the whole library), not merely the loaded page.
   * Pages are fetched with the `after` cursor so the list of all assets is never held
   * in memory at once.
   */
  const uploadWholeAlbum = async () => {
    cancelRef.current = false;
    resetCancel();
    const label = activeAlbum ? activeAlbum.title : 'whole library';
    addLog(`=== Full run: ${label} ===`, 'info');

    const stats: QueueStats = { total: 0, index: 0, done: 0, skipped: 0, failed: 0 };
    let after: string | undefined;
    let hasNext = true;

    while (hasNext && !cancelRef.current) {
      const page = await MediaLibrary.getAssetsAsync({
        ...(activeAlbum ? { album: activeAlbum.id } : {}),
        // We honour the type toggle — otherwise "Send ALL" would ignore the choice
        // and send videos while set to photos.
        mediaType: mediaKind === 'both' ? ['video', 'photo'] : [mediaKind],
        first: PAGE_SIZE,
        ...(after ? { after } : {}),
        sortBy: [[MediaLibrary.SortBy.creationTime, true]],
      });

      if (stats.total === 0) {
        stats.total = page.totalCount;
        setQueue({ ...stats });
      }

      for (const a of page.assets) {
        if (cancelRef.current) {
          break;
        }

        stats.index += 1;
        setQueue({ ...stats });
        const filename = a.filename || `video_${a.id}.mov`;
        addLog(`[${stats.index}/${stats.total}] ${filename}`, 'info');

        const result = await uploadAsset({
          id: a.id,
          uri: a.uri,
          filename,
          width: a.width,
          height: a.height,
          duration: a.duration,
          mediaType: a.mediaType,
        });

        if (result === 'done') {
          stats.done += 1;
        } else if (result === 'skipped') {
          stats.skipped += 1;
        } else {
          stats.failed += 1;
          addLog(`failed: ${filename}`, 'error');
        }
        setQueue({ ...stats });
      }

      hasNext = page.hasNextPage;
      after = page.endCursor;
    }

    addLog(
      `=== Full run finished: ${stats.done} sent, ${stats.skipped} skipped, ${stats.failed} failed ===`,
      stats.failed > 0 ? 'error' : 'success'
    );
    setQueue(null);
  };

  const stopQueue = () => {
    cancelRef.current = true;
    // requestCancel reaches the upload loop inside the file. Without it cancellation
    // only worked between files and looked broken on large material.
    requestCancel();
    addLog('Stopping — cancels mid-file, the transfer will resume later', 'info');
  };

  if (hasPermission === null) {
    return <View style={styles.center}><ActivityIndicator /></View>;
  }

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>No permission</Text>
        <Text style={styles.status}>Access to the media library is required</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const running = queue !== null;

  // The filtered list — used both for display and for "All loaded" and ranges, so
  // that selection operates on what the user can see.
  const visible = nameFilter.trim()
    ? assets.filter(a => a.filename.toLowerCase().includes(nameFilter.trim().toLowerCase()))
    : assets;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Upload</Text>
        <Text style={styles.status}>
          {serverStatus} | {activeAlbum ? activeAlbum.title : 'All'} | {visible.length}/{assets.length} of {totalCount} | sel. {selected.size}
        </Text>
        {queue && (
          <Text style={styles.progress}>
            {queue.index}/{queue.total} — {queue.done} sent, {queue.skipped} skipped, {queue.failed} failed
          </Text>
        )}
      </View>

      <View style={styles.albumBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.albumRow}>
          <TouchableOpacity
            style={[styles.albumChip, !activeAlbum && styles.albumChipActive]}
            onPress={() => selectAlbum(null)}
            disabled={running}
          >
            <Text style={[styles.albumText, !activeAlbum && styles.albumTextActive]}>All</Text>
          </TouchableOpacity>
          {albums.map(album => (
            <TouchableOpacity
              key={album.id}
              style={[styles.albumChip, activeAlbum?.id === album.id && styles.albumChipActive]}
              onPress={() => selectAlbum(album)}
              disabled={running}
            >
              <Text style={[styles.albumText, activeAlbum?.id === album.id && styles.albumTextActive]}>
                {album.title} ({album.videos}v/{album.photos}p)
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.filterBar}>
        {(['video', 'photo', 'both'] as MediaKind[]).map(kind => (
          <TouchableOpacity
            key={kind}
            style={[styles.filterChip, mediaKind === kind && styles.filterChipActive]}
            onPress={() => changeKind(kind)}
            disabled={running}
          >
            <Text style={[styles.filterText, mediaKind === kind && styles.filterTextActive]}>
              {kind === 'video' ? 'Videos' : kind === 'photo' ? 'Photos' : 'Everything'}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={styles.filterSep} />
        {(['oldest', 'newest', 'name', 'longest', 'shortest'] as SortMode[]).map(sort => (
          <TouchableOpacity
            key={sort}
            style={[styles.filterChip, sortMode === sort && styles.filterChipActive]}
            onPress={() => changeSort(sort)}
            disabled={running}
          >
            <Text style={[styles.filterText, sortMode === sort && styles.filterTextActive]}>
              {sort === 'oldest' ? 'Oldest'
                : sort === 'newest' ? 'Newest'
                  : sort === 'name' ? 'Name'
                    : sort === 'longest' ? 'Longest' : 'Shortest'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.searchBar}>
        <TextInput
          style={styles.search}
          placeholder="Filter by name (e.g. 5771)"
          placeholderTextColor="#9e9e9e"
          value={nameFilter}
          onChangeText={setNameFilter}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!running}
        />
        <TouchableOpacity
          style={[styles.moreBtn, !hasMore && styles.btnDisabled]}
          onPress={loadMore}
          disabled={!hasMore || running || isLoading}
        >
          <Text style={styles.btnText}>+{PAGE_SIZE}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.controls}>
        {running ? (
          <TouchableOpacity style={[styles.btn, styles.btnStop]} onPress={stopQueue}>
            <Text style={styles.btnText}>Stop</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={styles.btnSmall} onPress={selectAllLoaded}>
              <Text style={styles.btnText}>All loaded</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnSmall} onPress={clearSelection}>
              <Text style={styles.btnText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnSmall, styles.btnGo, selected.size === 0 && styles.btnDisabled]}
              onPress={uploadSelected}
              disabled={selected.size === 0}
            >
              <Text style={styles.btnText}>Send {selected.size}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btnSmall, styles.btnFull]} onPress={uploadWholeAlbum}>
              <Text style={styles.btnText}>Send ALL</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color="#2196F3" style={{ margin: 10 }} />
      ) : (
        <View style={styles.assetsSection}>
          <ScrollView contentContainerStyle={styles.grid}>
            {visible.map(asset => {
              const isSel = selected.has(asset.id);
              const date = new Date(asset.creationTime);
              const pad = (n: number) => String(n).padStart(2, '0');
              const stamp = `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
              return (
                <TouchableOpacity
                  key={asset.id}
                  style={[styles.card, isSel && styles.cardSelected]}
                  onPress={() => toggleOne(asset.id)}
                  onLongPress={() => selectRangeTo(asset.id)}
                  delayLongPress={300}
                  disabled={running}
                >
                  {/* expo-image renders ph:// directly — including for videos,
                      returning a preview frame. We need not generate thumbnails.
                      contentFit="cover" crops to a square without distortion. */}
                  <Image
                    source={{ uri: asset.uri }}
                    style={styles.thumb}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={0}
                  />
                  {isSel && (
                    <View style={styles.checkBadge}>
                      <Text style={styles.checkText}>✓</Text>
                    </View>
                  )}
                  {asset.mediaType === 'video' && (
                    <View style={styles.durBadge}>
                      <Text style={styles.durText}>{Math.floor(asset.duration)}s</Text>
                    </View>
                  )}
                  <Text style={styles.fname} numberOfLines={1}>{asset.filename}</Text>
                  <Text style={styles.meta} numberOfLines={1}>{stamp}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      <View style={styles.logsSection}>
        <Text style={styles.logsTitle}>Logs</Text>
        <ScrollView style={styles.logsList}>
          {logs.slice(-200).map((log, idx) => (
            <Text
              key={idx}
              style={[
                styles.logLine,
                log.type === 'error' && styles.logError,
                log.type === 'success' && styles.logSuccess,
              ]}
            >
              {log.message}
            </Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  header: { paddingTop: 55, paddingHorizontal: 15, paddingBottom: 8, backgroundColor: '#fff' },
  title: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  status: { fontSize: 11, color: '#666', marginTop: 3 },
  progress: { fontSize: 11, color: '#1565c0', marginTop: 3, fontWeight: '600' },
  albumBar: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  albumRow: { paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  albumChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: '#eceff1' },
  albumChipActive: { backgroundColor: '#2196F3' },
  albumText: { fontSize: 11, color: '#455a64' },
  albumTextActive: { color: '#fff', fontWeight: 'bold' },
  controls: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#fff' },
  btn: { flex: 1, backgroundColor: '#2196F3', paddingVertical: 10, borderRadius: 6, alignItems: 'center' },
  btnSmall: { flex: 1, backgroundColor: '#78909c', paddingVertical: 9, borderRadius: 6, alignItems: 'center' },
  btnGo: { backgroundColor: '#43a047' },
  btnFull: { backgroundColor: '#ef6c00' },
  btnStop: { backgroundColor: '#e53935' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 11 },
  filterBar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  filterChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: '#eceff1' },
  filterChipActive: { backgroundColor: '#455a64' },
  filterText: { fontSize: 10, color: '#455a64' },
  filterTextActive: { color: '#fff', fontWeight: 'bold' },
  filterSep: { width: 10 },
  // The grid takes the rest of the screen, the log panel only a bottom strip — when
  // browsing hundreds of files what counts is the number of visible tiles, not the
  // length of the log.
  assetsSection: { flex: 1, borderBottomWidth: 1, borderBottomColor: '#ddd', backgroundColor: '#fafafa' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 6, paddingVertical: 6, gap: 4 },
  card: { width: 76, backgroundColor: '#fff', borderRadius: 4, alignItems: 'center', borderWidth: 2, borderColor: '#ddd' },
  cardSelected: { borderColor: '#43a047' },
  thumb: { width: 72, height: 72, borderRadius: 3, backgroundColor: '#e0e0e0' },
  checkBadge: { position: 'absolute', top: 2, right: 2, backgroundColor: '#43a047', width: 18, height: 18, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
  checkText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  durBadge: { position: 'absolute', bottom: 16, right: 2, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 3, borderRadius: 3 },
  durText: { color: '#fff', fontSize: 8 },
  searchBar: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingBottom: 6, backgroundColor: '#fff' },
  search: { flex: 1, borderWidth: 1, borderColor: '#cfd8dc', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, fontSize: 12, color: '#333' },
  moreBtn: { backgroundColor: '#5c6bc0', paddingHorizontal: 12, justifyContent: 'center', borderRadius: 6 },
  fname: { fontSize: 7, color: '#333', fontWeight: '600', paddingHorizontal: 2 },
  meta: { fontSize: 8, color: '#777', paddingBottom: 1 },
  logsSection: { height: 110, backgroundColor: '#fff' },
  logsTitle: { fontSize: 12, fontWeight: 'bold', color: '#333', padding: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  logsList: { flex: 1, paddingHorizontal: 10, paddingVertical: 6 },
  logLine: { fontSize: 10, color: '#555', marginBottom: 2 },
  logError: { color: '#d32f2f' },
  logSuccess: { color: '#2e7d32' },
});
