import React, { useEffect, useState } from 'react';
import { Text, View, StyleSheet, ActivityIndicator, Button } from 'react-native';
import { Camera } from 'react-native-vision-camera';

export default function HomeScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const status = await Camera.getCameraPermissionStatus();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const requestPermission = async () => {
    const status = await Camera.requestCameraPermission();
    setHasPermission(status === 'granted');
  };

  if (hasPermission === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" />
        <Text style={styles.text}>Sprawdzanie uprawnień kamery...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Skill Bill - Moduł Kamery</Text>
      <Text style={styles.subText}>
        Dostęp do kamery: {hasPermission ? '✅ Przyznany' : '❌ Brak dostępu'}
      </Text>
      {!hasPermission && (
        <Button title="Poproś o dostęp do kamery" onPress={requestPermission} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 20,
  },
  text: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  subText: {
    fontSize: 16,
    color: '#555',
    marginBottom: 20,
  },
});
