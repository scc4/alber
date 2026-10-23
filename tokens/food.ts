// Source of truth: design system "Alber Food" (tokens.json) — derived from usealber.com + tokens/colors.ts.
// Monocromático: o único acento é o inverso do fundo. Cor só para estado.

export const foodThemes = {
  dark: {
    bg:            '#000000',
    surface:       '#0E0E0E',
    surfaceRaised: '#1A1A1A',
    line:          'rgba(255,255,255,0.08)',
    controlBorder: '#666666',
    ink:           '#FFFFFF',
    inkMuted:      'rgba(255,255,255,0.70)',
    inkSubtle:     '#999999',
    accent:        '#FFFFFF',
    onAccent:      '#000000',
    success:       '#22C55E',
    warning:       '#F59E0B',
    error:         '#EF4444',
  },
  light: {
    bg:            '#FFFFFF',
    surface:       '#F8F8F8',
    surfaceRaised: '#F5F5F5',
    line:          'rgba(0,0,0,0.10)',
    controlBorder: '#767676',
    ink:           '#000000',
    inkMuted:      '#444444',
    inkSubtle:     '#666666',
    accent:        '#000000',
    onAccent:      '#FFFFFF',
    success:       '#15803D',
    warning:       '#B45309',
    error:         '#B91C1C',
  },
} as const

export type FoodThemeName = keyof typeof foodThemes
export type FoodTheme = { [K in keyof (typeof foodThemes)['dark']]: string }

export const foodSpace = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 24, s6: 32, s7: 48 } as const

export const foodRadius = { sm: 6, md: 8, lg: 12, xl: 18, pill: 999 } as const

// Geist (site) não está instalada no app; Inter permanece até a fonte ser adicionada via expo-font.
export const foodFont = {
  family: 'Inter',
  display:  { fontSize: 40, lineHeight: 44, fontWeight: '700' as const, letterSpacing: -0.8 },
  title:    { fontSize: 24, lineHeight: 30, fontWeight: '600' as const, letterSpacing: -0.24 },
  heading:  { fontSize: 18, lineHeight: 24, fontWeight: '600' as const },
  body:     { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  bodySm:   { fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  label:    { fontSize: 14, lineHeight: 16, fontWeight: '600' as const },
  caption:  { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
  eyebrow:  { fontSize: 11, lineHeight: 14, fontWeight: '600' as const, letterSpacing: 1.32 },
  price:    { fontSize: 18, lineHeight: 24, fontWeight: '600' as const },
  priceLg:  { fontSize: 32, lineHeight: 36, fontWeight: '700' as const, letterSpacing: -0.64 },
} as const

export const foodSize = { buttonHeight: 50, touch: 44, chipHeight: 36, badgeHeight: 24 } as const
