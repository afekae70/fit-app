import { Tabs } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Barbell, CalendarBlank, ChartBar, House, type Icon } from 'phosphor-react-native';

import { SwipeBetweenTabs } from '../../src/components/SwipeBetweenTabs.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { radius, shadow, type ColorPalette } from '../../src/theme.js';

/**
 * Four tabs: היום · אימון · תוכנית · התקדמות — the things done while training. They are also
 * swiped between; `SwipeBetweenTabs` keeps the same order, and dragging left moves forward.
 *
 * The exercise library was the fifth. It was the reading version of the catalogue, and the
 * catalogue is already in front of you at the moment it is wanted: the picker that opens when an
 * exercise is added to a workout. A permanent tab for browsing it was a tab spent on the rarest
 * thing in the bar.
 *
 * Everything else — profile, coach, nutrition, measurements, gyms, backup, settings — is in the
 * menu that every screen's header carries, rather than hidden behind the home screen's avatar
 * the way it used to be.
 *
 * Icons are Phosphor line icons at 20px / 1.5px stroke, as specified. They replaced emoji, which
 * were a first-run shortcut from before any of these screens existed — they rendered at whatever
 * weight and hue the platform font decided, which is the one thing a single-accent palette cannot
 * absorb. The cost is `react-native-svg`, deliberately avoided until now; the design also asks
 * for a stroke-dashoffset countdown ring and mirrored sparklines, so the dependency was going to
 * be needed regardless and this is the cheapest moment to take it.
 */
function TabIcon({ Glyph, focused, color }: { Glyph: Icon; focused: boolean; color: string }) {
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  const progress = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(progress, {
      toValue: focused ? 1 : 0,
      friction: 7,
      tension: 90,
      useNativeDriver: true,
    }).start();
  }, [focused, progress]);

  /*
   * The chosen tab sits in a filled circle that springs up behind its glyph.
   *
   * Two nested nodes, one per driver: the circle's opacity and scale are transforms and go
   * native, and nothing here animates colour — mixing the two drivers on one node is a crash,
   * not a warning (see SegmentButton in ui.tsx).
   */
  return (
    <View style={s.iconWrap}>
      <Animated.View
        style={[
          s.bubble,
          {
            opacity: progress,
            transform: [
              { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
            ],
          },
        ]}
      />
      <Animated.View
        style={{
          transform: [
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) },
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -1] }) },
          ],
        }}
      >
        <Glyph size={21} color={color} weight={focused ? 'fill' : 'regular'} />
      </Animated.View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create({
    iconWrap: { width: 44, height: 36, alignItems: 'center', justifyContent: 'center' },
    bubble: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
    },
  });

export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  /*
   * The bar floats: a rounded slab held off the bottom edge with the ground showing around it,
   * rather than a strip welded to the screen. `sceneStyle` gives every tab screen the room it
   * takes up, so nothing scrolls underneath it and hides.
   */
  const barHeight = 64;
  const barBottom = Math.max(insets.bottom, 10);

  const icon =
    (Glyph: Icon) =>
    ({ focused, color }: { focused: boolean; color: string }) => (
      <TabIcon Glyph={Glyph} focused={focused} color={color} />
    );

  return (
    <SwipeBetweenTabs>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textFaint,
          tabBarStyle: {
            position: 'absolute',
            insetInlineStart: 14,
            insetInlineEnd: 14,
            bottom: barBottom,
            height: barHeight,
            paddingTop: 8,
            paddingBottom: 6,
            backgroundColor: colors.surface,
            borderTopWidth: 0,
            borderRadius: radius.pill,
            ...shadow(colors.shadow).floating,
          },
          tabBarItemStyle: { height: barHeight - 14 },
          tabBarLabelStyle: { fontSize: 10, marginTop: 1 },
          sceneStyle: { backgroundColor: colors.bg, paddingBottom: barHeight + barBottom + 6 },
          // Deliberately no custom tab-switch animation (e.g. sceneStyleInterpolator): it was
          // inconsistent in practice — sometimes animating, sometimes not — worse than the
          // instant default it was meant to improve on.
        }}
      >
        <Tabs.Screen name="index" options={{ title: t('tabs.today'), tabBarIcon: icon(House) }} />
        <Tabs.Screen
          name="workouts"
          options={{ title: t('tabs.workout'), tabBarIcon: icon(Barbell) }}
        />
        <Tabs.Screen
          name="plan"
          options={{ title: t('tabs.plan'), tabBarIcon: icon(CalendarBlank) }}
        />
        <Tabs.Screen
          name="progress"
          options={{ title: t('tabs.progress'), tabBarIcon: icon(ChartBar) }}
        />
      </Tabs>
    </SwipeBetweenTabs>
  );
}
