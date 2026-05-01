import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { ScannerScreen } from './src/components/ScannerScreen';

export default function App() {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScannerScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
});
