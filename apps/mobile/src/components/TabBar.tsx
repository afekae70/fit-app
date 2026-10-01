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
 */

import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  I18nManager,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
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
  const { width } = useWindowDimensions();

  const count = Math.max(1, state.routes.length);
  const slotWidth = (width - SIDE_MARGIN * 2) / count;
  const travel = useRef(new Animated.Value(state.index)).current;

  useEffect(() => {
    Animated.spring(travel, {
      toValue: state.index,
      useNativeDriver: true,
      friction: 9,
      tension: 70,
    }).start();
  }, [state.index, travel]);

  /*
   * Where the pill sits.
   *
   * In Hebrew the row is laid out right to left, so tab 0 is on the right and the pill has to
   * travel the other way — `scaleX: -1` on the track mirrors the whole motion rather than making
   * every offset below know which language it is in. The tabs themselves are not mirrored: the
   * layout has already done that.
   */
  /*
   * `I18nManager.isRTL` rather than the active language: this is the layout's own direction, and
   * the two disagree until the app is reopened after a language switch — the pill has to travel
   * the way the row is actually laid out.
   */
  const rtl = I18nManager.isRTL;
  const offset = travel.interpolate({
    inputRange: [0, 1],
    outputRange: [0, slotWidth],
  });

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
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Animated.View
          style={[
            s.pill,
            {
              width: slotWidth - 12,
              // Physical sides on purpose: the pill is positioned against the row the layout
              // actually produced, and travels away from whichever side the first tab is on.
              left: rtl ? undefined : 6,
              right: rtl ? 6 : undefined,
              transform: [{ translateX: rtl ? Animated.multiply(offset, -1) : offset }],
            },
          ]}
        />
      </View>

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
      top: 6,
      bottom: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
    },
    tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, height: '100%' },
    label: { color: colors.textFaint, fontSize: 10 },
    labelOn: { color: colors.accent, fontWeight: '700' },
  });
