/**
 * The coach's weekly review, on the Progress screen: the last one written, and a button to ask
 * for the next once a week has passed.
 *
 * The button is the only thing that sends anything. Opening the screen reads what is already
 * on the phone and nothing more — see `coach/weeklyReview.ts` for why this one is asked for
 * rather than fetched, and the line under the button says what pressing it sends.
 *
 * It draws nothing at all for someone who cannot ask and has nothing to show: no account, no
 * server, and no review from before. An empty card promising a feature that is not there is
 * worse than no card.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider.js';
import { useCurrentUserId } from '../auth/CurrentUserProvider.js';
import { coachFailureKey } from '../coach/failure.js';
import { nextReviewOn, requestWeeklyReview } from '../coach/weeklyReview.js';
import { API_BASE_URL } from '../config.js';
import { getLatestWeeklyReview, type WeeklyReview } from '../db/coachBriefs.js';
import { getExecutor, newId } from '../db/provider.js';
import { localDate, parseLocalDate } from '../db/schedule.js';
import { hapticLight, hapticSuccess } from '../haptics.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, lineHeight, spacing, type ColorPalette } from '../theme.js';
import { Text } from './Text.js';
import { Banner, Button, Card, Hint, SectionTitle } from './ui.js';

export function WeeklyReviewCard({ index }: { index?: number }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useCurrentUserId();
  const { session } = useAuth();

  const [review, setReview] = useState<WeeklyReview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const latest = await getLatestWeeklyReview(await getExecutor(), userId);
        if (cancelled) return;
        setReview(latest);
        setLoaded(true);
      })();
      return () => {
        cancelled = true;
      };
    }, [userId]),
  );

  const accessToken = session?.access_token ?? null;
  const canAsk = API_BASE_URL !== null && accessToken !== null;
  if (!loaded || (!canAsk && !review)) return null;

  const today = localDate(new Date());
  const waitUntil = nextReviewOn(review, today);
  const day = (date: string) =>
    parseLocalDate(date).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long' });

  const ask = () => {
    if (asking || !API_BASE_URL || !accessToken) return;
    hapticLight();
    setAsking(true);
    setProblem(null);
    void (async () => {
      const outcome = await requestWeeklyReview({
        db: await getExecutor(),
        userId,
        newId,
        locale: i18n.language === 'he' ? 'he' : 'en',
        baseUrl: API_BASE_URL,
        accessToken,
      });
      if (outcome.ok) {
        hapticSuccess();
        setReview(outcome.review);
      } else {
        // Said in the person's language when the cause is known; the fallback is the same
        // sentence the chat falls back on, not the server's English.
        console.warn('[coach] weekly review failed:', outcome.message, outcome.code ?? '');
        setProblem(t(coachFailureKey(outcome.code) ?? 'coach.unavailable'));
      }
      setAsking(false);
    })();
  };

  return (
    <Card index={index}>
      <SectionTitle>{t('coach.weekly.title')}</SectionTitle>

      {review ? (
        <View style={styles.body}>
          <Text style={styles.text}>{review.text}</Text>
          <Hint>{t('coach.weekly.writtenOn', { date: day(review.writtenOn) })}</Hint>
        </View>
      ) : null}

      {asking ? (
        <View style={styles.asking}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.askingText}>{t('coach.weekly.asking')}</Text>
        </View>
      ) : waitUntil !== null ? (
        <Hint>{t('coach.weekly.nextOn', { date: day(waitUntil) })}</Hint>
      ) : canAsk ? (
        <View style={styles.body}>
          <Button
            label={review ? t('coach.weekly.askAgain') : t('coach.weekly.ask')}
            variant={review ? 'secondary' : 'primary'}
            onPress={ask}
          />
          <Hint>{t('coach.weekly.hint')}</Hint>
        </View>
      ) : null}

      {problem ? <Banner tone="warning">{problem}</Banner> : null}
    </Card>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create({
    body: { gap: spacing.sm },
    text: {
      color: colors.text,
      fontSize: fontSize.md,
      lineHeight: lineHeight.relaxed,
      textAlign: 'auto',
    },
    asking: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm,
    },
    askingText: { color: colors.textMuted, fontSize: fontSize.sm },
  });
