import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, SafeAreaView, ScrollView } from 'react-native';
import { Accelerometer, Gyroscope, Magnetometer } from 'expo-sensors';
import Svg, { Polyline, Line, Circle, Text as SvgText } from 'react-native-svg';

const MAX_SAMPLES = 50;
const GRAPH_WIDTH = 320;
const GRAPH_HEIGHT = 120;
const PROJ_SIZE = 140;

type Vector3 = { x: number; y: number; z: number };

export default function HomeScreen() {
  const [accel, setAccel] = useState<Vector3>({ x: 0, y: 0, z: -1 });
  const [gyro, setGyro] = useState<Vector3>({ x: 0, y: 0, z: 0 });
  const [mag, setMag] = useState<Vector3>({ x: 0, y: 0, z: 0 });

  const [accelHist, setAccelHist] = useState<Vector3[]>([]);
  const [gyroHist, setGyroHist] = useState<Vector3[]>([]);
  const [magHist, setMagHist] = useState<Vector3[]>([]);

  useEffect(() => {
    Accelerometer.setUpdateInterval(40);
    Gyroscope.setUpdateInterval(40);
    Magnetometer.setUpdateInterval(40);

    const accelSub = Accelerometer.addListener((data) => {
      setAccel(data);
      setAccelHist((prev) => [...prev.slice(-MAX_SAMPLES), data]);
    });

    const gyroSub = Gyroscope.addListener((data) => {
      setGyro(data);
      setGyroHist((prev) => [...prev.slice(-MAX_SAMPLES), data]);
    });

    const magSub = Magnetometer.addListener((data) => {
      setMag(data);
      setMagHist((prev) => [...prev.slice(-MAX_SAMPLES), data]);
    });

    return () => {
      accelSub && accelSub.remove();
      gyroSub && gyroSub.remove();
      magSub && magSub.remove();
    };
  }, []);

  // --- RYSOWANIE OSCYLOSKOPU ---
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
        {/* Oś zerowa */}
        <Line x1="0" y1={midY} x2={GRAPH_WIDTH} y2={midY} stroke="#334155" strokeDasharray="4" strokeWidth="1" />
        {/* Przebiegi osiowe */}
        <Polyline points={pointsForAxis('x')} fill="none" stroke="#ef4444" strokeWidth="2" />
        <Polyline points={pointsForAxis('y')} fill="none" stroke="#22c55e" strokeWidth="2" />
        <Polyline points={pointsForAxis('z')} fill="none" stroke="#3b82f6" strokeWidth="2" />
      </Svg>
    );
  };

  // --- RZUT PUNKTU / WEKTORA 3D NA PŁASZCZYZNĘ 2D (Izometria) ---
  const render3DProjection = (v: Vector3, scale: number, label: string) => {
    const cx = PROJ_SIZE / 2;
    const cy = PROJ_SIZE / 2;

    // Prosta projekcja izometryczna 3D -> 2D
    // X skręca w lewo-dół, Y w prawo-dół, Z idzie pionowo w górę
    const projX = cx + (v.y - v.x) * Math.cos(Math.PI / 6) * scale;
    const projY = cy + (v.y + v.x) * Math.sin(Math.PI / 6) * scale - v.z * scale;

    const clampedX = Math.max(10, Math.min(PROJ_SIZE - 10, projX));
    const clampedY = Math.max(10, Math.min(PROJ_SIZE - 10, projY));

    return (
      <View style={styles.projContainer}>
        <Text style={styles.projTitle}>{label}</Text>
        <Svg height={PROJ_SIZE} width={PROJ_SIZE}>
          {/* Osie odniesienia 3D w środku */}
          <Line x1={cx} y1={cy} x2={cx - 30} y2={cy + 17} stroke="#ef4444" strokeWidth="1" />
          <Line x1={cx} y1={cy} x2={cx + 30} y2={cy + 17} stroke="#22c55e" strokeWidth="1" />
          <Line x1={cx} y1={cy} x2={cx} y2={cy - 35} stroke="#3b82f6" strokeWidth="1" />

          {/* Wektor od środka do punktu */}
          <Line x1={cx} y1={cy} x2={clampedX} y2={clampedY} stroke="#f59e0b" strokeWidth="2" />
          {/* Punkt końcowy w przestrzeni */}
          <Circle cx={clampedX} cy={clampedY} r="5" fill="#f59e0b" />
        </Svg>
      </View>
    );
  };

  const fmt = (v: number) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1));

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.badge}>KROK 2.2 / 10</Text>
        <Text style={styles.title}>Pełna Telemetria IMU</Text>
        <Text style={styles.subtitle}>Oscyloskopy osiowe & Rzuty 3D dla 3 sensorów</Text>

        {/* --- 1. G-FORCE / AKCELEROMETR --- */}
        <View style={styles.card}>
          <Text style={styles.cardHeader}>📐 Akcelerometr (G-Force)</Text>
          <View style={styles.row}>
            {render3DProjection(accel, 25, 'Rzut 3D (g)')}
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
            {render3DProjection(gyro, 8, 'Rzut 3D (rad/s)')}
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
            {render3DProjection(mag, 0.8, 'Rzut 3D (μT)')}
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
  title: { color: '#f8fafc', fontSize: 20, fontWeight: 'bold' },
  subtitle: { color: '#64748b', fontSize: 12, marginBottom: 12 },
  card: {
    width: '100%',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: { color: '#f8fafc', fontSize: 14, fontWeight: 'bold', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  projContainer: {
    width: PROJ_SIZE,
    height: PROJ_SIZE + 15,
    backgroundColor: '#090d16',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projTitle: { color: '#94a3b8', fontSize: 10, position: 'absolute', top: 4, fontWeight: '600' },
  oscBox: { flex: 1, marginLeft: 8, alignItems: 'center' },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginBottom: 4,
    fontFamily: 'Courier',
    fontSize: 11,
    fontWeight: 'bold',
  },
});

