/**
 * The AI coach conversation.
 *
 * The digest is rebuilt from SQLite on every send rather than captured once when the screen
 * opens: a session logged mid-conversation should be visible to the coach on the next question,
 * and a stale snapshot would have it advising on numbers the user has already moved past.
 *
 * The assistant's reply streams in, so the bubble grows as tokens arrive. A refusal or an error
 * lands as its own message rather than an alert — whatever text already arrived stays on screen
 * and is marked as cut short, because a truncated answer presented as complete is worse than
 * an obviously interrupted one.
 */

import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { buildCoachPayload } from '../src/coach/payload.js';
import { streamCoachChat, type CancelStream } from '../src/coach/stream.js';
import { Banner, EmptyState } from '../src/components/ui.js';
import { API_BASE_URL } from '../src/config.js';
import { getExecutor } from '../src/db/provider.js';
import { colors, fontSize, fontWeight, radius, spacing } from '../src/theme.js';

interface ChatBubble {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Set when the reply stopped early — a refusal, a dropped connection, or a server fault. */
  interrupted?: 'refusal' | 'error';
}

export default function CoachChatScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const isHebrew = i18n.language === 'he';

  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const cancelRef = useRef<CancelStream | null>(null);

  // Abandoning the screen mid-generation must stop the request, or the socket stays open and
  // the callbacks fire against an unmounted component.
  useEffect(() => () => cancelRef.current?.(), []);

  const appendToLast = useCallback((text: string) => {
    setBubbles((current) => {
      const last = current[current.length - 1];
      if (!last || last.role !== 'assistant') return current;
      return [...current.slice(0, -1), { ...last, text: last.text + text }];
    });
  }, []);

  const markLast = useCallback((interrupted: 'refusal' | 'error', fallbackText: string) => {
    setBubbles((current) => {
      const last = current[current.length - 1];
      if (!last || last.role !== 'assistant') return current;
      return [
        ...current.slice(0, -1),
        // Keep whatever arrived; only substitute when nothing did.
        { ...last, text: last.text.length > 0 ? last.text : fallbackText, interrupted },
      ];
    });
  }, []);

  const send = () => {
    const question = draft.trim();
    if (!question || streaming || !API_BASE_URL) return;

    setDraft('');
    setStreaming(true);
    setBubbles((current) => [
      ...current,
      { id: `u-${Date.now()}`, role: 'user', text: question },
      { id: `a-${Date.now()}`, role: 'assistant', text: '' },
    ]);

    void (async () => {
      try {
        const db = await getExecutor();
        const context = await buildCoachPayload(db, { locale: isHebrew ? 'he' : 'en' });

        // Sent alongside the digest so the coach has the thread, not just the latest question.
        const history = [
          ...bubbles
            .filter((bubble) => bubble.text.trim().length > 0 && !bubble.interrupted)
            .map((bubble) => ({ role: bubble.role, content: bubble.text })),
          { role: 'user' as const, content: question },
        ].slice(-20);

        cancelRef.current = streamCoachChat({
          baseUrl: API_BASE_URL,
          body: { context, messages: history },
          handlers: {
            onDelta: appendToLast,
            onDone: () => setStreaming(false),
            onRefusal: () => {
              markLast('refusal', t('coach.refused'));
              setStreaming(false);
            },
            onError: (message) => {
              markLast('error', message);
              setStreaming(false);
            },
          },
        });
      } catch {
        markLast('error', t('coach.unavailable'));
        setStreaming(false);
      }
    })();
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.back}>{isHebrew ? '›' : '‹'}</Text>
        </Pressable>
        <Text style={styles.title}>{t('coach.title')}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.thread}
        contentContainerStyle={styles.threadContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {!API_BASE_URL ? (
          <>
            <EmptyState emoji="🔌" title={t('coach.notConfigured')} hint={t('coach.notConfiguredHint')} />
            <Banner tone="info">{t('coach.keyNote')}</Banner>
          </>
        ) : bubbles.length === 0 ? (
          <>
            <EmptyState emoji="🧠" title={t('coach.empty')} hint={t('coach.emptyHint')} />
            {[t('coach.suggest1'), t('coach.suggest2'), t('coach.suggest3')].map((suggestion) => (
              <Pressable
                key={suggestion}
                onPress={() => setDraft(suggestion)}
                style={styles.suggestion}
                accessibilityRole="button"
              >
                <Text style={styles.suggestionText}>{suggestion}</Text>
              </Pressable>
            ))}
          </>
        ) : (
          bubbles.map((bubble) => (
            <View
              key={bubble.id}
              style={[
                styles.bubble,
                bubble.role === 'user' ? styles.bubbleUser : styles.bubbleCoach,
                bubble.interrupted ? styles.bubbleInterrupted : null,
              ]}
            >
              {bubble.text.length === 0 && streaming ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text style={styles.bubbleText}>{bubble.text}</Text>
              )}
              {bubble.interrupted ? (
                <Text style={styles.interruptedNote}>{t('coach.cutShort')}</Text>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.md }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t('coach.placeholder')}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          multiline
          editable={API_BASE_URL !== null && !streaming}
        />
        <Pressable
          onPress={send}
          disabled={streaming || draft.trim().length === 0 || !API_BASE_URL}
          style={[
            styles.sendButton,
            (streaming || draft.trim().length === 0 || !API_BASE_URL) && styles.sendButtonDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('coach.send')}
        >
          <Text style={styles.sendButtonText}>{isHebrew ? '↑' : '↑'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create<{
  screen: ViewStyle;
  header: ViewStyle;
  back: TextStyle;
  title: TextStyle;
  thread: ViewStyle;
  threadContent: ViewStyle;
  bubble: ViewStyle;
  bubbleUser: ViewStyle;
  bubbleCoach: ViewStyle;
  bubbleInterrupted: ViewStyle;
  bubbleText: TextStyle;
  interruptedNote: TextStyle;
  suggestion: ViewStyle;
  suggestionText: TextStyle;
  composer: ViewStyle;
  input: TextStyle;
  sendButton: ViewStyle;
  sendButtonDisabled: ViewStyle;
  sendButtonText: TextStyle;
}>({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { color: colors.accent, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  thread: { flex: 1 },
  threadContent: { padding: spacing.lg, gap: spacing.md },
  bubble: {
    borderRadius: radius.lg,
    padding: spacing.md,
    maxWidth: '88%',
    borderWidth: 1,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accentSoft,
    borderColor: colors.accentBorder,
  },
  bubbleCoach: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  bubbleInterrupted: { borderColor: colors.warning },
  bubbleText: { color: colors.text, fontSize: fontSize.sm, lineHeight: 22, textAlign: 'auto' },
  interruptedNote: {
    color: colors.warning,
    fontSize: fontSize.xxs,
    marginTop: spacing.sm,
    textAlign: 'auto',
  },
  suggestion: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  suggestionText: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'auto' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    color: colors.text,
    fontSize: fontSize.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlign: 'auto',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: colors.surfaceHigh },
  sendButtonText: { color: colors.bg, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
});
