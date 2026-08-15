/**
 * The AI coach conversation.
 *
 * Lives directly on the tab now (previously a screen pushed from a button on the progress
 * digest) — the chat is the thing people want first, so it no longer sits behind an extra tap.
 * The progress digest moved to `app/progress.tsx`, reached from the "View progress" link here.
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

import type { AiNutritionMenu, AiWorkoutPlan } from '@fit/shared/schemas';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { useAuth } from '../src/auth/AuthProvider.js';
import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import { buildCoachPayload } from '../src/coach/payload.js';
import { streamCoachChat, type CancelStream } from '../src/coach/stream.js';
import { NutritionMenuCard, WorkoutPlanCard } from '../src/components/CoachProposalCard.js';
import { Banner, BackButton, EmptyState } from '../src/components/ui.js';
import { API_BASE_URL } from '../src/config.js';
import { activatePlan, addPlanDay, addPlanDayExercise, createPlan } from '../src/db/plans.js';
import { getExecutor, newId } from '../src/db/provider.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../src/theme.js';

/** Placeholder shown from send() until the first token, tool call, or error arrives. */
interface PendingBubble {
  id: string;
  kind: 'pending';
}

interface TextBubble {
  id: string;
  kind: 'text';
  role: 'user' | 'assistant';
  text: string;
  /** Set when the reply stopped early — a refusal, a dropped connection, or a server fault. */
  interrupted?: 'refusal' | 'error';
}

interface PlanProposalBubble {
  id: string;
  kind: 'plan_proposal';
  plan: AiWorkoutPlan;
  applied: boolean;
  applying: boolean;
}

interface NutritionProposalBubble {
  id: string;
  kind: 'nutrition_proposal';
  menu: AiNutritionMenu;
}

type ChatBubble = PendingBubble | TextBubble | PlanProposalBubble | NutritionProposalBubble;

export default function CoachChatScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const isHebrew = i18n.language === 'he';
  const { session, isConfigured } = useAuth();
  const userId = useCurrentUserId();
  const canChat = API_BASE_URL !== null && isConfigured && session != null;
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

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
      if (!last) return current;
      if (last.kind === 'pending') {
        return [...current.slice(0, -1), { id: last.id, kind: 'text', role: 'assistant', text }];
      }
      if (last.kind === 'text' && last.role === 'assistant' && !last.interrupted) {
        return [...current.slice(0, -1), { ...last, text: last.text + text }];
      }
      // A proposal card already closed off the previous assistant turn — open a fresh bubble
      // for any prose that follows it in the same reply, rather than losing the text.
      return [...current, { id: `a-${Date.now()}`, kind: 'text', role: 'assistant', text }];
    });
  }, []);

  const markLast = useCallback((interrupted: 'refusal' | 'error', fallbackText: string) => {
    setBubbles((current) => {
      const last = current[current.length - 1];
      if (!last) return current;
      if (last.kind === 'pending') {
        return [
          ...current.slice(0, -1),
          { id: last.id, kind: 'text', role: 'assistant', text: fallbackText, interrupted },
        ];
      }
      if (last.kind === 'text' && last.role === 'assistant') {
        return [
          ...current.slice(0, -1),
          // Keep whatever arrived; only substitute when nothing did.
          { ...last, text: last.text.length > 0 ? last.text : fallbackText, interrupted },
        ];
      }
      return [
        ...current,
        { id: `a-${Date.now()}`, kind: 'text', role: 'assistant', text: fallbackText, interrupted },
      ];
    });
  }, []);

  /** Replaces the pending placeholder with a proposal card, or appends one if text already arrived. */
  const appendProposal = useCallback((bubble: PlanProposalBubble | NutritionProposalBubble) => {
    setBubbles((current) => {
      const last = current[current.length - 1];
      if (last?.kind === 'pending') return [...current.slice(0, -1), bubble];
      return [...current, bubble];
    });
  }, []);

  /**
   * Materialises a proposed plan into real plan tables and makes it the active plan. Blank sets
   * are not created here — starting a session from the new plan day is what does that (see
   * `startSessionFromPlanDay`), the same as any hand-built plan.
   */
  const applyPlan = useCallback((bubbleId: string, plan: AiWorkoutPlan) => {
    setBubbles((current) =>
      current.map((bubble) =>
        bubble.id === bubbleId && bubble.kind === 'plan_proposal'
          ? { ...bubble, applying: true }
          : bubble,
      ),
    );

    void (async () => {
      try {
        const db = await getExecutor();
        const planId = await createPlan(db, userId, newId, plan.planName);
        for (const day of plan.days) {
          const dayId = await addPlanDay(db, newId, planId, day.name);
          for (const exercise of day.exercises) {
            await addPlanDayExercise(db, newId, dayId, exercise.exerciseKey, {
              targetSets: exercise.targetSets,
              targetRepsMin: exercise.targetRepsMin,
              targetRepsMax: exercise.targetRepsMax,
              notes: exercise.notes,
            });
          }
        }
        await activatePlan(db, userId, planId);

        setBubbles((current) =>
          current.map((bubble) =>
            bubble.id === bubbleId && bubble.kind === 'plan_proposal'
              ? { ...bubble, applying: false, applied: true }
              : bubble,
          ),
        );
      } catch {
        setBubbles((current) =>
          current.map((bubble) =>
            bubble.id === bubbleId && bubble.kind === 'plan_proposal'
              ? { ...bubble, applying: false }
              : bubble,
          ),
        );
      }
    })();
    // Once, on mount. `userId` cannot change under this screen — AppGate remounts the subtree
    // on a change of account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = () => {
    const question = draft.trim();
    // AppGate (the root sign-in wall) guarantees a session by the time any screen renders, so
    // reaching send() with none should not happen — but the check stays as a hard backstop: this
    // is the call that reaches the paid model, and it must never fire without a token.
    if (!question || streaming || !API_BASE_URL || !session) return;

    setDraft('');
    setStreaming(true);
    setBubbles((current) => [
      ...current,
      { id: `u-${Date.now()}`, kind: 'text', role: 'user', text: question },
      { id: `a-${Date.now()}`, kind: 'pending' },
    ]);

    void (async () => {
      try {
        const db = await getExecutor();
        const context = await buildCoachPayload(db, userId, { locale: isHebrew ? 'he' : 'en' });

        // Sent alongside the digest so the coach has the thread, not just the latest question.
        // A proposal card has no text of its own, so it is summarised into a short bracketed
        // line rather than dropped — otherwise a follow-up like "change day two" would land on
        // a model with no memory of having proposed anything.
        const history = [
          ...bubbles
            .map((bubble): { role: 'user' | 'assistant'; content: string } | null => {
              if (bubble.kind === 'text') {
                if (bubble.text.trim().length === 0 || bubble.interrupted) return null;
                return { role: bubble.role, content: bubble.text };
              }
              if (bubble.kind === 'plan_proposal') {
                return {
                  role: 'assistant',
                  content: `[Proposed workout plan: "${bubble.plan.planName}"]`,
                };
              }
              if (bubble.kind === 'nutrition_proposal') {
                return {
                  role: 'assistant',
                  content: `[Proposed nutrition menu: "${bubble.menu.summary}"]`,
                };
              }
              return null;
            })
            .filter((entry): entry is { role: 'user' | 'assistant'; content: string } => entry !== null),
          { role: 'user' as const, content: question },
        ].slice(-20);

        cancelRef.current = streamCoachChat({
          baseUrl: API_BASE_URL,
          accessToken: session.access_token,
          body: { context, messages: history },
          handlers: {
            onDelta: appendToLast,
            onPlanProposal: (plan) => {
              appendProposal({
                id: `p-${Date.now()}`,
                kind: 'plan_proposal',
                plan,
                applied: false,
                applying: false,
              });
            },
            onNutritionProposal: (menu) => {
              appendProposal({ id: `n-${Date.now()}`, kind: 'nutrition_proposal', menu });
            },
            onDone: () => {
              setStreaming(false);
              // Nothing arrived at all (no text, no proposal) — drop the placeholder rather
              // than leaving a bubble with a spinner that will now never resolve.
              setBubbles((current) => {
                const last = current[current.length - 1];
                return last?.kind === 'pending' ? current.slice(0, -1) : current;
              });
            },
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
        <BackButton />
        <Text style={styles.title}>{t('coach.title')}</Text>
        <Pressable onPress={() => router.push('/(tabs)/progress')} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.viewProgress}>📈 {t('coach.viewProgress')}</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel={t('settings.title')}
          hitSlop={8}
        >
          <Text style={styles.signOut}>⚙️</Text>
        </Pressable>
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
        ) : !isConfigured ? (
          // Distinct from the API-not-configured state above: the server is reachable, but
          // there is no Supabase project wired up yet to mint a token it would accept.
          <EmptyState emoji="🔐" title={t('coach.authNotConfigured')} hint={t('coach.authNotConfiguredHint')} />
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
          bubbles.map((bubble) => {
            if (bubble.kind === 'pending') {
              return (
                <View key={bubble.id} style={[styles.bubble, styles.bubbleCoach]}>
                  <ActivityIndicator color={colors.accent} />
                </View>
              );
            }

            if (bubble.kind === 'plan_proposal') {
              return (
                <View key={bubble.id} style={styles.proposalWrap}>
                  <WorkoutPlanCard
                    plan={bubble.plan}
                    applied={bubble.applied}
                    applying={bubble.applying}
                    onApply={() => {
                      if (!bubble.applied && !bubble.applying) applyPlan(bubble.id, bubble.plan);
                    }}
                  />
                </View>
              );
            }

            if (bubble.kind === 'nutrition_proposal') {
              return (
                <View key={bubble.id} style={styles.proposalWrap}>
                  <NutritionMenuCard menu={bubble.menu} />
                </View>
              );
            }

            return (
              <View
                key={bubble.id}
                style={[
                  styles.bubble,
                  bubble.role === 'user' ? styles.bubbleUser : styles.bubbleCoach,
                  bubble.interrupted ? styles.bubbleInterrupted : null,
                ]}
              >
                <Text style={styles.bubbleText}>{bubble.text}</Text>
                {bubble.interrupted ? (
                  <Text style={styles.interruptedNote}>{t('coach.cutShort')}</Text>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Hidden rather than merely disabled while signed out: showing a composer for a message
          that cannot be sent invites a tap that silently does nothing. */}
      {canChat ? (
        <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.md }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('coach.placeholder')}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            multiline
            editable={!streaming}
          />
          <Pressable
            onPress={send}
            disabled={streaming || draft.trim().length === 0}
            style={[
              styles.sendButton,
              (streaming || draft.trim().length === 0) && styles.sendButtonDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('coach.send')}
          >
            <Text style={styles.sendButtonText}>{isHebrew ? '↑' : '↑'}</Text>
          </Pressable>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    header: ViewStyle;
    title: TextStyle;
    viewProgress: TextStyle;
    signOut: TextStyle;
    thread: ViewStyle;
    threadContent: ViewStyle;
    bubble: ViewStyle;
    bubbleUser: ViewStyle;
    bubbleCoach: ViewStyle;
    bubbleInterrupted: ViewStyle;
    proposalWrap: ViewStyle;
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
  title: { flex: 1, color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  viewProgress: { color: colors.accent, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  signOut: { color: colors.textMuted, fontSize: fontSize.xs },
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
    borderColor: colors.borderSubtle,
  },
  bubbleInterrupted: { borderColor: colors.warning },
  // Full width rather than the 88% text bubbles use — a plan or menu card reads better without
  // wrapping its own multi-column rows a second time inside a narrow chat bubble.
  proposalWrap: { width: '100%' },
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
