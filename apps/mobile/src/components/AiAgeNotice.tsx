/**
 * What an AI screen shows in place of itself to someone it is not for.
 *
 * Under 18 it says so plainly, and says the rest of the app is theirs — the point is a
 * condition of Google's Gemini terms, not a verdict on the person (see `AI_MIN_AGE`). With no
 * date of birth on the profile it says what is missing and where to put it, since that is the
 * one case the person can fix.
 */

import type { AiAgeVerdict } from '@fit/shared/calculations';
import { useRouter } from 'expo-router';
import { CalendarBlank, Sparkle } from 'phosphor-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, EmptyState } from './ui.js';

export function AiAgeNotice({ verdict }: { verdict: Exclude<AiAgeVerdict, 'adult'> }) {
  const { t } = useTranslation();
  const router = useRouter();

  if (verdict === 'minor') {
    return <EmptyState icon={Sparkle} title={t('aiAge.minorTitle')} hint={t('aiAge.minorBody')} />;
  }
  return (
    <View>
      <EmptyState
        icon={CalendarBlank}
        title={t('aiAge.unknownTitle')}
        hint={t('aiAge.unknownBody')}
      />
      <Button
        label={t('aiAge.addBirthDate')}
        variant="secondary"
        onPress={() => router.push('/nutrition')}
      />
    </View>
  );
}
