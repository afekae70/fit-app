/**
 * Two photos in one frame, and a line to drag between them.
 *
 * Side by side, two photos are two smaller pictures and the eye has to jump between them to
 * find the difference. Laid over each other, the same waist is in the same place, and dragging
 * the line across it is how a change of a centimetre becomes visible. That is the whole idea.
 *
 * The earlier photo is drawn from the start edge up to the line, the later one under it filling
 * the frame — so before sits where reading begins, as it does side by side. Both are drawn at
 * the full frame size and only the earlier one's window changes width, so neither picture moves
 * or stretches while the line does.
 *
 * Built on `PanResponder`, like `SwipeableRow`: no gesture library, so no native module and no
 * rebuild of the dev client. The divider's position is a JS-driven `Animated.Value` (width and
 * position are layout, which the native driver cannot move) and nothing on these nodes uses the
 * native driver — see CLAUDE.md on mixing the two.
 *
 * For a screen reader it is an adjustable control: swipe up or down to show more of either.
 */

import { ArrowsLeftRight } from 'phosphor-react-native';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  I18nManager,
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { hapticLight } from '../haptics.js';
import { dividerAfterDrag, dividerStep, shownPercent } from '../progressPhotos/slider.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import { Text } from './Text.js';

const HANDLE = 44;

export function BeforeAfterSlider({
  before,
  after,
  beforeLabel,
  afterLabel,
}: {
  /** Each photo, drawn at the size it is given: the whole frame, always. */
  before: (size: { width: number; height: number }) => ReactNode;
  after: (size: { width: number; height: number }) => ReactNode;
  beforeLabel: string;
  afterLabel: string;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [width, setWidth] = useState(0);
  const height = (width * 4) / 3;
  const divider = useRef(new Animated.Value(0)).current;
  /** The divider's resting place, mirrored outside the animated value for the arithmetic. */
  const at = useRef(0);
  const grabbedAt = useRef(0);
  const widthRef = useRef(0);
  const [percent, setPercent] = useState(50);

  const place = (value: number) => {
    at.current = value;
    divider.setValue(value);
  };

  const onLayout = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width;
    if (measured === widthRef.current) return;
    widthRef.current = measured;
    setWidth(measured);
    // Halfway to start with: an even split is the comparison before anyone touches it.
    place(measured / 2);
    setPercent(50);
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Sideways only. A finger moving up or down over the photo is scrolling the page, and is
        // left to the page; one moving across it is reaching for the line.
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        // Held once taken: a page that scrolls away mid-drag loses the line.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          grabbedAt.current = at.current;
          hapticLight();
        },
        onPanResponderMove: (_, gesture) => {
          place(
            dividerAfterDrag(grabbedAt.current, gesture.dx, widthRef.current, I18nManager.isRTL),
          );
        },
        onPanResponderRelease: () => setPercent(shownPercent(at.current, widthRef.current)),
        onPanResponderTerminate: () => setPercent(shownPercent(at.current, widthRef.current)),
      }),
    // `place` only touches refs and the animated value, which are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const nudge = (towardsStart: boolean) => {
    place(dividerStep(at.current, widthRef.current, towardsStart));
    setPercent(shownPercent(at.current, widthRef.current));
  };

  const size = { width, height };

  return (
    <View
      style={[styles.frame, { height: height || undefined }]}
      onLayout={onLayout}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={t('progressPhotos.sliderLabel')}
      accessibilityValue={{ min: 0, max: 100, now: percent, text: `${percent}%` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => nudge(event.nativeEvent.actionName === 'decrement')}
      {...responder.panHandlers}
    >
      {width > 0 ? (
        <>
          <View style={StyleSheet.absoluteFill}>{after(size)}</View>
          <Animated.View style={[styles.window, { width: divider }]}>
            <View style={[styles.full, size]}>{before(size)}</View>
          </Animated.View>

          <Animated.View
            pointerEvents="none"
            style={[styles.line, { start: Animated.subtract(divider, 1) }]}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.handle,
              { start: Animated.subtract(divider, HANDLE / 2), top: height / 2 - HANDLE / 2 },
            ]}
          >
            <ArrowsLeftRight size={20} color={colors.accent} weight="bold" />
          </Animated.View>

          <View pointerEvents="none" style={[styles.tag, styles.tagStart]}>
            <Text style={styles.tagText}>{beforeLabel}</Text>
          </View>
          <View pointerEvents="none" style={[styles.tag, styles.tagEnd]}>
            <Text style={styles.tagText}>{afterLabel}</Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    frame: ViewStyle;
    window: ViewStyle;
    full: ViewStyle;
    line: ViewStyle;
    handle: ViewStyle;
    tag: ViewStyle;
    tagStart: ViewStyle;
    tagEnd: ViewStyle;
    tagText: TextStyle;
  }>({
    frame: {
      width: '100%',
      aspectRatio: 3 / 4,
      borderRadius: radius.lg,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    // The earlier photo's window: from the start edge to the line.
    window: { position: 'absolute', top: 0, bottom: 0, start: 0, overflow: 'hidden' },
    full: { position: 'absolute', top: 0, start: 0 },
    // White in both themes, on purpose: it is drawn over photographs, not over the palette.
    line: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: 2,
      backgroundColor: '#FFFFFF',
    },
    // 44 across: it is what the thumb is looking for, even though the whole frame answers.
    handle: {
      position: 'absolute',
      width: HANDLE,
      height: HANDLE,
      borderRadius: HANDLE / 2,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: '#FFFFFF',
    },
    tag: {
      position: 'absolute',
      top: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xxs,
      borderRadius: radius.pill,
      backgroundColor: colors.glass,
    },
    tagStart: { start: spacing.sm },
    tagEnd: { end: spacing.sm },
    tagText: { color: colors.text, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  });
