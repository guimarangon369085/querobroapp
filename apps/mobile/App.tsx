import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';

export default function App() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0a0a0a'
      }}
    >
      <Text style={{ color: '#fff', fontSize: 18 }}>QuerobroApp Mobile</Text>
      <StatusBar style="light" />
    </View>
  );
}
