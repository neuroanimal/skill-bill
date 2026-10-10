import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, SafeAreaView } from 'react-native';

export default function HomeScreen() {
  const [count, setCount] = useState(0);
  const [time, setTime] = useState(new Date().toLocaleTimeString());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.badge}>KROK 1 / 10</Text>
        <Text style={styles.title}>Skill Bill - Baseline</Text>
        <Text style={styles.subtitle}>Test połączenia z iPhonem</Text>

        <View style={styles.clockBox}>
          <Text style={styles.clockLabel}>Czas telefonu:</Text>
          <Text style={styles.clockValue}>{time}</Text>
        </View>

        <View style={styles.counterBox}>
          <Text style={styles.counterValue}>{count}</Text>
          <TouchableOpacity 
            style={styles.button} 
            onPress={() => setCount(prev => prev + 1)}
            activeOpacity={0.7}
          >
            <Text style={styles.buttonText}>Kliknij (+1)</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderColor: '#334155',
    borderWidth: 1,
  },
  badge: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  title: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: 'bold',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 14,
    marginBottom: 24,
  },
  clockBox: {
    backgroundColor: '#0f172a',
    padding: 16,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  clockLabel: {
    color: '#64748b',
    fontSize: 12,
  },
  clockValue: {
    color: '#38bdf8',
    fontSize: 28,
    fontWeight: '600',
  },
  counterBox: {
    width: '100%',
    alignItems: 'center',
  },
  counterValue: {
    color: '#f8fafc',
    fontSize: 48,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});

