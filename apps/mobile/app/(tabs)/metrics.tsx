import { useTranslation } from 'react-i18next';

import { Placeholder } from '../../src/components/Placeholder.js';

export default function MetricsScreen() {
  const { t, i18n } = useTranslation();
  const he = i18n.language === 'he';
  return (
    <Placeholder
      emoji="⚖️"
      title={t('tabs.metrics')}
      phase={he ? 'שלב 4' : 'Phase 4'}
      description={
        he
          ? 'מעקב משקל עם ממוצע נע, וסנכרון אוטומטי ממשקל חכם בבלוטות׳. דורש בנייה מותאמת (Development Build) — לא עובד ב-Expo Go.'
          : 'Weight tracking with a moving average, plus automatic Bluetooth smart-scale sync. Requires a development build — Bluetooth does not work in Expo Go.'
      }
    />
  );
}
