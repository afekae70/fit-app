/**
 * Profile — reached from the home avatar, not from the tab bar, exactly as the handoff specifies.
 * Identity at the top, three lifetime numbers, then settings.
 *
 * It also carries a "more" group the handoff does not describe, and that is a deliberate
 * addition rather than an oversight. The design's five tabs are the five things done while
 * training; nutrition targets, body metrics and the AI coach are all real, built features that
 * the new tab bar displaces. Deleting working features to match a screen list would be the wrong
 * reading of "implement the design" — so they keep a door, one tap from the avatar, and the tab
 * bar stays as sparse as it was drawn.
 */

import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretLeft, CaretRight } from 'phosphor-react-native';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { I18nManager } from 'react-native';

import { useAuth } from '../src/auth/AuthProvider.js';
import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import { getExecutor } from '../src/db/provider.js';
import { getLatestWeight } from '../src/db/metrics.js';
import { getWorkoutStreak } from '../src/db/workouts.js';
import { personalRecords } from '../src/db/progression.js';
import { useTheme } from '../src/ThemeProvider.js';
import { radius, type ColorPalette } from '../src/theme.js';

const WEEKLY_TARGET = 4;

export default function ProfileScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const userId = useCurrentUserId();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [totals, setTotals] = useState({ workouts: 0, streakWeeks: 0, prs: 0 });
  const [weightKg, setWeightKg] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const db = await getExecutor();
        const [count, streak, prs, weight] = await Promise.all([
          db.get<{ n: number }>(
            `SELECT COUNT(*) AS n FROM workout_sessions
              WHERE user_id = ? AND deleted_at IS NULL AND ended_at IS NOT NULL`,
            [userId],
          ),
          getWorkoutStreak(db, userId),
          personalRecords(db, userId),
          getLatestWeight(db, userId),
        ]);
        setTotals({
          workouts: count?.n ?? 0,
          streakWeeks: Math.floor(streak.currentDays / 7),
          prs: prs.length,
        });
        setWeightKg(weight?.weight_kg ?? null);
      })();
    }, [userId]),
  );

  const email = session?.user.email ?? '';
  const name = email.split('@')[0] ?? '';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 28 },
      ]}
    >
      <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8} style={styles.back}>
        {/* Directional, so it mirrors. Non-directional glyphs elsewhere deliberately do not. */}
        {I18nManager.isRTL ? (
          <CaretRight size={20} color={colors.text} />
        ) : (
          <CaretLeft size={20} color={colors.text} />
        )}
      </Pressable>

      <View style={styles.identity}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initialsFor(email)}</Text>
        </View>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.subtitle}>
          {t('profileScreen.trainsPerWeek', { count: WEEKLY_TARGET })}
          {weightKg !== null ? ` · ${weightKg} ${t('units.kg')}` : ''}
        </Text>
      </View>

      <View style={styles.statRow}>
        <Stat value={totals.workouts} label={t('profileScreen.statWorkouts')} />
        <Stat value={totals.streakWeeks} label={t('profileScreen.statStreak')} />
        <Stat value={totals.prs} label={t('profileScreen.statPrs')} />
      </View>

      <View style={styles.group}>
        <Row label={t('profileScreen.nutrition')} onPress={() => router.push('/nutrition')} />
        <View style={styles.rowDivider} />
        <Row label={t('profileScreen.metrics')} onPress={() => router.push('/metrics')} />
        <View style={styles.rowDivider} />
        <Row label={t('profileScreen.coach')} onPress={() => router.push('/coach')} />
        <View style={styles.rowDivider} />
        <Row label={t('profileScreen.settings')} onPress={() => router.push('/settings')} />
      </View>
    </ScrollView>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Row({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      {I18nManager.isRTL ? (
        <CaretLeft size={15} color={colors.textFaint} />
      ) : (
        <CaretRight size={15} color={colors.textFaint} />
      )}
    </Pressable>
  );
}

function initialsFor(email: string): string {
  const letters = (email.split('@')[0] ?? '').replace(/[^\p{L}]/gu, '');
  return letters.slice(0, 2).toUpperCase() || '·';
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    back: ViewStyle;
    identity: ViewStyle;
    avatar: ViewStyle;
    avatarText: TextStyle;
    name: TextStyle;
    subtitle: TextStyle;
    statRow: ViewStyle;
    statCard: ViewStyle;
    statValue: TextStyle;
    statLabel: TextStyle;
    group: ViewStyle;
    row: ViewStyle;
    rowPressed: ViewStyle;
    rowLabel: TextStyle;
    rowDivider: ViewStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: 20, gap: 18 },
    back: { alignSelf: 'flex-start' },

    identity: { alignItems: 'center', gap: 8 },
    avatar: {
      width: 60,
      height: 60,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: colors.accent, fontSize: 20, fontWeight: '500' },
    name: { color: colors.text, fontSize: 20, fontWeight: '500' },
    subtitle: { color: colors.textMuted, fontSize: 13 },

    statRow: { flexDirection: 'row', gap: 10 },
    statCard: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      paddingVertical: 14,
      paddingHorizontal: 12,
      gap: 4,
    },
    statValue: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '500',
      textAlign: 'auto',
      fontVariant: ['tabular-nums'],
    },
    statLabel: { color: colors.textFaint, fontSize: 11, textAlign: 'auto' },

    group: {
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      overflow: 'hidden',
    },
    row: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
    },
    rowPressed: { backgroundColor: colors.surfaceRaised },
    rowLabel: { color: colors.text, fontSize: 15, textAlign: 'auto' },
    rowDivider: { height: 1, backgroundColor: colors.borderSubtle },
  });
