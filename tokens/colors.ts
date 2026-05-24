// Source of truth: /design/tokens.jsx + /specs/02_design_system.md
// Values from tokens.jsx (visual source of truth); structure from spec section 2.

export const colors = {
  black: {
    100: '#000000', // base principal
    90:  '#0E0E0E', // superfícies escuras
    80:  '#1A1A1A', // bordas dark / destructive bg
    70:  '#222222',
    60:  '#2C2C2C',
  },
  white: {
    100: '#FFFFFF', // contraste primário
    95:  '#F8F8F8', // superfícies claras
    90:  '#F5F5F5', // placeholders e apoios
  },
  gray: {
    500: '#666666', // texto secundário
    400: '#999999', // metadata e ajuda
  },
  warning: {
    500: '#F59E0B', // warnings e alertas
    600: '#FF9500', // variante de alerta iOS-style
  },
  state: {
    error:   '#EF4444',
    success: '#22C55E',
    blocked: '#666666',
  },
} as const

// Alber Lounge skins — cada Space personaliza atmosfera sem quebrar shell fixa.
// bg: CSS radial-gradient (referência para react-native-linear-gradient ou Expo LinearGradient).
export const spaceSkins = {
  none: {
    name:   'USE ALBER',
    accent: '#FFFFFF',
    bgDark: '#000000', // fallback sólido para RN
    wm:     0.025,
    role:   null as string | null,
  },
  surf: {
    name:   'Surf Club',
    accent: '#5BCEC9',
    bgDark: '#050a0c',
    wm:     0.035,
    role:   'MEMBRO',
  },
  nomads: {
    name:   'Nomads Club',
    accent: '#C9B06A',
    bgDark: '#080808',
    wm:     0.035,
    role:   'MEMBRO',
  },
  tech: {
    name:   'Tech Builders',
    accent: '#7DA3E0',
    bgDark: '#060608',
    wm:     0.035,
    role:   'MEMBRO',
  },
  gourmet: {
    name:   'Gourmet Club',
    accent: '#E07D7D',
    bgDark: '#080606',
    wm:     0.035,
    role:   'DONO',
  },
} as const

export type SpaceSkinKey = keyof typeof spaceSkins
