// Alber design tokens
const COLORS = {
  black100: '#000000',
  black90: '#0E0E0E',
  black80: '#1A1A1A',
  black70: '#222222',
  black60: '#2C2C2C',
  white100: '#FFFFFF',
  white95: '#F8F8F8',
  white90: '#F5F5F5',
  gray500: '#666666',
  gray400: '#999999',
  warning500: '#F59E0B',
  warning600: '#FF9500',
  error: '#EF4444',
  success: '#22C55E',
};

const SPACE_SKINS = {
  none: { name: 'USE ALBER', accent: '#FFFFFF', bg: 'radial-gradient(ellipse at 50% 0%, #0c0c0c 0%, #000 70%)', wm: 0.025, role: null },
  surf: { name: 'Surf Club', accent: '#5BCEC9', bg: 'radial-gradient(ellipse at 60% 20%, #06181f 0%, #050a0c 60%, #000 100%)', wm: 0.035, role: 'MEMBRO' },
  nomads: { name: 'Nomads Club', accent: '#C9B06A', bg: 'radial-gradient(ellipse at 60% 30%, #13120a 0%, #080808 70%)', wm: 0.035, role: 'MEMBRO' },
  tech: { name: 'Tech Builders', accent: '#7DA3E0', bg: 'radial-gradient(ellipse at 40% 20%, #080a14 0%, #060608 70%)', wm: 0.035, role: 'MEMBRO' },
  gourmet: { name: 'Gourmet Club', accent: '#E07D7D', bg: 'radial-gradient(ellipse at 50% 40%, #120808 0%, #080606 70%)', wm: 0.035, role: 'DONO' },
};

const TYPE = {
  family: '"Inter", -apple-system, "SF Pro Display", system-ui, sans-serif',
};

// Logo path — embedded by component file at runtime via window.__ALBER_LOGO
window.ALBER = { COLORS, SPACE_SKINS, TYPE };
