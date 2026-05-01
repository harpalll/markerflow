import { StyleSheet, Text, View } from 'react-native';

export function ScannerScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>MarkerFlow</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
});
