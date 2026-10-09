/**
 * Coaching: who trains you, and whom you train.
 *
 * One screen for both sides, because they are the same relationship seen from either end and a
 * coach is usually somebody's trainee as well.
 *
 *  - **My coach.** Type the code a coach gave you and they can see and change your training
 *    plans — the groups, the workouts in them, the exercises and their sets and reps. Nothing
 *    else of yours. Leaving ends it at once.
 *  - **My trainees.** Switch coach mode on and you get a code to hand out. Everyone who enters
 *    it appears here; tapping one opens their plans.
 *
 * The link is made by the trainee and by nobody else: there is no way to add somebody to your
 * list, only for them to add themselves. That is deliberate — see 0007_coaching.sql.
 *
 * This screen needs the network and says so plainly when it has none. Nothing here is kept in
 * the local database: a link someone has ended must stop working the moment they end it, and a
 * cached copy of "who coaches whom" is exactly the thing that would not.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Handshake, ShareNetwork, UsersThree } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  CODE_LENGTH,
  normaliseCode,
  personLabel,
  type CoachingError,
  type CoachingStatus,
} from '../src/coaching/api.js';
import { coachingErrorKey, useCoachingApi } from '../src/coaching/useCoachingApi.js';
import { useActionSheet } from '../src/components/ActionSheetProvider.js';
import { BrandButton } from '../src/components/BrandButton.js';
import { Field } from '../src/components/Field.js';
import { KeyboardSafe } from '../src/components/KeyboardSafe.js';
import { LinkRow, RowDivider, SettingsSection, ToggleRow } from '../src/components/settings/kit.js';
import { Banner, ScreenHeader } from '../src/components/ui.js';
import { hapticSuccess } from '../src/haptics.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../src/theme.js';

export default function CoachingScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const api = useCoachingApi();
  const { confirm } = useActionSheet();

  const [status, setStatus] = useState<CoachingStatus | null>(null);
  const [error, setError] = useState<CoachingError | null>(null);
  const [loading, setLoading] = useState(true);
  // Which change is in flight, if any. Named rather than a plain flag: a spinner belongs on
  // the button that was pressed, and one flag for the screen put it on a different one —
  // switching coach mode on made "connect to coach" look as if it were connecting.
  const [pending, setPending] = useState<'join' | 'leave' | 'mode' | null>(null);
  const busy = pending !== null;
  const [code, setCode] = useState('');

  const load = useCallback(async () => {
    if (!api) {
      setError('not_available');
      setLoading(false);
      return;
    }
    const result = await api.status();
    setLoading(false);
    if (result.ok) {
      setStatus(result.value);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [api]);

  // On every return to the screen, not once: a trainee may have joined, or left, while this
  // phone was showing something else.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Run one change, show what went wrong if it did, and read the status again either way. */
  const run = async (
    action: 'join' | 'leave' | 'mode',
    change: () => Promise<{ ok: boolean; error?: CoachingError }>,
  ) => {
    if (busy) return false;
    setPending(action);
    setError(null);
    const result = await change();
    if (!result.ok && result.error) setError(result.error);
    await load();
    setPending(null);
    return result.ok;
  };

  const join = async () => {
    if (!api) return;
    const joined = await run('join', () => api.join(code));
    if (joined) {
      hapticSuccess();
      setCode('');
    }
  };

  const leave = async () => {
    if (!api || !status?.coach) return;
    const sure = await confirm({
      title: t('coaching.leaveTitle'),
      message: t('coaching.leaveBody', { name: personLabel(status.coach) }),
      confirmLabel: t('coaching.leave'),
    });
    if (sure) await run('leave', () => api.leave());
  };

  const setCoachMode = async (on: boolean) => {
    if (!api) return;
    if (on) {
      await run('mode', () => api.enable());
      return;
    }
    // Switching it off lets every trainee go, which is worth a question when there are any.
    const count = status?.trainees.length ?? 0;
    if (count > 0) {
      const sure = await confirm({
        title: t('coaching.coachModeOffTitle'),
        message: t('coaching.coachModeOffBody', { count }),
        confirmLabel: t('coaching.coachModeOff'),
      });
      if (!sure) return;
    }
    await run('mode', () => api.disable());
  };

  const shareCode = () => {
    if (!status?.code) return;
    void Share.share({ message: t('coaching.shareMessage', { code: status.code }) }).catch(
      () => undefined,
    );
  };

  const typed = normaliseCode(code);
  const isCoach = status?.role === 'coach';

  return (
    <KeyboardSafe>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title={t('coaching.title')} />

        {error ? (
          <Banner tone={error === 'not_available' || error === 'offline' ? 'info' : 'warning'}>
            {t(coachingErrorKey(error))}
          </Banner>
        ) : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : null}

        {status ? (
          <>
            <SettingsSection
              icon={Handshake}
              title={t('coaching.myCoach')}
              hint={status.coach ? undefined : t('coaching.myCoachHint')}
              index={1}
            >
              {status.coach ? (
                <>
                  <View style={styles.person}>
                    <Text style={styles.personName}>{personLabel(status.coach)}</Text>
                    <Text style={styles.personDetail}>{status.coach.email}</Text>
                  </View>
                  <Text style={styles.note}>{t('coaching.coachCanSee')}</Text>
                  <RowDivider />
                  <LinkRow
                    label={t('coaching.leave')}
                    tone="danger"
                    onPress={() => void leave()}
                    disabled={busy}
                    chevron={false}
                  />
                </>
              ) : (
                <>
                  <Field
                    value={code}
                    onChangeText={(next) => setCode(normaliseCode(next).slice(0, CODE_LENGTH))}
                    placeholder={t('coaching.codePlaceholder')}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={CODE_LENGTH}
                    editable={!busy}
                    onSubmitEditing={() => void join()}
                    // Set wide once there is a code in it. The placeholder is a phrase, and
                    // a phrase tracked out like a code reads as letters, not words.
                    inputStyle={code === '' ? styles.codePlaceholder : styles.codeInput}
                  />
                  <BrandButton
                    label={t('coaching.join')}
                    onPress={() => void join()}
                    disabled={typed.length !== CODE_LENGTH || (busy && pending !== 'join')}
                    busy={pending === 'join'}
                  />
                </>
              )}
            </SettingsSection>

            <SettingsSection
              icon={UsersThree}
              title={t('coaching.myTrainees')}
              hint={t('coaching.myTraineesHint')}
              index={2}
            >
              <ToggleRow
                label={t('coaching.coachMode')}
                value={isCoach}
                onChange={(next) => void setCoachMode(next)}
                disabled={busy}
              />

              {isCoach && status.code ? (
                <>
                  <RowDivider />
                  <View style={styles.codeBlock}>
                    <Text style={styles.codeLabel}>{t('coaching.yourCode')}</Text>
                    {/* A code is read one character at a time and typed on another phone:
                        always left to right, always set wide. */}
                    <Text style={styles.code} selectable>
                      {status.code}
                    </Text>
                    <Pressable
                      onPress={shareCode}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.share, pressed && styles.pressed]}
                    >
                      <ShareNetwork size={16} color={colors.accent} />
                      <Text style={styles.shareText}>{t('coaching.shareCode')}</Text>
                    </Pressable>
                  </View>

                  <RowDivider />
                  {status.trainees.length === 0 ? (
                    <Text style={styles.note}>{t('coaching.noTrainees')}</Text>
                  ) : (
                    status.trainees.map((trainee, index) => (
                      <View key={trainee.id} style={styles.traineeRow}>
                        {index > 0 ? <RowDivider /> : null}
                        <LinkRow
                          label={personLabel(trainee)}
                          hint={trainee.email}
                          onPress={() =>
                            router.push({
                              pathname: '/trainee/[id]',
                              params: { id: trainee.id, name: personLabel(trainee) },
                            })
                          }
                        />
                      </View>
                    ))
                  )}
                </>
              ) : null}
            </SettingsSection>
          </>
        ) : null}
      </ScrollView>
    </KeyboardSafe>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    loading: ViewStyle;
    person: ViewStyle;
    personName: TextStyle;
    personDetail: TextStyle;
    note: TextStyle;
    codeInput: TextStyle;
    codePlaceholder: TextStyle;
    codeBlock: ViewStyle;
    codeLabel: TextStyle;
    code: TextStyle;
    share: ViewStyle;
    shareText: TextStyle;
    pressed: ViewStyle;
    traineeRow: ViewStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
    loading: { paddingVertical: spacing.xxl, alignItems: 'center' },

    person: { gap: spacing.xxs },
    personName: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    personDetail: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'auto' },
    note: { color: colors.textMuted, fontSize: fontSize.xs, lineHeight: 18, textAlign: 'auto' },

    codeInput: {
      textAlign: 'center',
      fontSize: fontSize.xl,
      fontWeight: fontWeight.bold,
      letterSpacing: 6,
      writingDirection: 'ltr',
    },
    codePlaceholder: { textAlign: 'center' },
    codeBlock: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
    codeLabel: { color: colors.textMuted, fontSize: fontSize.xs },
    code: {
      color: colors.accent,
      fontSize: 34,
      fontWeight: fontWeight.bold,
      letterSpacing: 8,
      writingDirection: 'ltr',
      fontVariant: ['tabular-nums'],
    },
    share: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
    },
    shareText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
    pressed: { opacity: 0.6 },
    traineeRow: { gap: spacing.md },
  });
