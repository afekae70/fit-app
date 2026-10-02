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
 * ## Glass
 *
 * The slab is translucent and blurred, and the page passes beneath it: a bar you can see through
 * says the content continues, where an opaque one says the screen ends there. The blur is native
 * (`expo-blur`); over it sits a wash of the surface colour, because a blur alone inherits the
 * contrast of whatever is behind it.
 *
 * That wash is heavy on purpose. At two thirds opacity the accent-coloured bars of the progress
 * chart read straight through the glass as a bright violet smear under one of the tabs — a mark
 * that looked like a rendering fault and moved with the page. Frosted glass hides what is behind
 * it and keeps only its light; anything less is a tinted window.
 *
 * The slide is native-driven (translateX only) and the glyph swap is not animated at all: colour
 * cannot go through the native driver, and mixing the two drivers on one node is a crash rather
 * than a warning — see SegmentButton in ui.tsx.
 *
 * ## Where the tabs actually are
 *
 * Measured on the screen itself, with `measureInWindow`, and that detail is the whole of this
 * component's history of bugs.
 *
 * The first version computed each slot from the bar's width and flipped the direction on
 * `I18nManager.isRTL` — a flag this app leaves false even in Hebrew, because the layout is
 * mirrored with Yoga's `direction` instead. The pill sat under the last tab and slid off screen.
 *
 * The second asked each tab for its `onLayout` frame. Under a mirrored layout that `x` is
 * measured from the row's own start edge, which in Hebrew is the right — while `translateX` moves
 * from the left, as it always does. The two disagreed, so the pill landed under Home while
 * Progress was open: the mirror image of the right answer.
 *
 * `measureInWindow` reports true screen coordinates, which no layout direction can reinterpret.
 * Each tab's offset is its own page position minus the bar's, and both sides of that subtraction
 * speak the same language.
 */

import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

  /** Each tab's frame within the bar, in screen coordinates — see the note above. */
  const [slots, setSlots] = useState<{ x: number; width: number }[]>([]);
  const current = slots[state.index];

  const barRef = useRef<View | null>(null);
  const tabRefs = useRef<(View | null)[]>([]);

  /**
   * Ask the bar and every tab where they actually are.
   *
   * Run from each tab's `onLayout`, which fires on mount, on rotation, and whenever a label
   * changes width — and every run measures all of them, because one tab growing moves its
   * neighbours and a single measurement would leave the rest stale.
   */
  const measureTabs = useCallback(() => {
    barRef.current?.measureInWindow((barX) => {
      const measured: { x: number; width: number }[] = [];
      let pending = tabRefs.current.length;
      if (pending === 0) return;
      tabRefs.current.forEach((node, index) => {
        if (!node) {
          pending -= 1;
          return;
        }
        node.measureInWindow((tabX, _y, tabWidth) => {
          measured[index] = { x: tabX - barX + 4, width: Math.max(0, tabWidth - 8) };
          pending -= 1;
          if (pending === 0) setSlots(measured);
        });
      });
    });
  }, []);

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
      ref={barRef}
      onLayout={measureTabs}
      style={[
        s.bar,
        {
          bottom: Math.max(insets.bottom, 10),
          height: BAR_HEIGHT,
        },
      ]}
    >
      {/* The glass itself, clipped to the slab's own corners. */}
      <BlurView
        intensity={scheme === 'dark' ? 60 : 48}
        tint={scheme === 'dark' ? 'dark' : 'light'}
        style={s.glass}
        pointerEvents="none"
      />

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
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            onLayout={() => measureTabs()}
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
