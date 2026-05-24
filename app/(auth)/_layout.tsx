import { Stack } from 'expo-router'

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#000' } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="welcome" />
      <Stack.Screen name="login" />
      <Stack.Screen name="cadastro/dados" />
      <Stack.Screen name="cadastro/endereco" />
      <Stack.Screen name="cadastro/handle" />
      <Stack.Screen name="cadastro/pin" />
      <Stack.Screen name="cadastro/seguranca" />
      <Stack.Screen name="cadastro/pix" />
      <Stack.Screen name="recuperar/seguranca" />
      <Stack.Screen name="recuperar/codigo" />
      <Stack.Screen name="recuperar/novo-pin" />
    </Stack>
  )
}
