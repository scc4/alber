// Source of truth: /design/tokens.jsx (TYPE.family) + /specs/02_design_system.md section 3.
// fontFamily: Inter loaded via expo-font; system fallbacks for native.

export const typography = {
  fontFamily: {
    primary: 'Inter',
    display: 'Inter',
    // Native fallbacks (used before Inter loads)
    fallback: 'System',
  },
  size: {
    balance:   { fontSize: 48, lineHeight: 56 }, // saldo na Home
    h1:        { fontSize: 22, lineHeight: 28 },
    h2:        { fontSize: 18, lineHeight: 24 },
    body:      { fontSize: 16, lineHeight: 22 },
    bodySmall: { fontSize: 15, lineHeight: 20 },
    label:     { fontSize: 14, lineHeight: 18 }, // botões, labels de input
    caption:   { fontSize: 13, lineHeight: 16 },
    micro:     { fontSize: 11, lineHeight: 14 }, // eyebrow, nav labels
  },
  weight: {
    regular: '400' as const,
    medium:  '500' as const,
    bold:    '700' as const,
  },
  // Pré-compostos para uso direto em StyleSheet
  button: {
    fontSize:      14,
    fontWeight:    '700' as const,
    letterSpacing: 1.12, // 0.08em @ 14px
    textTransform: 'uppercase' as const,
  },
  eyebrow: {
    fontSize:      10.5,
    fontWeight:    '500' as const,
    letterSpacing: 1.47, // 0.14em @ 10.5px
    textTransform: 'uppercase' as const,
  },
  navLabel: {
    fontSize:      9.5,
    fontWeight:    '500' as const,
    letterSpacing: 0.76, // 0.08em @ 9.5px
    textTransform: 'uppercase' as const,
  },
} as const
