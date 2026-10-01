/**
 * The floating bar at the bottom, with one pill that travels to whichever tab is chosen.
 *
 * The default bar can only fade a highlight in behind the new tab, which says "this one now" and
 * nothing about where it came from. A pill that slides says the four screens are a row you move
 * along — which is exactly what they are, since they are also swiped between. Arriving by swipe
 * and arriving by tap now look like the same movement.
 *
 * Built as a custom bar rather than styled into the default one because the pill has to be a
 * single node that outlives the tab change; one highlight per tab can only ever cross-fade.
 *
 * The slide is native-driven (translateX only) and the glyph swap is not animated at all: colour
 * cannot go through the native driver, and mixing the two drivers on one node is a crash rather
 * than a warning — see SegmentButton in ui.tsx.
 *
 * ## Where the tabs actually are
 *
 * Measured, not calculated. The first version worked out each slot from the bar's width and then
 * flipped the direction on `I18nManager.isRTL` — and that flag is false in this app even in
 * Hebrew, because the layout is mirrored with Yoga's `direction` instead (see the root layout).
 * So the pill sat under the last tab and slid off the screen. Each tab reports its own frame on
 * layout, and the pill goes to the frame of the chosen one, whichever way the row runs.
 */

import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Barbell, CalendarBlank, ChartBar, House, type Icon } from 'phosphor-react-native';

import { hapticLight } from '../haptics.js';
import { useTheme } from '../ThemeProvider.js';
import { radius, shadow, type ColorPalette } from '../theme.js';

/** The glyph for each route, by the file name the route comes from. */
const GLYPHS: Record<string, Icon> = {
  index: House,
  workouts: Barbell,
  plan: CalendarBlank,
  progress: ChartBar,
};

const BAR_HEIGHT = 64;
const SIDE_MARGIN = 14;

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  /** Each tab's frame within the bar, as the layout actually placed it. */
  const [slots, setSlots] = useState<{ x: number; width: number }[]>([]);
  const current = slots[state.index];

  const travel = useRef(new Animated.Value(0)).current;
  const pillWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!current) return;
    Animated.spring(travel, {
      toValue: current.x,
      useNativeDriver: true,
      friction: 9,
      tension: 70,
    }).start();
    // Width cannot go through the native driver, and it only changes when the bar is laid out —
    // which is not while anything is sliding, so the two never animate on one node at once.
    pillWidth.setValue(current.width);
  }, [current, travel, pillWidth]);

  return (
    <View
      style={[
        s.bar,
        {
          bottom: Math.max(insets.bottom, 10),
          height: BAR_HEIGHT,
        },
      ]}
    >
      {/* Left and translateX are physical, and so is the `x` each tab reported — the pair agree
          whichever way the row was laid out. */}
      {current ? (
        <Animated.View
          pointerEvents="none"
          style={[s.pill, { width: pillWidth, transform: [{ translateX: travel }] }]}
        />
      ) : null}

      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key]!;
        const label =
          typeof options.title === 'string' ? options.title : route.name;
        const focused = state.index === index;
        const Glyph = GLYPHS[route.name] ?? House;

        return (
          <Pressable
            key={route.key}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (focused || event.defaultPrevented) return;
              void hapticLight();
              navigation.navigate(route.name);
            }}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
            onLayout={(event) => {
              const { x, width: tabWidth } = event.nativeEvent.layout;
              setSlots((previous) => {
                const next = [...previous];
                const slot = { x: x + 4, width: Math.max(0, tabWidth - 8) };
                if (next[index]?.x === slot.x && next[index]?.width === slot.width) return previous;
                next[index] = slot;
                return next;
              });
            }}
            style={s.tab}
          >
            <Glyph
              size={21}
              color={focused ? colors.accent : colors.textFaint}
              weight={focused ? 'fill' : 'regular'}
            />
            <Text style={[s.label, focused && s.labelOn]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    bar: ViewStyle;
    pill: ViewStyle;
    tab: ViewStyle;
    label: TextStyle;
    labelOn: TextStyle;
  }>({
    bar: {
      position: 'absolute',
      insetInlineStart: SIDE_MARGIN,
      insetInlineEnd: SIDE_MARGIN,
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      ...shadow(colors.shadow).floating,
    },
    pill: {
      position: 'absolute',
      left: 0,
      top: 6,
      bottom: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
    },
    tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, height: '100%' },
    label: { color: colors.textFaint, fontSize: 10 },
    labelOn: { color: colors.accent, fontWeight: '700' },
  });
