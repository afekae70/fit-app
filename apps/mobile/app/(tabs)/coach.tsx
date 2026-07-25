import { useTranslation } from 'react-i18next';

import { Placeholder } from '../../src/components/Placeholder.js';

export default function CoachScreen() {
  const { t, i18n } = useTranslation();
  const he = i18n.language === 'he';
  return (
    <Placeholder
      emoji="🤖"
      title={t('tabs.coach')}
      phase={he ? 'שלב 5' : 'Phase 5'}
      description={
        he
          ? 'מאמן AI שמנתח את היסטוריית האימונים שלך ומזהה איפה אתה מתקדם ואיפה נתקעת. מפתחות ה-API נשארים בשרת בלבד.'
          : 'An AI coach that analyses your training history to find where you are progressing and where you have stalled. API keys stay server-side only.'
      }
    />
  );
}
