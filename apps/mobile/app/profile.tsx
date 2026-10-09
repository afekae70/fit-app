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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretLeft, CaretRight } from 'phosphor-react-native';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { I18nManager } from 'react-native';

import { useAuth } from '../src/auth/AuthProvider.js';
import { useAccountRole } from '../src/coaching/useAccountRole.js';
import { useActionSheet } from '../src/components/ActionSheetProvider.js';
import { RoleBadge } from '../src/components/RoleBadge.js';
import { loadAvatar, pickAvatar, removeAvatar } from '../src/profile/avatar.js';
import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import { useUnit } from '../src/UnitsProvider.js';
import { formatBodyWeight, weightUnitKey } from '../src/units.js';
import { getExecutor } from '../src/db/provider.js';
import { getLatestWeight } from '../src/db/metrics.js';
import { getWorkoutStreak } from '../src/db/workouts.js';
import { personalRecords } from '../src/db/progression.js';
import { useTheme } from '../src/ThemeProvider.js';
import { radius, shadow, type ColorPalette } from '../src/theme.js';

const WEEKLY_TARGET = 4;

export default function ProfileScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const userId = useCurrentUserId();
  const unit = useUnit();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [totals, setTotals] = useState({ workouts: 0, streakWeeks: 0, prs: 0 });
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const { ask, notify } = useActionSheet();
  const role = useAccountRole(userId);

  useEffect(() => {
    void loadAvatar(userId).then(setAvatarUri);
  }, [userId]);

  /** Tap the picture: choose one, or with one already set, replace or remove it. */
  const changeAvatar = () => {
    void (async () => {
      if (avatarUri) {
        const choice = await ask({
          title: t('profileScreen.photo'),
          actions: [
            { label: t('profileScreen.changePhoto') },
            { label: t('profileScreen.removePhoto'), destructive: true },
          ],
        });
        if (choice === 1) {
          await removeAvatar(userId);
          setAvatarUri(null);
          return;
        }
        if (choice !== 0) return;
      }
      try {
        const uri = await pickAvatar(userId);
        if (uri) setAvatarUri(uri);
      } catch {
        await notify({ message: t('profileScreen.photoFailed') });
      }
    })();
  };

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
        { paddingTop: 8, paddingBottom: insets.bottom + 28 },
      ]}
    >
      <View style={styles.identity}>
        <Pressable
          onPress={changeAvatar}
          accessibilityRole="button"
          accessibilityLabel={t('profileScreen.photo')}
          style={({ pressed }) => [styles.avatar, pressed && styles.rowPressed]}
        >
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{initialsFor(email)}</Text>
          )}
          {/* A small camera badge, so the picture reads as something that can be changed. */}
          <View style={styles.avatarBadge}>
            <Text style={styles.avatarBadgeGlyph}>📷</Text>
          </View>
        </Pressable>
        <Text style={styles.name}>{name}</Text>
        {/* Under the name, where a title would go: whether this account is a trainee or one
            the owner has made a coach. Nothing until it is known. */}
        <RoleBadge role={role} />
        <Text style={styles.subtitle}>
          {t('profileScreen.trainsPerWeek', { count: WEEKLY_TARGET })}
          {weightKg !== null
            ? ` · ${formatBodyWeight(weightKg, unit)} ${t(`common.${weightUnitKey(unit)}`)}`
            : ''}
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
    topRow: ViewStyle;
    back: ViewStyle;
    identity: ViewStyle;
    avatar: ViewStyle;
    avatarText: TextStyle;
    avatarImage: ImageStyle;
    avatarBadge: ViewStyle;
    avatarBadgeGlyph: TextStyle;
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
    topRow: { flexDirection: 'row', alignItems: 'center' },
    back: { alignSelf: 'flex-start' },

    identity: { alignItems: 'center', gap: 8 },
    avatar: {
      width: 88,
      height: 88,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: colors.accent, fontSize: 26, fontWeight: '500' },
    avatarImage: { width: '100%', height: '100%', borderRadius: radius.pill },
    avatarBadge: {
      position: 'absolute',
      bottom: -2,
      end: -2,
      width: 28,
      height: 28,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarBadgeGlyph: { fontSize: 13 },
    name: { color: colors.text, fontSize: 20, fontWeight: '500' },
    subtitle: { color: colors.textMuted, fontSize: 13 },

    statRow: { flexDirection: 'row', gap: 10 },
    statCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      ...shadow(colors.shadow).card,
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
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      ...shadow(colors.shadow).card,
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
