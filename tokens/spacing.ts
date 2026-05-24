// Source of truth: /specs/02_design_system.md section 4 + /design/README.md medidas críticas.

export const spacing = {
  // Escala base
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 40,

  // Layout semântico
  screenHorizontal: 32, // margem lateral padrão — NUNCA hardcode
  sectionGap:       40, // distância entre seções da Home
  itemGap:          24, // distância entre itens de lista
  cardPadding:      20, // padding interno de cards

  // Alturas de componentes fixas (design/README.md + spec)
  buttonHeight:     50,
  rowHeight:        72,  // ActionRow e linhas de lista
  inputHeight:      52,
  bottomNavHeight:  84,  // padding bottom incluso (10 + content + 28 safe area)
  headerHeight:     56,
  statusBarHeight:  44,

  // Raios de borda
  radius: {
    sm:   6,
    md:   12, // botões, inputs, cards
    lg:   16,
    xl:   20, // modais, sheets
    full: 9999, // chips e avatares
  },
} as const

// Referências de viewport para cálculos responsivos
export const layout = {
  referenceWidth:  390,
  referenceHeight: 844,
  gridColumns:     2,
  gridGap:         12,
  // Bottom sheet
  sheetBorderRadius: 18,
  sheetPaddingH:     24,
  sheetPaddingTop:   12,
  sheetPaddingBottom: 36,
} as const
