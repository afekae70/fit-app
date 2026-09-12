import { Tabs } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated } from 'react-native';
import { Barbell, CalendarBlank, ChartBar, House, type Icon } from 'phosphor-react-native';

import { useTheme } from '../../src/ThemeProvider.js';

/**
 * Four tabs: היום · אימון · תוכנית · התקדמות — the things done while training.
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
  const progress = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(progress, {
      toValue: focused ? 1 : 0,
      friction: 6,
      tension: 80,
      useNativeDriver: true,
    }).start();
  }, [focused, progress]);

  return (
    <Animated.View
      style={{
        transform: [
          { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) },
        ],
      }}
    >
      {/* `duotone` when focused rather than a heavier stroke: filling the glyph would put a solid
          block of accent on screen, and the accent is reserved for actions and live data. */}
      <Glyph size={20} color={color} weight={focused ? 'duotone' : 'regular'} />
    </Animated.View>
  );
}

export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const icon =
    (Glyph: Icon) =>
    ({ focused, color }: { focused: boolean; color: string }) => (
      <TabIcon Glyph={Glyph} focused={focused} color={color} />
    );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          height: 74,
          paddingTop: 8,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontSize: 10 },
        sceneStyle: { backgroundColor: colors.bg },
        // Deliberately no custom tab-switch animation (e.g. sceneStyleInterpolator): it was
        // inconsistent in practice — sometimes animating, sometimes not — worse than the
        // instant default it was meant to improve on.
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t('tabs.today'), tabBarIcon: icon(House) }}
      />
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
  );
}
