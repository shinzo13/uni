import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { useSession } from '@/session/SessionProvider';
import { colors, spacing, text } from '@/theme';

type Mode = 'sign-in' | 'sign-up';

export default function SignInScreen() {
  const { signIn, signUp } = useSession();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await (mode === 'sign-in' ? signIn : signUp)(email.trim(), password);
    } catch (caught) {
      setError(describe(caught, mode));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <Text style={styles.logo}>uni</Text>
        <Text style={styles.tagline}>USOS, Moodle and Teams in one place</Text>
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy || !email || !password}
            onPress={submit}
            style={({ pressed }) => [styles.button, (busy || !email || !password) && styles.disabled, pressed && styles.pressed]}
          >
            <Text style={styles.buttonLabel}>{mode === 'sign-in' ? 'Sign in' : 'Create account'}</Text>
          </Pressable>
          <Pressable onPress={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
            <Text style={styles.switch}>
              {mode === 'sign-in' ? 'No account? Create one' : 'Have an account? Sign in'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function describe(error: unknown, mode: Mode) {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Wrong email or password.';
    if (error.status === 409) return 'This email is already registered.';
    if (error.status === 422) return mode === 'sign-up' ? 'Use a valid email and at least 8 characters.' : 'Check your email.';
    return error.message;
  }
  return 'Cannot reach the server.';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  logo: { fontSize: 40, fontWeight: '700', color: colors.text },
  tagline: { ...text.body, color: colors.muted, marginTop: spacing.xs },
  form: { marginTop: spacing.xl, gap: spacing.md },
  input: {
    ...text.body,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  error: { ...text.caption, color: colors.danger },
  button: { alignItems: 'center', paddingVertical: spacing.md, borderRadius: 12, backgroundColor: colors.accent },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
  buttonLabel: { fontSize: 16, fontWeight: '600', color: colors.background },
  switch: { ...text.body, color: colors.muted, textAlign: 'center' },
});
