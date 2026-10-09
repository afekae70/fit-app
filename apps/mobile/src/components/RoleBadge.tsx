/**
 * The word that says what kind of account this is: trainee, or coach — and, beside it, manager
 * for the owner.
 *
 * A small pill in the accent's soft tone, the way the app marks anything that is a fact about
 * the user rather than something to press. A coach's is filled, because it is the one that
 * means the account can do something others cannot; a trainee's is an outline.
 *
 * Draws nothing until the role is known. See `useAccountRole` for why it does not guess.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { ChalkboardTeacher, IdentificationBadge, PersonSimpleRun } from 'phosphor-react-native';

import type { AccountRole } from '../coaching/accountRole.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';

export function RoleBadge({
  role,
  style,
}: {
  role: AccountRole | null;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (!role) return null;
  const coach = role.role === 'coach';
  const RoleIcon = coach ? ChalkboardTeacher : PersonSimpleRun;

  return (
    <View style={[styles.row, style]}>
      <View style={[styles.pill, coach && styles.pillCoach]}>
        <RoleIcon size={13} color={coach ? colors.bg : colors.accent} weight="bold" />
        <Text style={[styles.label, coach && styles.labelCoach]}>
          {t(coach ? 'coaching.roleCoach' : 'coaching.roleTrainee')}
        </Text>
      </View>
      {role.isAdmin ? (
        <View style={styles.pill}>
          <IdentificationBadge size={13} color={colors.accent} weight="bold" />
          <Text style={styles.label}>{t('coaching.roleAdmin')}</Text>
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    row: ViewStyle;
    pill: ViewStyle;
    pillCoach: ViewStyle;
    label: TextStyle;
    labelCoach: TextStyle;
  }>({
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingVertical: 3,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.accentBorder,
      backgroundColor: colors.accentSoft,
    },
    pillCoach: { backgroundColor: colors.accent, borderColor: colors.accent },
    label: { color: colors.accent, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
    labelCoach: { color: colors.bg },
  });
