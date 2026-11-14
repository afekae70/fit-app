/**
 * The coach's review of one week, at the top of the weekly summary.
 *
 * Asked for by the owner (2026-11-14): the weekly summary carries the AI coach's own summary of
 * the week, easy to read and explained — what went well and what did not, a few sentences each on
 * training, food, water and weight, and a tip for next week with its reason (`parseReview`) — and
 * the coach writes a new one by itself every Saturday at 19:00
 * (`autoWeekReview.ts`), so there is no button to press and no week showing last week's words.
 *
 * What it shows, for the week on screen:
 *  - the review written for it, line by line, the tip set apart;
 *  - while the week's review is being written, that it is;
 *  - in the week under way before Saturday 19:00, when it will be written;
 *  - if writing it failed (offline, the server down), why, and a way to try again.
 * A past week from before the coach wrote reviews shows nothing. Not offered under 18
 * (AI_MIN_AGE), nor where the coach cannot be reached at all.
 */

import { useFocusEffect } from 'expo-router';
import {
  ArrowsClockwise,
  Barbell,
  Drop,
  ForkKnife,
  Lightbulb,
  Scales,
  Sparkle,
  ThumbsUp,
  WarningCircle,
  type Icon,
} from 'phosphor-react-native';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider.js';
import { useCurrentUserId } from '../auth/CurrentUserProvider.js';
import {
  dueWeek,
  ensureDueWeekReview,
  REVIEW_HOUR,
  rewriteDueWeekReview,
} from '../coach/autoWeekReview.js';
import { coachFailureKey } from '../coach/failure.js';
import { useAiAge } from '../coach/useAiAge.js';
import { parseReview, weekReviewDays, type ReviewPart } from '../coach/weeklyReview.js';
import { API_BASE_URL } from '../config.js';
import { getWeeklyReviewBetween, type WeeklyReview } from '../db/coachBriefs.js';
import { getExecutor, newId } from '../db/provider.js';
import { hapticLight, hapticSuccess } from '../haptics.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, lineHeight, radius, spacing, type ColorPalette } from '../theme.js';
import { IconText } from './Glyph.js';
import { Pressable } from './Pressable.js';
import { ReportAiButton } from './ReportAiButton.js';
import { Text } from './Text.js';
import { Banner, Button, Hint } from './ui.js';

/** Each line of the review, with the picture that says what it is about before it is read. */
const PART_ICON: Record<Exclude<ReviewPart, 'tip' | 'good' | 'bad'>, Icon> = {
  training: Barbell,
  food: ForkKnife,
  water: Drop,
  weight: Scales,
};

type State =
  | { kind: 'loading' }
  | { kind: 'review'; review: WeeklyReview }
  | { kind: 'writing' }
  | { kind: 'waiting' }
  | { kind: 'failed'; message: string }
  | { kind: 'none' };

export function CoachWeekNote({
  start,
  end,
  isCurrent,
  onReview,
}: {
  start: string;
  end: string;
  isCurrent: boolean;
  /** Told the week's review once it is read or written, so the shared picture can carry it. */
  onReview?: (review: WeeklyReview | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useCurrentUserId();
  const { session } = useAuth();
  const aiAge = useAiAge();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const accessToken = session?.access_token ?? null;
  const canWrite = aiAge === 'adult' && API_BASE_URL !== null && accessToken !== null;
  const locale = i18n.language === 'he' ? 'he' : 'en';

  /**
   * Write the due week's review — this one, when it is the due week. `again` replaces the one
   * there is (the rewrite link under a review).
   */
  const write = useCallback(async (again = false) => {
    if (!API_BASE_URL || !accessToken) return;
    setState({ kind: 'writing' });
    const outcome = await (again ? rewriteDueWeekReview : ensureDueWeekReview)({
      db: await getExecutor(),
      userId,
      newId,
      locale,
      baseUrl: API_BASE_URL,
      accessToken,
    });
    if (outcome.kind === 'ready') {
      hapticSuccess();
      setState({ kind: 'review', review: outcome.review });
      onReview?.(outcome.review);
    } else {
      setState({ kind: 'failed', message: t(coachFailureKey(outcome.code) ?? 'coach.unavailable') });
    }
  }, [accessToken, userId, locale, onReview, t]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        // Written on the week's Saturday or the Sunday after: that week's review.
        const own = await getWeeklyReviewBetween(await getExecutor(), userId, ...weekReviewDays(end));
        if (cancelled) return;
        onReview?.(own);
        if (own) {
          setState({ kind: 'review', review: own });
        } else if (canWrite && dueWeek(new Date()).start === start) {
          void write();
        } else if (canWrite && isCurrent) {
          setState({ kind: 'waiting' });
        } else {
          setState({ kind: 'none' });
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [userId, start, end, isCurrent, canWrite, onReview, write]),
  );

  if (aiAge !== 'adult' || state.kind === 'loading' || state.kind === 'none') return null;

  /**
   * A review written in its five lines reads as five rows, each behind its icon, and the tip on
   * its own, set apart: the one line meant to be acted on. One written any other way — before the
   * lines existed — is shown whole.
   */
  const renderReview = (text: string) => {
    const parts = parseReview(text);
    if (!parts) return <Text style={styles.text}>{text}</Text>;
    return (
      <View style={styles.parts}>
        {/* The week's best and worst first, each in its own box: the two things to read even
            if nothing else is. */}
        {parts.good ? (
          <View style={[styles.verdict, styles.good]}>
            <ThumbsUp size={18} color={colors.accent} weight="fill" />
            <View style={styles.partText}>
              <Text style={[styles.partLabel, { color: colors.accent }]}>
                {t('weekSummary.part_good')}
              </Text>
              <Text style={styles.partLine}>{parts.good}</Text>
            </View>
          </View>
        ) : null}
        {parts.bad ? (
          <View style={[styles.verdict, styles.bad]}>
            <WarningCircle size={18} color={colors.warning} weight="fill" />
            <View style={styles.partText}>
              <Text style={[styles.partLabel, { color: colors.warning }]}>
                {t('weekSummary.part_bad')}
              </Text>
              <Text style={styles.partLine}>{parts.bad}</Text>
            </View>
          </View>
        ) : null}
        {(Object.keys(PART_ICON) as (keyof typeof PART_ICON)[]).map((part) => {
          const line = parts[part];
          if (!line) return null;
          const PartIcon = PART_ICON[part];
          return (
            <View key={part} style={styles.part}>
              <PartIcon size={18} color={colors.accent} weight="bold" />
              <View style={styles.partText}>
                <Text style={styles.partLabel}>{t(`weekSummary.part_${part}`)}</Text>
                <Text style={styles.partLine}>{line}</Text>
              </View>
            </View>
          );
        })}
        {parts.tip ? (
          <View style={styles.tip}>
            <Lightbulb size={18} color={colors.bg} weight="fill" />
            <View style={styles.partText}>
              <Text style={styles.tipLabel}>{t('weekSummary.part_tip')}</Text>
              <Text style={styles.tipLine}>{parts.tip}</Text>
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Sparkle size={16} color={colors.accent} weight="fill" />
        <Text style={styles.title}>{t('weekSummary.coachTitle')}</Text>
      </View>

      {state.kind === 'review' ? (
        <>
          {renderReview(state.review.text)}
          <View style={styles.footer}>
            <ReportAiButton kind="weekly_review" text={state.review.text} />
            {/* Only for the week a review is written for: the due one. */}
            {canWrite && dueWeek(new Date()).start === start ? (
              <Pressable
                onPress={() => {
                  hapticLight();
                  void write(true);
                }}
                accessibilityRole="button"
                hitSlop={8}
                style={({ pressed }) => [styles.rewrite, pressed && styles.pressed]}
              >
                <IconText icon={ArrowsClockwise} style={styles.rewriteText}>
                  {t('weekSummary.rewrite')}
                </IconText>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : state.kind === 'writing' ? (
        <View style={styles.asking}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.askingText}>{t('coach.weekly.asking')}</Text>
        </View>
      ) : state.kind === 'waiting' ? (
        <Hint>{t('weekSummary.coachComing', { hour: `${REVIEW_HOUR}:00` })}</Hint>
      ) : (
        <>
          <Banner tone="warning">{state.message}</Banner>
          <Button label={t('common.retry')} variant="secondary" onPress={() => void write(false)} />
        </>
      )}
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create({
    card: {
      gap: spacing.sm,
      padding: spacing.lg,
      borderRadius: radius.lg,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.accentBorder,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    title: { color: colors.accent, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
    text: {
      color: colors.text,
      fontSize: fontSize.md,
      lineHeight: lineHeight.relaxed,
      textAlign: 'auto',
    },
    asking: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
    askingText: { color: colors.textMuted, fontSize: fontSize.sm },
    parts: { gap: spacing.md },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    rewrite: { minHeight: 44, justifyContent: 'center' },
    rewriteText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
    pressed: { opacity: 0.6 },
    verdict: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
    },
    good: { backgroundColor: colors.surface, borderColor: colors.accentBorder },
    bad: { backgroundColor: colors.surface, borderColor: colors.warning },
    part: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    partText: { flex: 1, gap: 1 },
    partLabel: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: fontWeight.bold, textAlign: 'auto' },
    partLine: { color: colors.text, fontSize: fontSize.md, lineHeight: lineHeight.relaxed, textAlign: 'auto' },
    // The tip on the accent itself: the one line on the screen meant to be acted on.
    tip: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.accent,
    },
    tipLabel: {
      color: colors.bg,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
      opacity: 0.85,
    },
    tipLine: {
      color: colors.bg,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      lineHeight: lineHeight.relaxed,
      textAlign: 'auto',
    },
  });
