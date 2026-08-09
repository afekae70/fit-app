/**
 * End-of-workout summary, shown when finishing.
 *
 * This replaces the live elapsed timer. A ticking clock during a workout adds pressure to
 * every set and encourages rushing rest periods — but the total duration is genuinely useful
 * once you are done, so it moves here rather than disappearing.
 *
 * The name field sits in this sheet because finishing is the moment the user actually knows
 * what the session was. Asking up front would mean naming something not yet done.
 *
 * The celebration on open (trophy pop, staggered tiles, counting numbers) is the one place in
 * the app that goes past "polished" into "fun" — finishing a workout is the one moment that
 * earns it. Every animated value here stays on a single driver mode for its whole life: the
 * trophy's scale/rotate are native-driven throughout, the tiles' fade/rise are native-driven
 * throughout, and the count-up numbers are plain JS state (not an Animated-driven style at
 * all) — see ui.tsx's SegmentButton for why mixing driver modes on one node is a hard crash,
 * not just a warning.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '../ThemeProvider.js';
import { hapticSuccess } from '../haptics.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import { Banner, Button } from './ui.js';

export interface FinishSummaryProps {
  visible: boolean;
  durationMinutes: number;
  exerciseCount: number;
  setCount: number;
  volumeKg: number;
  initialName: string | null;
  /** Watch import is only offered when a native health provider is actually available. */
  watchAvailable?: boolean;
  onConfirm: (name: string | null) => void;
  onCancel: () => void;
  onImportFromWatch?: () => void;
}

function formatDuration(minutes: number, hoursLabel: string, minutesLabel: string): string {
  if (minutes < 60) return `${minutes} ${minutesLabel}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}${hoursLabel}` : `${h}${hoursLabel} ${m}${minutesLabel}`;
}

/**
 * A stat tile whose number counts up from 0 on mount rather than appearing instantly — the
 * count itself is what makes the total land with some weight, the way an odometer does.
 *
 * Deliberately plain `useState`, not an `Animated.Text`: the value must render as arbitrary
 * formatted text (`formatDuration`'s "1h 20m", thousands separators), and reading an animated
 * value's live number back out for text formatting means a JS-side listener either way — so
 * there is nothing an Animated-driven style would buy here, only another driver mode to keep
 * track of.
 */
function CountUpTile({
  target,
  label,
  format,
  delay,
}: {
  target: number;
  label: string;
  format: (n: number) => string;
  delay: number;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [display, setDisplay] = useState(0);
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const counter = new Animated.Value(0);
    const listenerId = counter.addListener(({ value }) => setDisplay(value));

    const animation = Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.timing(entrance, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(counter, {
          toValue: target,
          duration: 650,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
      ]),
    ]);
    animation.start();

    return () => {
      animation.stop();
      counter.removeListener(listenerId);
    };
    // Re-runs only when the sheet is re-keyed open (see FinishSummary), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[
        styles.tile,
        {
          opacity: entrance,
          transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        },
      ]}
    >
      <Text style={styles.tileValue}>{format(Math.round(display))}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </Animated.View>
  );
}

export function FinishSummary({
  visible,
  durationMinutes,
  exerciseCount,
  setCount,
  volumeKg,
  initialName,
  watchAvailable = false,
  onConfirm,
  onCancel,
  onImportFromWatch,
}: FinishSummaryProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [name, setName] = useState(initialName ?? '');

  // A fresh key each time the sheet opens — it's what makes the trophy and tiles' `useEffect`s
  // (mount-triggered, not visibility-triggered) fire again for every workout finished, not just
  // the first one, without this component ever actually unmounting between sessions.
  const [openKey, setOpenKey] = useState(0);
  useEffect(() => {
    if (visible) {
      setName(initialName ?? '');
      setOpenKey((k) => k + 1);
    }
    // Only the open transition should reset state — not every keystroke in the name field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const trophy = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    hapticSuccess();
    trophy.setValue(0);
    Animated.spring(trophy, {
      toValue: 1,
      friction: 4,
      tension: 60,
      useNativeDriver: true,
    }).start();
  }, [visible, trophy]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          <Animated.Text
            style={[
              styles.trophy,
              {
                transform: [
                  { scale: trophy.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) },
                  {
                    rotate: trophy.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: ['-20deg', '12deg', '0deg'],
                    }),
                  },
                ],
              },
            ]}
          >
            🏆
          </Animated.Text>
          <Text style={styles.title}>{t('workout.summaryTitle')}</Text>

          <View key={openKey} style={styles.tiles}>
            <CountUpTile
              target={durationMinutes}
              format={(n) => formatDuration(n, 'h', t('history.minutes'))}
              label={t('workout.summaryDuration')}
              delay={0}
            />
            <CountUpTile
              target={exerciseCount}
              format={(n) => String(n)}
              label={t('workout.summaryExercises')}
              delay={80}
            />
            <CountUpTile
              target={setCount}
              format={(n) => String(n)}
              label={t('workout.summarySets')}
              delay={160}
            />
            <CountUpTile
              target={volumeKg}
              format={(n) => (n > 0 ? n.toLocaleString() : '—')}
              label={`${t('workout.summaryVolume')} (${t('common.kg')})`}
              delay={240}
            />
          </View>

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t('history.namePlaceholder')}
            placeholderTextColor={colors.textFaint}
            style={styles.nameInput}
            returnKeyType="done"
          />
          <Text style={styles.namePrompt}>{t('workout.summaryNamePrompt')}</Text>

          {watchAvailable && onImportFromWatch ? (
            <View style={styles.watchBlock}>
              <Button
                label={t('workout.watchImport')}
                variant="secondary"
                onPress={onImportFromWatch}
              />
            </View>
          ) : (
            <Banner tone="info">{t('workout.watchExplain')}</Banner>
          )}

          <View style={styles.actions}>
            <Button
              label={t('workout.summarySave')}
              onPress={() => onConfirm(name.trim() === '' ? null : name.trim())}
            />
            <Button label={t('workout.summaryDiscard')} variant="ghost" onPress={onCancel} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    backdrop: ViewStyle;
    sheet: ViewStyle;
    grabber: ViewStyle;
    trophy: TextStyle;
    title: TextStyle;
    tiles: ViewStyle;
    tile: ViewStyle;
    tileValue: TextStyle;
    tileLabel: TextStyle;
    nameInput: TextStyle;
    namePrompt: TextStyle;
    watchBlock: ViewStyle;
    actions: ViewStyle;
  }>({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  trophy: { fontSize: 44, textAlign: 'center', marginBottom: spacing.xs },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  tiles: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  tile: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm },
  tileValue: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  tileLabel: { color: colors.textMuted, fontSize: fontSize.xxs, marginTop: spacing.xxs },
  nameInput: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    textAlign: 'auto',
  },
  namePrompt: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
    textAlign: 'auto',
  },
  watchBlock: { marginTop: spacing.md },
  actions: { marginTop: spacing.lg, gap: spacing.sm },
});
