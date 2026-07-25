/** Design tokens. Centralised so screens never hardcode colours or spacing. */

export const colors = {
  bg: '#0F1419',
  surface: '#1A2027',
  surfaceRaised: '#232B34',
  border: '#2E3944',
  text: '#F2F5F7',
  textMuted: '#8A97A5',
  accent: '#4ADE80',
  accentMuted: '#166534',
  warning: '#FBBF24',
  danger: '#F87171',
  protein: '#60A5FA',
  carbs: '#FBBF24',
  fat: '#F472B6',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 28,
  xxl: 40,
} as const;
