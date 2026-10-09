/**
 * Coaching: who trains you, whom you train — and, for the owner, who is a coach at all.
 *
 * Up to three sections, and most people see one:
 *
 *  - **My coach** — everyone. Type the code a coach gave you and they can see and change your
 *    training plans: the groups, the workouts in them, the exercises and their sets and reps.
 *    Nothing else of yours. Leaving ends it at once.
 *  - **My trainees** — coaches only. Your code, to hand out, and everyone who has entered it.
 *    Tapping one opens their plans.
 *  - **Manage coaches** — administrators only. Who is a coach is the owner's decision: an
 *    account becomes one when it is named here, by the email it signed up with, and stops
 *    being one the same way. Nobody can make themselves a coach.
 *
 * What is shown follows what the server says the account is, and that is only a matter of not
 * showing people controls that would refuse them: every call is checked again on the server,
 * whatever this screen believes. See 0007 and 0008 in apps/api/drizzle.
 *
 * The link between a coach and a trainee is made by the trainee and by nobody else. There is no
 * way to add somebody to your list, only for them to add themselves.
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
import {
  EnvelopeSimple,
  Handshake,
  IdentificationBadge,
  ShareNetwork,
  UserMinus,
  UsersThree,
} from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  CODE_LENGTH,
  normaliseCode,
  personLabel,
  type AppointedCoach,
  type CoachingError,
  type CoachingStatus,
} from '../src/coaching/api.js';
import { coachingErrorKey, useCoachingApi } from '../src/coaching/useCoachingApi.js';
import { useActionSheet } from '../src/components/ActionSheetProvider.js';
import { BrandButton } from '../src/components/BrandButton.js';
import { Field } from '../src/components/Field.js';
import { KeyboardSafe } from '../src/components/KeyboardSafe.js';
import { LinkRow, RowDivider, SettingsSection } from '../src/components/settings/kit.js';
import { Banner, ScreenHeader } from '../src/components/ui.js';
import { hapticSuccess } from '../src/haptics.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../src/theme.js';

/** Which change is in flight. A spinner belongs on the button that was pressed. */
type Pending = 'join' | 'leave' | 'appoint' | 'dismiss' | null;

export default function CoachingScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const api = useCoachingApi();
  const { confirm } = useActionSheet();

  const [status, setStatus] = useState<CoachingStatus | null>(null);
  const [coaches, setCoaches] = useState<AppointedCoach[] | null>(null);
  const [error, setError] = useState<CoachingError | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Pending>(null);
  const busy = pending !== null;
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');

  const load = useCallback(async () => {
    if (!api) {
      setError('not_available');
      setLoading(false);
      return;
    }
    const result = await api.status();
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStatus(result.value);
    setError(null);

    // The list of coaches is asked for only by an account the server has just said may see
    // it. Anyone else asking would be refused, and there is no reason to find that out.
    if (result.value.isAdmin) {
      const list = await api.coaches();
      if (list.ok) setCoaches(list.value);
    } else {
      setCoaches(null);
    }
  }, [api]);

  // On every return to the screen, not once: a trainee may have joined, or left, while this
  // phone was showing something else.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Run one change, show what went wrong if it did, and read everything again either way. */
  const run = async (
    action: Exclude<Pending, null>,
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
    if (await run('join', () => api.join(code))) {
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

  const appoint = async () => {
    const address = email.trim();
    if (!api || address === '') return;
    if (await run('appoint', () => api.setCoach(address, true))) {
      hapticSuccess();
      setEmail('');
    }
  };

  const dismiss = async (coach: AppointedCoach) => {
    if (!api) return;
    const sure = await confirm({
      title: t('coaching.dismissCoachTitle'),
      message: t('coaching.dismissCoachBody', { name: personLabel(coach), count: coach.trainees }),
      confirmLabel: t('coaching.dismissCoach'),
    });
    if (sure) await run('dismiss', () => api.setCoach(coach.email, false));
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

            {/* Only for someone the owner has made a coach. A trainee has no code to hand out
                and nobody to list, and a section that could only ever be empty is one that
                invites the question of how to fill it. */}
            {isCoach ? (
              <SettingsSection
                icon={UsersThree}
                title={t('coaching.myTrainees')}
                hint={t('coaching.myTraineesHint')}
                index={2}
              >
                {status.code ? (
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
                ) : null}

                <RowDivider />
                {status.trainees.length === 0 ? (
                  <Text style={styles.note}>{t('coaching.noTrainees')}</Text>
                ) : (
                  status.trainees.map((trainee, index) => (
                    <View key={trainee.id} style={styles.rows}>
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
              </SettingsSection>
            ) : null}

            {status.isAdmin ? (
              <SettingsSection
                icon={IdentificationBadge}
                title={t('coaching.manageCoaches')}
                hint={t('coaching.manageCoachesHint')}
                index={3}
              >
                <Field
                  icon={EnvelopeSimple}
                  value={email}
                  onChangeText={setEmail}
                  placeholder={t('coaching.coachEmailPlaceholder')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  editable={!busy}
                  onSubmitEditing={() => void appoint()}
                />
                <BrandButton
                  label={t('coaching.appoint')}
                  onPress={() => void appoint()}
                  disabled={email.trim() === '' || (busy && pending !== 'appoint')}
                  busy={pending === 'appoint'}
                />

                <RowDivider />
                {coaches === null || coaches.length === 0 ? (
                  <Text style={styles.note}>{t('coaching.noCoaches')}</Text>
                ) : (
                  coaches.map((coach, index) => (
                    <View key={coach.id} style={styles.rows}>
                      {index > 0 ? <RowDivider /> : null}
                      <View style={styles.coachRow}>
                        <View style={styles.coachText}>
                          <Text style={styles.coachEmail} numberOfLines={1}>
                            {coach.email}
                          </Text>
                          <Text style={styles.note}>
                            {t('coaching.coachSummary', {
                              code: coach.code ?? '—',
                              count: coach.trainees,
                            })}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => void dismiss(coach)}
                          disabled={busy}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`${t('coaching.dismissCoach')} ${coach.email}`}
                          style={({ pressed }) => [
                            styles.dismiss,
                            (pressed || busy) && styles.pressed,
                          ]}
                        >
                          <UserMinus size={18} color={colors.danger} />
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}
              </SettingsSection>
            ) : null}
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
    rows: ViewStyle;
    coachRow: ViewStyle;
    coachText: ViewStyle;
    coachEmail: TextStyle;
    dismiss: ViewStyle;
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
    rows: { gap: spacing.md },

    coachRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
    coachText: { flex: 1, gap: spacing.xxs },
    coachEmail: {
      color: colors.text,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      textAlign: 'auto',
    },
    dismiss: {
      width: 38,
      height: 38,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.dangerSoft,
    },
  });
