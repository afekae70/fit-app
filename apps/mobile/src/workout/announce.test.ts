import { describe, expect, it } from 'vitest';

import { announcementText, hasHebrewVoice, spokenName } from './announce.js';

describe('the spoken exercise name', () => {
  it('drops the formal name in brackets in Hebrew, keeping the word people use', () => {
    expect(spokenName('אלים (הרמת רגליים)', 'he')).toBe('אלים');
    expect(spokenName('ישיבה ומצד לצד (סיבוב רוסי)', 'he')).toBe('ישיבה ומצד לצד');
    expect(spokenName('חץ (וי-אפ)', 'he')).toBe('חץ');
  });

  it('leaves a Hebrew name without brackets alone', () => {
    expect(spokenName('פלאנק לצד השני', 'he')).toBe('פלאנק לצד השני');
  });

  it('keeps a qualifying bracket in English, as a pause', () => {
    expect(spokenName('Side Plank (Other Side)', 'en')).toBe('Side Plank, Other Side');
    expect(spokenName('Plank', 'en')).toBe('Plank');
  });

  it('introduces the name as the next exercise', () => {
    expect(announcementText('פלאנק צידי', 'he')).toBe('הבא: פלאנק צידי');
    expect(announcementText('Russian Twist', 'en')).toBe('Next: Russian Twist');
  });
});

describe('finding a Hebrew voice', () => {
  it('recognises Hebrew under its modern and its legacy code', () => {
    expect(hasHebrewVoice([{ language: 'he-IL' }])).toBe(true);
    expect(hasHebrewVoice([{ language: 'iw-IL' }])).toBe(true);
    expect(hasHebrewVoice([{ language: 'iw' }])).toBe(true);
  });

  it('does not mistake other languages for it', () => {
    expect(
      hasHebrewVoice([{ language: 'en-US' }, { language: 'hi-IN' }, { language: 'it-IT' }]),
    ).toBe(false);
    expect(hasHebrewVoice([])).toBe(false);
  });
});
