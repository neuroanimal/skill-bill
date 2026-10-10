import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, SafeAreaView, ScrollView, Dimensions } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import Svg, { Polyline, Circle, Line, Rect } from 'react-native-svg';

const MAX_SAMPLES = 40;
const SCREEN_WIDTH = Dimensions.get('window').width - 40;
const GRAPH_HEIGHT = 80;

interface Point3D {
  x: number;
  y: number;
  z: number;
}

export default function HomeScreen() {
  const [data, setData] = useState<Point3D>({ x: 0, y: 0, z: 0 });
  const [history, setHistory] = useState<Point3D[]>([]);

  useEffect(() => {
    Accelerometer.setUpdateInterval(50); // Odświeżanie 20 Hz (płynny wykres)

    const sub = Accelerometer.addListener((accel) => {
      setData(accel);
      setHistory((prev) => {
        const updated = [...prev, accel];
        return updated.length > MAX_SAMPLES ? updated.slice(1) : updated;
      });
    });

    return () => sub && sub.remove();
  }, []);

  const fmt = (val: number) => val?.toFixed(2) ?? '0.00';

  // Pomocnik do rysowania linii oscyloskopu dla danej osi
  const renderOscilloscope = (axis: 'x' | 'y' | 'z', color: string) => {
    if (history.length < 2) return null;

    const points = history
      .map((pt, index) => {
        const xPos = (index / (MAX_SAMPLES - 1)) * SCREEN_WIDTH;
        // Mapujemy wartość g-force (-2g do 2g) na wysokość SVG
        const val = Math.max(-2, Math.min(2, pt[axis]));
        const yPos = (GRAPH_HEIGHT / 2) - (val * (GRAPH_HEIGHT / 4));
        return `${xPos},${yPos}`;
      })
      .join(' ');

    return (
      <Svg height={GRAPH_HEIGHT} width={SCREEN_WIDTH} style={styles.svgGraph}>
        {/* Linia zerowa (referencyjna) */}
        <Line x1="0" y1={GRAPH_HEIGHT / 2} x2={SCREEN_WIDTH} y2={GRAPH_HEIGHT / 2} stroke="#334155" strokeDasharray="4" />
        {/* Wykres osi */}
        <Polyline points={points} fill="none" stroke={color} strokeWidth="2" />
      </Svg>
    );
  };

  // Prosta projekcja izometryczna 3D -> 2D dla punktu
  const render3DBox = () => {
    const boxSize = 140;
    const center = boxSize / 2;

    // Przeliczenie G-force na przesunięcie w przestrzeni z prostym obrotem izometrycznym
    const scale = 30;
    const isoX = center + (data.x - data.y) * Math.cos(Math.PI / 6) * scale;
    const isoY = center + (data.x + data.y) * Math.sin(Math.PI / 6) * scale - (data.z * scale * 0.5);

    return (
      <View style={styles.box3dContainer}>
        <Svg height={boxSize} width={boxSize}>
          {/* Obrys kostki podglądowej */}
          <Rect x="10" y="10" width={boxSize - 20} height={boxSize - 20} stroke="#334155" strokeWidth="1" fill="none" rx="8" />
          <Line x1={center} y1="10" x2={center} y2={boxSize - 10} stroke="#1e293b" strokeDasharray="2" />
          <Line x1="10" y1={center} x2={boxSize - 10} y2={center} stroke="#1e293b" strokeDasharray="2" />
          
          {/* Połączenie środka z punktem (wektor) */}
          <Line x1={center} y1={center} x2={isoX} y2={isoY} stroke="#38bdf8" strokeWidth="1.5" />
          
          {/* Kropka punktu 3D */}
          <Circle cx={isoX} cy={isoY} r="7" fill="#f43f5e" stroke="#ffffff" strokeWidth="2" />
        </Svg>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.badge}>KROK 2.1 / 10</Text>
        <Text style={styles.title}>Wizualizacja Telemetrii</Text>
        <Text style={styles.subtitle}>Oscylografy osiowe & rzut punktu 3D</Text>

        {/* Panel 3D Vector */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🎯 Wektor Wektor G-Force (Rzut 3D)</Text>
          {render3DBox()}
          <View style={styles.valuesRow}>
            <Text style={[styles.valText, { color: '#ef4444' }]}>X: {fmt(data.x)}</Text>
            <Text style={[styles.valText, { color: '#10b981' }]}>Y: {fmt(data.y)}</Text>
            <Text style={[styles.valText, { color: '#3b82f6' }]}>Z: {fmt(data.z)}</Text>
          </View>
        </View>

        {/* Oscyloskop Osia X */}
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { color: '#ef4444' }]}>📈 Oscyloskop Oś X (Przechył boczny)</Text>
          {renderOscilloscope('x', '#ef4444')}
        </View>

        {/* Oscyloskop Osia Y */}
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { color: '#10b981' }]}>📈 Oscyloskop Oś Y (Pochylenie przód/tył)</Text>
          {renderOscilloscope('y', '#10b981')}
        </View>

        {/* Oscyloskop Osia Z */}
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { color: '#3b82f6' }]}>📈 Oscyloskop Oś Z (Pion / Grawitacja)</Text>
          {renderOscilloscope('z', '#3b82f6')}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scroll: {
    padding: 20,
    alignItems: 'center',
  },
  badge: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 20,
    marginBottom: 4,
  },
  title: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: 'bold',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 14,
    marginBottom: 20,
  },
  card: {
    width: '100%',
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderColor: '#334155',
    borderWidth: 1,
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  svgGraph: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    marginTop: 4,
  },
  box3dContainer: {
    marginVertical: 10,
    backgroundColor: '#0f172a',
    padding: 10,
    borderRadius: 12,
  },
  valuesRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: 8,
  },
  valText: {
    fontSize: 16,
    fontFamily: 'Courier',
    fontWeight: 'bold',
  },
});

