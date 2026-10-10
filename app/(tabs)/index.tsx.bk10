import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Alert, Platform } from 'react-native';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { File, Paths } from 'expo-file-system'; // Nowoczesne, obiektowe API dla SDK 54+
import * as Sharing from 'expo-sharing';

// Typy
interface SensorData {
  x: number;
  y: number;
  z: number;
}

interface IMURecord {
  timestamp: number;
  accel: SensorData;
  gyro: SensorData;
}

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [sessionData, setSessionData] = useState<IMURecord[]>([]);
  
  const [accelData, setAccelData] = useState<SensorData>({ x: 0, y: 0, z: 0 });
  const [gyroData, setGyroData] = useState<SensorData>({ x: 0, y: 0, z: 0 });

  const accelSubscription = useRef<any>(null);
  const gyroSubscription = useRef<any>(null);
  
  const currentAccel = useRef<SensorData>({ x: 0, y: 0, z: 0 });
  const currentGyro = useRef<SensorData>({ x: 0, y: 0, z: 0 });

  useEffect(() => {
    Accelerometer.setUpdateInterval(100);
    Gyroscope.setUpdateInterval(100);

    accelSubscription.current = Accelerometer.addListener(data => {
      setAccelData(data);
      currentAccel.current = data;
    });

    gyroSubscription.current = Gyroscope.addListener(data => {
      setGyroData(data);
      currentGyro.current = data;
    });

    return () => {
      accelSubscription.current?.remove();
      gyroSubscription.current?.remove();
    };
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      interval = setInterval(() => {
        setSessionData(prev => [
          ...prev,
          {
            timestamp: Date.now(),
            accel: currentAccel.current,
            gyro: currentGyro.current,
          }
        ]);
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  const toggleRecording = () => {
    setIsRecording(!isRecording);
  };

  const clearData = () => {
    if (isRecording) {
      Alert.alert('Błąd', 'Zatrzymaj nagrywanie przed wyczyszczeniem danych.');
      return;
    }
    setSessionData([]);
  };

  const saveAndShareCSV = async () => {
    if (sessionData.length === 0) {
      Alert.alert('Brak danych', 'Nie ma żadnych danych do eksportu.');
      return;
    }

    const header = 'timestamp,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z\n';
    const rows = sessionData
      .map(d => 
        `${d.timestamp},${d.accel.x.toFixed(5)},${d.accel.y.toFixed(5)},${d.accel.z.toFixed(5)},${d.gyro.x.toFixed(5)},${d.gyro.y.toFixed(5)},${d.gyro.z.toFixed(5)}`
      )
      .join('\n');
    const csvContent = header + rows;

    try {
      // 1. Zabezpieczenie dla przeglądarki Web
      if (Platform.OS === 'web') {
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `imu_session_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        Alert.alert('Sukces', 'Plik CSV został pobrany.');
        return;
      }

      // 2. Całkowicie nowy sposób tworzenia plików (w Expo SDK 54) - ZERO "deprecated"
      const fileName = `imu_session_${Date.now()}.csv`;
      
      // Paths.document kieruje prosto do katalogu dokumentów. File to obiektowa reprezentacja.
      const file = new File(Paths.document, fileName);
      
      // Inicjalizujemy nowy plik
      file.create();
      // Wrzucamy do niego dane wprost (nowe API pozwala to zrobić synchronicznie)
      file.write(csvContent);

      // 3. Otwieramy Share Sheet na iOS
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/csv',
          dialogTitle: 'Eksport danych IMU',
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        Alert.alert('Zapisano', `Plik został zapisany pomyślnie:\n${file.uri}`);
      }
    } catch (error) {
      console.error('Błąd eksportu:', error);
      Alert.alert('Błąd', 'Wystąpił problem podczas eksportowania pliku.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>IMU Data Logger</Text>

      <View style={styles.card}>
        <Text style={styles.subtitle}>Akcelerometr (g)</Text>
        <Text>X: {accelData.x.toFixed(3)}</Text>
        <Text>Y: {accelData.y.toFixed(3)}</Text>
        <Text>Z: {accelData.z.toFixed(3)}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.subtitle}>Żyroskop (rad/s)</Text>
        <Text>X: {gyroData.x.toFixed(3)}</Text>
        <Text>Y: {gyroData.y.toFixed(3)}</Text>
        <Text>Z: {gyroData.z.toFixed(3)}</Text>
      </View>

      <View style={styles.stats}>
        <Text>Zebrane próbki: {sessionData.length}</Text>
        <Text>Status: {isRecording ? '🔴 Nagrywanie...' : '⏸ Zatrzymano'}</Text>
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity 
          style={[styles.button, isRecording ? styles.buttonStop : styles.buttonStart]} 
          onPress={toggleRecording}
        >
          <Text style={styles.buttonText}>{isRecording ? 'Zatrzymaj' : 'Start'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={saveAndShareCSV}>
          <Text style={styles.buttonText}>Eksportuj CSV</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.button, styles.buttonClear]} onPress={clearData}>
          <Text style={styles.buttonText}>Wyczyść</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.logContainer}>
        {sessionData.slice(-10).reverse().map((d, index) => (
          <Text key={index} style={styles.logText}>
            {d.timestamp}: A({d.accel.x.toFixed(1)}, {d.accel.y.toFixed(1)}, {d.accel.z.toFixed(1)}) 
            G({d.gyro.x.toFixed(1)}, {d.gyro.y.toFixed(1)}, {d.gyro.z.toFixed(1)})
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', paddingTop: 60, paddingHorizontal: 20 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 15, elevation: 2 },
  subtitle: { fontSize: 16, fontWeight: '600', marginBottom: 5 },
  stats: { alignItems: 'center', marginBottom: 20 },
  buttons: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  button: { backgroundColor: '#2196F3', padding: 12, borderRadius: 8, flex: 1, marginHorizontal: 5, alignItems: 'center' },
  buttonStart: { backgroundColor: '#4CAF50' },
  buttonStop: { backgroundColor: '#F44336' },
  buttonClear: { backgroundColor: '#9E9E9E' },
  buttonText: { color: '#fff', fontWeight: 'bold' },
  logContainer: { flex: 1, backgroundColor: '#fff', padding: 10, borderRadius: 10, elevation: 1, marginBottom: 20 },
  logText: { fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', borderBottomWidth: 1, borderBottomColor: '#eee', paddingVertical: 4 },
});


