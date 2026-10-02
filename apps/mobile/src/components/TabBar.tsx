/**
 * The floating bar at the bottom: four tabs, the chosen one wearing a filled pill.
 *
 * ## The pill lives inside its own tab
 *
 * It used to be one pill that slid along the bar, and it was wrong twice. First it computed each
 * slot from the bar's width and flipped direction on `I18nManager.isRTL` — a flag this app leaves
 * false even in Hebrew, because the layout is mirrored with Yoga's `direction` instead — so it sat
 * under the last tab and slid off screen. Then it read each tab's `onLayout` frame, whose `x` is
 * measured from the row's own start edge: in Hebrew that is the right, while `translateX` moves
 * from the left, so the pill landed on Home while Progress was open. Measuring in window
 * coordinates was a third guess at the same question.
 *
 * So the highlight is now a child of the tab it marks. There is no coordinate left to get wrong:
 * the pill is where its tab is, in any layout direction and at any screen width. It costs the
 * slide — a pill that travels cannot also be four pills — and that trade is worth making for the
 * one control whose entire job is to say, unambiguously, which of four screens you are on.
 *
 * It still moves: the pill springs up behind the glyph as its tab takes focus and fades as it
 * loses it. Transform and opacity only, so it stays on the native driver; nothing here animates
 * colour, which cannot go native and must never share a node with something that does.
 *
 * ## Glass
 *
 * The slab is translucent and blurred, and the page passes beneath it: a bar you can see through
 * says the content continues, where an opaque one says the screen ends there. The blur is native
 * (`expo-blur`); over it sits a wash of the surface colour, because a blur alone inherits the
 * contrast of whatever is behind it.
 *
 * That wash is heavy on purpose. At two thirds opacity the accent-coloured bars of the progress
 * chart read straight through the glass as a bright violet smear — a mark that looked like a
 * rendering fault and moved with the page. Frosted glass hides what is behind it and keeps only
 * its light; anything less is a tinted window.
 */

import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useEffect, useMemo, useRef } from 'react';
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
import { BlurView } from 'expo-blur';
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
  const { colors, scheme } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  return (
    <View style={[s.bar, { bottom: Math.max(insets.bottom, 10), height: BAR_HEIGHT }]}>
      {/* The glass itself, clipped to the slab's own corners. */}
      <BlurView
        intensity={scheme === 'dark' ? 60 : 48}
        tint={scheme === 'dark' ? 'dark' : 'light'}
        style={s.glass}
        pointerEvents="none"
      />

      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key]!;
        const label = typeof options.title === 'string' ? options.title : route.name;
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
            <Pill focused={focused} styles={s} />
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

/** The filled shape behind the chosen tab, springing up as it takes focus. */
function Pill({
  focused,
  styles: s,
}: {
  focused: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  const shown = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(shown, {
      toValue: focused ? 1 : 0,
      useNativeDriver: true,
      friction: 7,
      tension: 90,
    }).start();
  }, [focused, shown]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        s.pill,
        {
          opacity: shown,
          transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
        },
      ]}
    />
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    bar: ViewStyle;
    glass: ViewStyle;
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
      // A wash rather than a fill: enough to carry the labels, little enough to see through.
      backgroundColor: colors.glass,
      borderWidth: 1,
      borderColor: colors.glassEdge,
      overflow: 'hidden',
      ...shadow(colors.shadow).floating,
    },
    glass: { ...StyleSheet.absoluteFillObject, borderRadius: radius.pill },
    // Inset from its own tab rather than sized in pixels: the four share the bar evenly at any
    // width, and the pill simply takes whatever share its tab was given.
    pill: {
      position: 'absolute',
      top: 5,
      bottom: 5,
      start: 6,
      end: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
    },
    tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, height: '100%' },
    label: { color: colors.textFaint, fontSize: 10 },
    labelOn: { color: colors.accent, fontWeight: '700' },
  });
