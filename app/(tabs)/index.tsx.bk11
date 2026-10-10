import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Alert, Platform, Image } from 'react-native';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';

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

interface MediaItem {
  uri: string;
  type: 'image' | 'video';
}

export default function App() {
  // Stan czujników i nagrywania (Krok 2 & 3)
  const [isRecording, setIsRecording] = useState(false);
  const [sessionData, setSessionData] = useState<IMURecord[]>([]);
  const [accelData, setAccelData] = useState<SensorData>({ x: 0, y: 0, z: 0 });
  const [gyroData, setGyroData] = useState<SensorData>({ x: 0, y: 0, z: 0 });

  // Stan mediów (Krok 4)
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);

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

  const toggleRecording = () => setIsRecording(!isRecording);

  // --- KROK 4: Obsługa Mediów (Zdjęcia / Wideo) ---
  const pickMediaFromGallery = async () => {
    // Prośba o uprawnienia do biblioteki
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Brak uprawnień', 'Potrzebujemy dostępu do galerii, aby wybrać pliki.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All, // Zdjęcia i wideo
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      const type = asset.type === 'video' ? 'video' : 'image';
      setMediaList(prev => [...prev, { uri: asset.uri, type }]);
    }
  };

  const captureMediaWithCamera = async () => {
    // Prośba o uprawnienia do aparatu
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Brak uprawnień', 'Potrzebujemy dostępu do aparatu, aby wykonać materiał.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      const type = asset.type === 'video' ? 'video' : 'image';
      setMediaList(prev => [...prev, { uri: asset.uri, type }]);
    }
  };

  const saveAndShareCSV = async () => {
    if (sessionData.length === 0) {
      Alert.alert('Brak danych', 'Najpierw nagraj próbki czujników.');
      return;
    }

    const header = 'timestamp,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z\n';
    const rows = sessionData
      .map(d => `${d.timestamp},${d.accel.x.toFixed(5)},${d.accel.y.toFixed(5)},${d.accel.z.toFixed(5)},${d.gyro.x.toFixed(5)},${d.gyro.y.toFixed(5)},${d.gyro.z.toFixed(5)}`)
      .join('\n');
    const csvContent = header + rows;

    try {
      if (Platform.OS === 'web') {
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `imu_session_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }

      const fileName = `imu_session_${Date.now()}.csv`;
      const file = new File(Paths.document, fileName);
      file.create();
      file.write(csvContent);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/csv',
          dialogTitle: 'Eksport danych IMU',
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        Alert.alert('Zapisano', `Plik:\n${file.uri}`);
      }
    } catch (error) {
      Alert.alert('Błąd', 'Nie udało się zapisać pliku CSV.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Krok 4: Dostęp do Mediów</Text>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Czujniki */}
        <View style={styles.card}>
          <Text style={styles.subtitle}>📐 IMU (Aktualne odczyty)</Text>
          <Text>Akc: X:{accelData.x.toFixed(2)} Y:{accelData.y.toFixed(2)} Z:{accelData.z.toFixed(2)}</Text>
          <Text>Żyr: X:{gyroData.x.toFixed(2)} Y:{gyroData.y.toFixed(2)} Z:{gyroData.z.toFixed(2)}</Text>
          <Text style={{ marginTop: 5, color: '#666' }}>Zebrane próbki: {sessionData.length} ({isRecording ? '🔴 Nagrywanie' : '⏸ Zatrzymane'})</Text>
          
          <View style={styles.rowButtons}>
            <TouchableOpacity style={[styles.miniButton, isRecording ? styles.btnStop : styles.btnStart]} onPress={toggleRecording}>
              <Text style={styles.btnText}>{isRecording ? 'STOP' : 'START'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.miniButton, styles.btnExport]} onPress={saveAndShareCSV}>
              <Text style={styles.btnText}>CSV EXPORT</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Sterowanie Mediami (Krok 4) */}
        <View style={styles.card}>
          <Text style={styles.subtitle}>📷 Zdjęcia i Wideo</Text>
          <View style={styles.rowButtons}>
            <TouchableOpacity style={[styles.miniButton, styles.btnMedia]} onPress={pickMediaFromGallery}>
              <Text style={styles.btnText}>📁 Wybierz z galerii</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.miniButton, styles.btnMedia]} onPress={captureMediaWithCamera}>
              <Text style={styles.btnText}>📸 Zrób zdjęcie/wideo</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Galeria podglądu załadowanych mediów */}
        <Text style={styles.subtitle2}>Załadowane pliki multimedialne ({mediaList.length}):</Text>
        <ScrollView horizontal style={styles.mediaContainer}>
          {mediaList.map((item, index) => (
            <View key={index} style={styles.mediaCard}>
              {item.type === 'image' ? (
                <Image source={{ uri: item.uri }} style={styles.mediaPreview} />
              ) : (
                <View style={[styles.mediaPreview, styles.videoPlaceholder]}>
                  <Text style={styles.videoText}>▶ WIDEO</Text>
                </View>
              )}
              <Text style={styles.mediaLabel}>#{index + 1} ({item.type})</Text>
            </View>
          ))}
          {mediaList.length === 0 && (
            <Text style={styles.emptyText}>Brak załadowanych mediów. Wybierz lub zrób zdjęcie.</Text>
          )}
        </ScrollView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5', paddingTop: 50 },
  title: { fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 10 },
  scroll: { paddingHorizontal: 20, paddingBottom: 30 },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 12, elevation: 2 },
  subtitle: { fontSize: 15, fontWeight: '600', marginBottom: 6, color: '#333' },
  subtitle2: { fontSize: 14, fontWeight: '600', marginTop: 10, marginBottom: 6, color: '#444' },
  rowButtons: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, gap: 10 },
  miniButton: { flex: 1, padding: 10, borderRadius: 8, alignItems: 'center' },
  btnStart: { backgroundColor: '#4CAF50' },
  btnStop: { backgroundColor: '#F44336' },
  btnExport: { backgroundColor: '#2196F3' },
  btnMedia: { backgroundColor: '#8E24AA' },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  mediaContainer: { flexDirection: 'row', minHeight: 120 },
  mediaCard: { marginRight: 10, alignItems: 'center', backgroundColor: '#fff', padding: 6, borderRadius: 8, elevation: 1 },
  mediaPreview: { width: 90, height: 90, borderRadius: 6, backgroundColor: '#ddd' },
  videoPlaceholder: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#333' },
  videoText: { color: '#fff', fontWeight: 'bold', fontSize: 10 },
  mediaLabel: { fontSize: 10, marginTop: 4, color: '#666' },
  emptyText: { color: '#888', fontStyle: 'italic', fontSize: 12, marginTop: 5 },
});

