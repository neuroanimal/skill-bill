import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, SafeAreaView, ScrollView } from 'react-native';
import { Accelerometer, Gyroscope, Magnetometer } from 'expo-sensors';

export default function HomeScreen() {
  const [{ x: ax, y: ay, z: az }, setAccelData] = useState({ x: 0, y: 0, z: 0 });
  const [{ x: gx, y: gy, z: gz }, setGyroData] = useState({ x: 0, y: 0, z: 0 });
  const [{ x: mx, y: my, z: mz }, setMagData] = useState({ x: 0, y: 0, z: 0 });

  useEffect(() => {
    // Częstotliwość odświeżania: co 100 ms (10 razy na sekundę)
    Accelerometer.setUpdateInterval(100);
    Gyroscope.setUpdateInterval(100);
    Magnetometer.setUpdateInterval(100);

    const accelSub = Accelerometer.addListener(setAccelData);
    const gyroSub = Gyroscope.addListener(setGyroData);
    const magSub = Magnetometer.addListener(setMagData);

    return () => {
      accelSub && accelSub.remove();
      gyroSub && gyroSub.remove();
      magSub && magSub.remove();
    };
  }, []);

  const fmt = (val: number) => val?.toFixed(2) ?? '0.00';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.badge}>KROK 2 / 10</Text>
        <Text style={styles.title}>Telemetria i Czujniki</Text>
        <Text style={styles.subtitle}>Odczyt danych z iPhona w czasie rzeczywistym</Text>

        {/* Akcelerometr */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📐 Akcelerometr (G-force)</Text>
          <View style={styles.row}>
            <Text style={styles.label}>X:</Text><Text style={styles.val}>{fmt(ax)}</Text>
            <Text style={styles.label}>Y:</Text><Text style={styles.val}>{fmt(ay)}</Text>
            <Text style={styles.label}>Z:</Text><Text style={styles.val}>{fmt(az)}</Text>
          </View>
        </View>

        {/* Żyroskop */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🔄 Żyroskop (rad/s)</Text>
          <View style={styles.row}>
            <Text style={styles.label}>X:</Text><Text style={styles.val}>{fmt(gx)}</Text>
            <Text style={styles.label}>Y:</Text><Text style={styles.val}>{fmt(gy)}</Text>
            <Text style={styles.label}>Z:</Text><Text style={styles.val}>{fmt(gz)}</Text>
          </View>
        </View>

        {/* Magnetometr */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🧲 Magnetometr (μT)</Text>
          <View style={styles.row}>
            <Text style={styles.label}>X:</Text><Text style={styles.val}>{fmt(mx)}</Text>
            <Text style={styles.label}>Y:</Text><Text style={styles.val}>{fmt(my)}</Text>
            <Text style={styles.label}>Z:</Text><Text style={styles.val}>{fmt(mz)}</Text>
          </View>
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
    padding: 18,
    marginBottom: 16,
    borderColor: '#334155',
    borderWidth: 1,
  },
  cardTitle: {
    color: '#38bdf8',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: 'bold',
  },
  val: {
    color: '#f8fafc',
    fontSize: 18,
    fontFamily: 'Courier',
    fontWeight: 'bold',
    width: 60,
  },
});

