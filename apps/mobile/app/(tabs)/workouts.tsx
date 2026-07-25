import { useTranslation } from 'react-i18next';

import { Placeholder } from '../../src/components/Placeholder.js';

export default function WorkoutsScreen() {
  const { t, i18n } = useTranslation();
  const he = i18n.language === 'he';
  return (
    <Placeholder
      emoji="🏋️"
      title={t('tabs.workouts')}
      phase={he ? 'שלב 2' : 'Phase 2'}
      description={
        he
          ? 'רישום אימונים עם מספר סטים דינמי לכל תרגיל — 4 סטים ללחיצת חזה ו-2 לפייס פול באותו אימון. סכמת בסיס הנתונים לזה כבר בנויה.'
          : 'Workout logging with per-exercise dynamic set counts — 4 sets of chest press and 2 of face pulls in one session. The database schema for this is already built.'
      }
    />
  );
}
