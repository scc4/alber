# Design Handoff — Alber

Este diretório contém os arquivos de design exportados do Claude Design.
São protótipos HTML/JSX — NÃO copiar estrutura interna, usar como
referência visual pixel-perfect.

## Como usar

O Claude Code deve:
1. Ler os arquivos JSX para extrair tokens, componentes e layouts
2. Recriar em React Native respeitando visualmente o resultado
3. NÃO copiar código HTML/CSS — adaptar para StyleSheet do React Native

## Arquivos e o que contém

- tokens.jsx        → cores, skins de Lounge, tipografia (fonte de verdade visual)
- primitives.jsx    → componentes base: AlberA, BottomNav, TopBar, PrimaryButton,
                      Banner, Sheet, Input, ActionRow, Rule, Eyebrow
- pin.jsx           → PINInput scrambled (3 variantes), SecurityConfirm
- app.jsx           → navegação raiz, rotas, estado global do protótipo
- auth.jsx          → Splash, Welcome, Onboarding (6 etapas), termos
- auth-login.jsx    → Login, ForgotPin (esqueci PIN)
- flows1.jsx        → HomeScreen, ReceberFlow, CarregarFlow (carregar+descarregar)
- flow-transferir.jsx → TransferirFlow
- flows-split.jsx   → SplitListScreen, SplitDetailScreen, SplitCreateScreen
- flows-rest.jsx    → SpacesScreen, AtividadeScreen, PerfilScreen, AcharScreen,
                      EventCreateScreen, LoungeCreateScreen

## Tokens principais (extraídos de tokens.jsx)

Cores:
  black100: '#000000'  black90: '#0E0E0E'  black80: '#1A1A1A'
  white100: '#FFFFFF'  white95: '#F8F8F8'  white90: '#F5F5F5'
  gray500: '#666666'   gray400: '#999999'
  warning500: '#F59E0B' error: '#EF4444'   success: '#22C55E'

Lounges (skins):
  none    → 'USE ALBER'    accent #FFFFFF
  surf    → 'Surf Club'    accent #5BCEC9
  nomads  → 'Nomads Club'  accent #C9B06A
  tech    → 'Tech Builders' accent #7DA3E0
  gourmet → 'Gourmet Club' accent #E07D7D

Tipografia: Inter / -apple-system / SF Pro Display

## Medidas críticas (extraídas de primitives.jsx)

PhoneFrame: 390×844, borderRadius 54
BottomNav: padding 10px 0 28px, borderTop 0.5px rgba(255,255,255,0.08)
StatusBar: height 44, padding 14px 28px
ActionRow: padding 15px 0, borderTop 0.5px rgba(255,255,255,0.07)
PrimaryButton: height 50, borderRadius 12, fontSize 14, fontWeight 700
Input: borderBottom 0.5px, fontSize 16, padding 10px 0
Sheet: borderRadius 18px 18px 0 0, padding 12px 24px 36px