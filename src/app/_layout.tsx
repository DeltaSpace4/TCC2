import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }}>
    <Stack.Screen name="index" />
    <Stack.Screen name="cadastro" />
    <Stack.Screen name="home" />
    <Stack.Screen name="denuncia" />
    <Stack.Screen name="historico" />
    <Stack.Screen name="conta" />
    <Stack.Screen name="block" />
  </Stack>
}
