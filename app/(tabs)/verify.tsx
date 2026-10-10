import React, { useState, useEffect } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import { useVerify, AssetVerdict, HashStrategy, Bundle } from '@/hooks/use-verify';

// Backend tunnel address. Needed SOLELY for the one-off fetch of the disk index —
// verification itself then runs offline, without the server and without the network.
const SERVER_BASE = 'https://setting-revisable-pacific.ngrok-free.dev';

// How many items we load per page of the list.
const PAGE_SIZE = 200;

// Upper bound on tiles actually rendered. The verdict map may hold fifteen thousand
// entries, but drawing that many tiles would choke the list. Counters and deletion
// work off the verdicts, so capping the drawing costs nothing — and the status
// filters let one reach the handful of problematic items regardless.
const MAX_TILES = 300;

interface Item {
  id: string;
  uri: string;
  filename: string;
  creationTime: number;
  mediaType: MediaLibrary.MediaTypeValue;
}

/** Status labels — deliberately literal, as these decide whether material is deleted. */
const STATUS_LABEL: Record<string, string> = {
  verified: 'Confirmed (MD5)',
  'size-match': 'Name and size',
  'name-mismatch': 'Mismatched',
  missing: 'Not on disk',
  error: 'Error',
};

const STATUS_COLOR: Record<string, string> = {
  verified: '#2e7d32',
  'size-match': '#f9a825',
  'name-mismatch': '#d84315',
  missing: '#c62828',
  error: '#6a1b9a',
};

export default function VerifyScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [endCursor, setEndCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const [strategy, setStrategy] = useState<HashStrategy | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [verdicts, setVerdicts] = useState<Map<string, AssetVerdict>>(new Map());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  const {
    log, addLog, probe, fetchBundle, loadCachedBundle,
    verifyAssets, verifyWholeLibrary, deleteOneAsTest, deleteVerified, requestCancel,
  } = useVerify(SERVER_BASE);

  useEffect(() => {
    // The phone's stored index first — if present, the server is not needed.
    loadCachedBundle().then(b => {
      if (b) {
        setBundle(b);
      }
    });
    requestPermission();
  }, []);

  const requestPermission = async () => {
    const res = await MediaLibrary.requestPermissionsAsync();
    setHasPermission(res.status === 'granted');
    if (res.status === 'granted') {
      loadPage(true);
    }
  };

  /** Loads a page of items. Oldest first — those have occupied space the longest. */
  const loadPage = async (reset: boolean) => {
    setIsLoading(true);
    try {
      const page = await MediaLibrary.getAssetsAsync({
        mediaType: ['photo', 'video'],
        first: PAGE_SIZE,
        ...(reset ? {} : { after: endCursor }),
        sortBy: [[MediaLibrary.SortBy.creationTime, true]],
      });

      const mapped: Item[] = page.assets.map(a => ({
        id: a.id,
        uri: a.uri,
        filename: a.filename || `asset_${a.id}`,
        creationTime: a.creationTime,
        mediaType: a.mediaType,
      }));

      setItems(prev => (reset ? mapped : [...prev, ...mapped]));
      setEndCursor(page.endCursor);
      setHasMore(page.hasNextPage);
      setTotalCount(page.totalCount);
      addLog(reset ? `loaded ${mapped.length} of ${page.totalCount}` : `+${mapped.length}`);
    } catch (e) {
      addLog(`load error: ${String(e)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const runProbe = async () => {
    if (items.length === 0) {
      Alert.alert('No items', 'Load the list first.');
      return;
    }
    setIsLoading(true);
    const res = await probe(items[0]);
    res.lines.forEach(addLog);
    setStrategy(res.strategy);
    setIsLoading(false);

    if (res.strategy === 'sandbox-md5') {
      Alert.alert(
        'Strategy: copy into the sandbox',
        'MD5 requires copying every item into the app storage. ' +
        'It works reliably but slowly — expect a few hours for the whole library. ' +
        'Copies are removed immediately after the digest is computed.'
      );
    } else if (res.strategy === 'localUri-size') {
      Alert.alert(
        'Warning: size only',
        'Expo Go gives no MD5 here, so verification rests on name and size. ' +
        'That is NOT proof of a file\'s identity — deleting on that basis is risky.'
      );
    }
  };

  const runVerify = async () => {
    if (!strategy || strategy === 'none') {
      Alert.alert('Probe first', 'Run "Probe" to determine the digest method.');
      return;
    }
    if (!bundle) {
      Alert.alert(
        'No disk index',
        'Press "Index" to fetch it from the server. That is the only moment the ' +
        'network is needed — verification then runs offline.'
      );
      return;
    }
    // We do not recompute anything that already has a verdict other than an error.
    const todo = items.filter(i => {
      const v = verdicts.get(i.id);
      return !v || v.status === 'error';
    });
    if (todo.length === 0) {
      Alert.alert('Nothing to do', 'All loaded items have already been checked.');
      return;
    }

    addLog(`=== verifying ${todo.length} items, strategy ${strategy} ===`);
    setProgress({ done: 0, total: todo.length });

    const results = await verifyAssets(todo, strategy, bundle, (done, total, partial) => {
      setProgress({ done, total });
      // Results are inserted as they come so the counter grows before the user's
      // eyes and so cancelling does not discard the work done so far.
      setVerdicts(prev => {
        const next = new Map(prev);
        partial.forEach(v => next.set(v.id, v));
        return next;
      });
    });

    setVerdicts(prev => {
      const next = new Map(prev);
      results.forEach(v => next.set(v.id, v));
      return next;
    });
    setProgress(null);
    addLog('=== verification finished ===');
  };

  /**
   * Verifies the whole library, not just the loaded page.
   *
   * This is the normal way to use the screen: with 15.6k items, checking 200 at a
   * time would mean 78 manual rounds. Already-settled items are skipped, so an
   * interrupted run can simply be started again.
   */
  const runVerifyAll = async () => {
    if (!strategy || strategy === 'none') {
      Alert.alert('Probe first', 'Run "Probe" to determine the digest method.');
      return;
    }
    if (!bundle) {
      Alert.alert(
        'No disk index',
        'Press "Index" to fetch it from the server. That is the only moment the '
        + 'network is needed — verification then runs offline.'
      );
      return;
    }

    const settled = new Set(
      Array.from(verdicts.values()).filter(v => v.status !== 'error').map(v => v.id)
    );
    addLog(`=== checking whole library, strategy ${strategy} ===`);
    setProgress({ done: 0, total: totalCount || 0 });

    const results = await verifyWholeLibrary(
      strategy,
      bundle,
      ['photo', 'video'],
      PAGE_SIZE,
      (done, total, partial) => {
        setProgress({ done, total });
        setVerdicts(prev => {
          const next = new Map(prev);
          partial.forEach(v => next.set(v.id, v));
          return next;
        });
      },
      settled
    );

    setVerdicts(prev => {
      const next = new Map(prev);
      results.forEach(v => next.set(v.id, v));
      return next;
    });
    setProgress(null);
    addLog('=== whole-library check finished ===');
  };

  const refreshBundle = async () => {
    setIsLoading(true);
    const b = await fetchBundle();
    if (b) {
      setBundle(b);
      // The old verdicts referred to the previous state of the disk, so after new
      // files have been downloaded they must be computed again.
      setVerdicts(new Map());
    }
    setIsLoading(false);
  };

  const counts = React.useMemo(() => {
    const c: Record<string, number> = {};
    verdicts.forEach(v => {
      c[v.status] = (c[v.status] || 0) + 1;
    });
    return c;
  }, [verdicts]);

  // Status chips count the whole verdict map, so the figures cover the entire library
  // after "Check ALL" — not merely the pages that happen to be loaded.
  const chipCount = (st: string) => counts[st] || 0;

  const verifiedList = React.useMemo(
    () => Array.from(verdicts.values()).filter(v => v.status === 'verified'),
    [verdicts]
  );

  /**
   * Drops the given assets from the screen state after they were deleted.
   *
   * We remove only what actually went, instead of reloading everything: wiping the
   * verdict map discarded an entire verification run and left the confirmed counter
   * at zero, which is exactly what happened after the first delete test.
   */
  const forgetDeleted = (ids: string[]) => {
    if (ids.length === 0) {
      return;
    }
    const gone = new Set(ids);
    setItems(prev => prev.filter(i => !gone.has(i.id)));
    setVerdicts(prev => {
      const next = new Map(prev);
      gone.forEach(id => next.delete(id));
      return next;
    });
    setTotalCount(prev => Math.max(0, prev - ids.length));
  };

  const confirmDelete = () => {
    if (verifiedList.length === 0) {
      Alert.alert('None confirmed', 'There are no items with the "Confirmed (MD5)" status.');
      return;
    }

    // The size is shown so the scale of the operation is visible before confirming —
    // "delete 9000 items" means something different at 2 GB than at 40 GB.
    const bytes = verifiedList.reduce((sum, v) => sum + (v.size || 0), 0);
    const gb = (bytes / 1024 / 1024 / 1024).toFixed(1);

    Alert.alert(
      'Delete from the phone?',
      `${verifiedList.length} items (${gb} GB) have a bit-for-bit identical copy on disk.\n\n`
      + 'They will be moved to "Recently Deleted" in the Photos app, from where they '
      + 'still have to be removed by hand to reclaim space.\n\n'
      + 'The operation covers only items confirmed by an MD5 digest, and runs in '
      + 'batches of 1000 — iOS asks for confirmation once per batch.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Delete ${verifiedList.length}`,
          style: 'destructive',
          onPress: async () => {
            setProgress({ done: 0, total: verifiedList.length });
            const ids = await deleteVerified(verifiedList, 1000, (done, total) => {
              setProgress({ done, total });
            });
            setProgress(null);
            forgetDeleted(ids);
          },
        },
      ]
    );
  };

  if (hasPermission === null) {
    return <View style={styles.center}><ActivityIndicator /></View>;
  }

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>No permission</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant media library access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const running = progress !== null;

  // The filtered list — used for display only. Deletion and the counters work off the
  // verdict map, which holds every checked item including those never drawn as a tile.
  const filtered = filter
    ? items.filter(i => verdicts.get(i.id)?.status === filter)
    : items;
  const shown = filtered.slice(0, MAX_TILES);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Verification</Text>
        <Text style={styles.sub}>
          {bundle
            ? `Index: ${bundle.files} files, ${bundle.unique_contents} unique (offline)`
            : 'Index: none — press "Index"'}
        </Text>
        <Text style={styles.sub}>
          Phone: {items.length}/{totalCount} loaded | checked {verdicts.size}
          {strategy ? ` | method: ${strategy}` : ' | method undetermined'}
        </Text>
        {progress && (
          <Text style={styles.prog}>
            checking {progress.done}/{progress.total}
          </Text>
        )}
      </View>

      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.btn, styles.btnIndex]}
          onPress={refreshBundle}
          disabled={running || isLoading}
        >
          <Text style={styles.btnText}>Index</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnProbe]}
          onPress={runProbe}
          disabled={running || isLoading}
        >
          <Text style={styles.btnText}>Probe</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, !hasMore && styles.btnOff]}
          onPress={() => loadPage(false)}
          disabled={!hasMore || running || isLoading}
        >
          <Text style={styles.btnText}>+{PAGE_SIZE}</Text>
        </TouchableOpacity>
        {running ? (
          <TouchableOpacity style={[styles.btn, styles.btnStop]} onPress={requestCancel}>
            <Text style={styles.btnText}>Stop</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={[styles.btn, styles.btnGo]} onPress={runVerify}>
              <Text style={styles.btnText}>Check page</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnAll]} onPress={runVerifyAll}>
              <Text style={styles.btnText}>Check ALL</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
        <TouchableOpacity
          style={[styles.chip, !filter && styles.chipOn]}
          onPress={() => setFilter(null)}
        >
          <Text style={styles.chipText}>all ({items.length})</Text>
        </TouchableOpacity>
        {Object.keys(STATUS_LABEL).map(st => (
          <TouchableOpacity
            key={st}
            style={[
              styles.chip,
              filter === st && styles.chipOn,
              { borderColor: STATUS_COLOR[st] },
            ]}
            onPress={() => setFilter(st)}
          >
            <Text style={[styles.chipText, { color: STATUS_COLOR[st] }]}>
              {STATUS_LABEL[st]} ({chipCount(st)})
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.delRow}>
        <TouchableOpacity
          style={[styles.testBtn, verifiedList.length === 0 && styles.btnOff]}
          onPress={async () => {
            const id = await deleteOneAsTest(verifiedList);
            if (id) {
              forgetDeleted([id]);
            }
          }}
          disabled={verifiedList.length === 0 || running}
        >
          <Text style={styles.delText}>Test: delete 1</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.delBtn, verifiedList.length === 0 && styles.btnOff]}
          onPress={confirmDelete}
          disabled={verifiedList.length === 0 || running}
        >
          <Text style={styles.delText}>
            Delete {verifiedList.length} confirmed
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.grid}>
        {filtered.length > shown.length && (
          <Text style={styles.capNote}>
            showing {shown.length} of {filtered.length} tiles — counters and deletion
            cover all {verdicts.size} checked items
          </Text>
        )}
        {shown.map(item => {
          const v = verdicts.get(item.id);
          const d = new Date(item.creationTime);
          const pad = (n: number) => String(n).padStart(2, '0');
          return (
            <View
              key={item.id}
              style={[
                styles.card,
                v && { borderColor: STATUS_COLOR[v.status] },
              ]}
            >
              <Image
                source={{ uri: item.uri }}
                style={styles.thumb}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={0}
              />
              <Text style={styles.fname} numberOfLines={1}>{item.filename}</Text>
              <Text style={styles.meta}>
                {d.getFullYear()}.{pad(d.getMonth() + 1)}.{pad(d.getDate())}
              </Text>
              {v && (
                <Text style={[styles.badge, { color: STATUS_COLOR[v.status] }]} numberOfLines={1}>
                  {v.status === 'verified' ? '✓' : '!'} {STATUS_LABEL[v.status]}
                </Text>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.logBox}>
        <ScrollView>
          {log.slice(-40).map((l, i) => (
            <Text key={i} style={styles.logLine}>{l}</Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  header: { paddingTop: 55, paddingHorizontal: 14, paddingBottom: 8, backgroundColor: '#fff' },
  title: { fontSize: 18, fontWeight: 'bold', color: '#222' },
  sub: { fontSize: 11, color: '#666', marginTop: 3 },
  prog: { fontSize: 12, color: '#1565c0', fontWeight: '600', marginTop: 3 },
  row: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#fff' },
  btn: { flex: 1, backgroundColor: '#5c6bc0', paddingVertical: 10, borderRadius: 6, alignItems: 'center' },
  btnProbe: { backgroundColor: '#00897b' },
  btnIndex: { backgroundColor: '#3949ab' },
  btnGo: { backgroundColor: '#43a047' },
  btnAll: { backgroundColor: '#1b5e20' },
  btnStop: { backgroundColor: '#e53935' },
  btnOff: { opacity: 0.35 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 11 },
  chips: { backgroundColor: '#fff', paddingHorizontal: 8, paddingBottom: 8, flexGrow: 0 },
  chip: { borderWidth: 1, borderColor: '#bbb', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4, marginRight: 5 },
  chipOn: { backgroundColor: '#eceff1' },
  chipText: { fontSize: 10, color: '#444' },
  delRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingBottom: 6 },
  testBtn: { backgroundColor: '#8d6e63', paddingVertical: 11, paddingHorizontal: 12, borderRadius: 6, alignItems: 'center' },
  delBtn: { flex: 1, backgroundColor: '#c62828', paddingVertical: 11, borderRadius: 6, alignItems: 'center' },
  delText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  list: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 6, paddingVertical: 6, gap: 4 },
  capNote: { width: '100%', fontSize: 9, color: '#78909c', paddingHorizontal: 4, paddingBottom: 4 },
  card: { width: 84, backgroundColor: '#fff', borderRadius: 5, alignItems: 'center', borderWidth: 2, borderColor: '#ddd', paddingBottom: 3 },
  thumb: { width: 80, height: 62, borderRadius: 3, backgroundColor: '#e0e0e0', marginTop: 2 },
  fname: { fontSize: 7, color: '#333', fontWeight: '600', paddingHorizontal: 2 },
  meta: { fontSize: 7, color: '#888' },
  badge: { fontSize: 6, fontWeight: 'bold', paddingHorizontal: 2 },
  logBox: { height: 92, backgroundColor: '#263238', paddingHorizontal: 8, paddingVertical: 4 },
  logLine: { fontSize: 9, color: '#b0bec5' },
});
