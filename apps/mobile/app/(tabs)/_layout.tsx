import { Tabs } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated } from 'react-native';

import { useTheme } from '../../src/ThemeProvider.js';
import { fontSize } from '../../src/theme.js';

/**
 * Emoji rather than an icon font: it keeps the first run dependency-free (no vector-icons
 * asset loading to debug on device) and renders identically on Android and iOS. Swap for
 * proper icons once the screens themselves are built out.
 *
 * The focus bounce is local to this one Animated.Value (opacity and scale both interpolated
 * from it, native-driven throughout) — unlike the tab-switch scene animation above, this isn't
 * an integration with react-native-screens, just a plain prop-driven spring, so it doesn't share
 * that feature's flakiness.
 */
function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
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
    <Animated.Text
      style={{
        fontSize: 22,
        opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
        transform: [
          { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) },
        ],
      }}
    >
      {emoji}
    </Animated.Text>
  );
}

export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontSize: fontSize.xs },
        sceneStyle: { backgroundColor: colors.bg },
        // Deliberately no custom tab-switch animation (e.g. sceneStyleInterpolator): it was
        // inconsistent in practice — sometimes animating, sometimes not — worse than the
        // instant default it was meant to improve on. The push/pop transition below is the
        // one animation this app ships, and it's a long-stable react-native-screens feature.
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.today'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="📊" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: t('tabs.plan'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="🗓️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="workouts"
        options={{
          title: t('tabs.workouts'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="🏋️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="metrics"
        options={{
          title: t('tabs.metrics'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="⚖️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: t('tabs.coach'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="💬" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
