import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, SafeAreaView, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Accelerometer, Gyroscope, Magnetometer } from 'expo-sensors';
import Svg, { Polyline, Line, Circle } from 'react-native-svg';
import { Directory, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const MAX_SAMPLES = 50;
const GRAPH_WIDTH = 320;
const GRAPH_HEIGHT = 100;
const PROJ_SIZE = 120;

type Vector3 = { x: number; y: number; z: number };

type SampleRecord = {
  timestamp: number;
  ax: number; ay: number; az: number;
  gx: number; gy: number; gz: number;
  mx: number; my: number; mz: number;
};

export default function HomeScreen() {
  const [accel, setAccel] = useState<Vector3>({ x: 0, y: 0, z: -1 });
  const [gyro, setGyro] = useState<Vector3>({ x: 0, y: 0, z: 0 });
  const [mag, setMag] = useState<Vector3>({ x: 0, y: 0, z: 0 });

  const [accelHist, setAccelHist] = useState<Vector3[]>([]);
  const [gyroHist, setGyroHist] = useState<Vector3[]>([]);
  const [magHist, setMagHist] = useState<Vector3[]>([]);

  // Nagrywanie i bufor
  const [isRecording, setIsRecording] = useState(false);
  const [recordCount, setRecordCount] = useState(0);
  const recordedDataRef = useRef<SampleRecord[]>([]);

  const latestAccel = useRef<Vector3>({ x: 0, y: 0, z: 0 });
  const latestGyro = useRef<Vector3>({ x: 0, y: 0, z: 0 });
  const latestMag = useRef<Vector3>({ x: 0, y: 0, z: 0 });

  useEffect(() => {
    Accelerometer.setUpdateInterval(50);
    Gyroscope.setUpdateInterval(50);
    Magnetometer.setUpdateInterval(50);

    const accelSub = Accelerometer.addListener((data) => {
      latestAccel.current = data;
      setAccel(data);
      setAccelHist((prev) => [...prev.slice(-MAX_SAMPLES), data]);
    });

    const gyroSub = Gyroscope.addListener((data) => {
      latestGyro.current = data;
      setGyro(data);
      setGyroHist((prev) => [...prev.slice(-MAX_SAMPLES), data]);
    });

    const magSub = Magnetometer.addListener((data) => {
      latestMag.current = data;
      setMag(data);
      setMagHist((prev) => [...prev.slice(-MAX_SAMPLES), data]);
    });

    return () => {
      accelSub && accelSub.remove();
      gyroSub && gyroSub.remove();
      magSub && magSub.remove();
    };
  }, []);

  // Interwał zapisu próbek podczas nagrywania (20 Hz)
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isRecording) {
      interval = setInterval(() => {
        const sample: SampleRecord = {
          timestamp: Date.now(),
          ax: latestAccel.current.x,
          ay: latestAccel.current.y,
          az: latestAccel.current.z,
          gx: latestGyro.current.x,
          gy: latestGyro.current.y,
          gz: latestGyro.current.z,
          mx: latestMag.current.x,
          my: latestMag.current.y,
          mz: latestMag.current.z,
        };
        recordedDataRef.current.push(sample);
        setRecordCount(recordedDataRef.current.length);
      }, 50);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  const toggleRecording = () => {
    if (!isRecording) {
      recordedDataRef.current = [];
      setRecordCount(0);
      setIsRecording(true);
    } else {
      setIsRecording(false);
    }
  };

// ... reszta komponentu ...

const saveAndShareCSV = async () => {
  if (recordedDataRef.current.length === 0) {
    Alert.alert('Brak danych', 'Najpierw nagraj sesję przyciskiem START.');
    return;
  }

  try {
    // 1. Przygotowanie treści CSV
    let csvContent = 'timestamp,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z,mag_x,mag_y,mag_z\n';
    recordedDataRef.current.forEach((r) => {
      csvContent += `${r.timestamp},${r.ax.toFixed(4)},${r.ay.toFixed(4)},${r.az.toFixed(4)},${r.gx.toFixed(4)},${r.gy.toFixed(4)},${r.gz.toFixed(4)},${r.mx.toFixed(2)},${r.my.toFixed(2)},${r.mz.toFixed(2)}\n`;
    });

    // 2. Utworzenie pliku w katalogu dokumentów aplikacji (Nowe API)
    const fileName = `imu_session_${Date.now()}.csv`;
    const file = new File(Directory.document, fileName);

    // 3. Utworzenie pliku na dysku i zapis danych
    file.create();
    file.write(csvContent);

    // 4. Udostępnienie pliku przez uri
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/csv',
        dialogTitle: 'Eksportuj dane IMU',
        UTI: 'public.comma-separated-values-text',
      });
    } else {
      Alert.alert('Zapisano plik', `Lokalizacja:\n${file.uri}`);
    }
  } catch (err) {
    Alert.alert('Błąd zapisu', String(err));
  }
};

  const renderOscilloscope = (history: Vector3[], scaleMax: number) => {
    if (history.length === 0) return null;
    const step = GRAPH_WIDTH / (MAX_SAMPLES - 1);
    const midY = GRAPH_HEIGHT / 2;

    const pointsForAxis = (axis: 'x' | 'y' | 'z') =>
      history
        .map((item, i) => {
          const posX = i * step;
          const posY = midY - (item[axis] / scaleMax) * midY;
          const clampedY = Math.max(2, Math.min(GRAPH_HEIGHT - 2, posY));
          return `${posX.toFixed(1)},${clampedY.toFixed(1)}`;
        })
        .join(' ');

    return (
      <Svg height={GRAPH_HEIGHT} width={GRAPH_WIDTH}>
        <Line x1="0" y1={midY} x2={GRAPH_WIDTH} y2={midY} stroke="#334155" strokeDasharray="4" strokeWidth="1" />
        <Polyline points={pointsForAxis('x')} fill="none" stroke="#ef4444" strokeWidth="2" />
        <Polyline points={pointsForAxis('y')} fill="none" stroke="#22c55e" strokeWidth="2" />
        <Polyline points={pointsForAxis('z')} fill="none" stroke="#3b82f6" strokeWidth="2" />
      </Svg>
    );
  };

  const render3DProjection = (v: Vector3, scale: number, label: string) => {
    const cx = PROJ_SIZE / 2;
    const cy = PROJ_SIZE / 2;

    const projX = cx + (v.y - v.x) * Math.cos(Math.PI / 6) * scale;
    const projY = cy + (v.y + v.x) * Math.sin(Math.PI / 6) * scale - v.z * scale;

    const clampedX = Math.max(8, Math.min(PROJ_SIZE - 8, projX));
    const clampedY = Math.max(8, Math.min(PROJ_SIZE - 8, projY));

    return (
      <View style={styles.projContainer}>
        <Text style={styles.projTitle}>{label}</Text>
        <Svg height={PROJ_SIZE} width={PROJ_SIZE}>
          <Line x1={cx} y1={cy} x2={cx - 25} y2={cy + 14} stroke="#ef4444" strokeWidth="1" />
          <Line x1={cx} y1={cy} x2={cx + 25} y2={cy + 14} stroke="#22c55e" strokeWidth="1" />
          <Line x1={cx} y1={cy} x2={cx} y2={cy - 30} stroke="#3b82f6" strokeWidth="1" />
          <Line x1={cx} y1={cy} x2={clampedX} y2={clampedY} stroke="#f59e0b" strokeWidth="2" />
          <Circle cx={clampedX} cy={clampedY} r="4" fill="#f59e0b" />
        </Svg>
      </View>
    );
  };

  const fmt = (v: number) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1));

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.badge}>KROK 3.1 & 3.2 / 10</Text>
        <Text style={styles.title}>Rejestracja i Eksport CSV</Text>

        {/* --- PRZYCISKI STEROWANIA --- */}
        <View style={styles.controlBox}>
          <TouchableOpacity
            style={[styles.btn, isRecording ? styles.btnStop : styles.btnStart]}
            onPress={toggleRecording}
          >
            <Text style={styles.btnText}>
              {isRecording ? `🛑 STOP (${recordCount} próbek)` : '▶ START NAGRYWANIA'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.btnShare, isRecording && styles.btnDisabled]}
            onPress={saveAndShareCSV}
            disabled={isRecording}
          >
            <Text style={styles.btnText}>📁 ZAPISZ I UDOSTĘPNIJ CSV</Text>
          </TouchableOpacity>
        </View>

        {/* --- 1. AKCELEROMETR --- */}
        <View style={styles.card}>
          <Text style={styles.cardHeader}>📐 Akcelerometr (G-Force)</Text>
          <View style={styles.row}>
            {render3DProjection(accel, 20, 'Rzut (g)')}
            <View style={styles.oscBox}>
              <View style={styles.legend}>
                <Text style={{ color: '#ef4444' }}>X:{fmt(accel.x)}</Text>
                <Text style={{ color: '#22c55e' }}>Y:{fmt(accel.y)}</Text>
                <Text style={{ color: '#3b82f6' }}>Z:{fmt(accel.z)}</Text>
              </View>
              {renderOscilloscope(accelHist, 2)}
            </View>
          </View>
        </View>

        {/* --- 2. ŻYROSKOP --- */}
        <View style={styles.card}>
          <Text style={styles.cardHeader}>🔄 Żyroskop (Prędkość Kątowa)</Text>
          <View style={styles.row}>
            {render3DProjection(gyro, 6, 'Rzut (rad/s)')}
            <View style={styles.oscBox}>
              <View style={styles.legend}>
                <Text style={{ color: '#ef4444' }}>X:{fmt(gyro.x)}</Text>
                <Text style={{ color: '#22c55e' }}>Y:{fmt(gyro.y)}</Text>
                <Text style={{ color: '#3b82f6' }}>Z:{fmt(gyro.z)}</Text>
              </View>
              {renderOscilloscope(gyroHist, 5)}
            </View>
          </View>
        </View>

        {/* --- 3. MAGNETOMETR --- */}
        <View style={styles.card}>
          <Text style={styles.cardHeader}>🧲 Magnetometr (Pole Magnetyczne)</Text>
          <View style={styles.row}>
            {render3DProjection(mag, 0.6, 'Rzut (μT)')}
            <View style={styles.oscBox}>
              <View style={styles.legend}>
                <Text style={{ color: '#ef4444' }}>X:{fmt(mag.x)}</Text>
                <Text style={{ color: '#22c55e' }}>Y:{fmt(mag.y)}</Text>
                <Text style={{ color: '#3b82f6' }}>Z:{fmt(mag.z)}</Text>
              </View>
              {renderOscilloscope(magHist, 60)}
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f19' },
  scroll: { padding: 12, alignItems: 'center' },
  badge: { color: '#38bdf8', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  title: { color: '#f8fafc', fontSize: 20, fontWeight: 'bold', marginBottom: 12 },
  controlBox: { width: '100%', marginBottom: 14, gap: 8 },
  btn: { paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  btnStart: { backgroundColor: '#16a34a' },
  btnStop: { backgroundColor: '#dc2626' },
  btnShare: { backgroundColor: '#0284c7' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 13 },
  card: {
    width: '100%',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: { color: '#f8fafc', fontSize: 14, fontWeight: 'bold', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  projContainer: {
    width: PROJ_SIZE,
    height: PROJ_SIZE + 10,
    backgroundColor: '#090d16',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projTitle: { color: '#94a3b8', fontSize: 9, position: 'absolute', top: 3, fontWeight: '600' },
  oscBox: { flex: 1, marginLeft: 8, alignItems: 'center' },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginBottom: 2,
    fontFamily: 'Courier',
    fontSize: 10,
    fontWeight: 'bold',
  },
});

