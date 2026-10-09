export const colors = {
  background: '#FFFFFF',
  surface: '#F5F5F7',
  text: '#111111',
  muted: '#8A8A8E',
  accent: '#111111',
  border: '#E5E5EA',
  danger: '#C62828',
  warning: '#8D6E00',
  success: '#2E7D32',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const text = {
  title: { fontSize: 17, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  caption: { fontSize: 13, color: colors.muted },
  section: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.muted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
};

export const sourceNames = {
  usos: 'USOS',
  moodle: 'Moodle',
  teams: 'Teams',
} as const;

export const subjectPalette = [
  '#B3261E',
  '#D84315',
  '#E65100',
  '#8A5A00',
  '#827717',
  '#558B2F',
  '#2E7D32',
  '#00695C',
  '#00838F',
  '#0277BD',
  '#1565A8',
  '#283593',
  '#5B3F9E',
  '#7B1FA2',
  '#AD1457',
  '#5D4037',
  '#37474F',
  '#111111',
];

export const type = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' as const, color: colors.text },
  headline: { fontSize: 24, lineHeight: 30, fontWeight: '700' as const, color: colors.text },
  titleLarge: { fontSize: 20, lineHeight: 26, fontWeight: '600' as const, color: colors.text },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, lineHeight: 21, color: colors.text },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600' as const, letterSpacing: 0.4, color: colors.muted },
  caption: { fontSize: 13, lineHeight: 18, color: colors.muted },
};

export const radii = { sm: 8, md: 12, lg: 20, pill: 999 };

export function tinted(color: string, alpha: number) {
  return `${color}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`;
}
