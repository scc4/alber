# Alber — Contexto do Projeto

## O que é este projeto
App mobile de carteira digital baseada em Albers (moeda proprietária).
Stack: React Native + Expo (managed workflow) + Supabase + Asaas (BaaS).
O usuário nunca vê a marca Asaas — tudo opera sob marca Alber.

## Design de referência
Os arquivos de design estão em /design/.
SEMPRE leia /design/README.md antes de implementar qualquer componente visual.
O arquivo /design/tokens.jsx é a fonte de verdade para cores e tipografia.
Para cada tela a implementar, leia o JSX correspondente em /design/ antes de
escrever uma linha de StyleSheet.

Hierarquia de referência visual:
1. /design/tokens.jsx → tokens visuais (cores, skins, tipografia)
2. /design/primitives.jsx → componentes base já desenhados
3. /design/[arquivo-da-tela].jsx → layout e comportamento da tela
4. /specs/02_design_system.md → regras de negócio visuais

## Specs
Todos os specs estão na pasta /specs.
SEMPRE leia os specs relevantes antes de implementar qualquer coisa.
Os specs são a fonte de verdade de produto — nunca improvise decisões.

Mapa de specs por domínio:
- /specs/00_architecture.md → visão geral, stack, estrutura de pastas
- /specs/01_frontend.md → navegação, stores, permissões, deep links
- /specs/02_design_system.md → tokens, componentes, estados obrigatórios
- /specs/03_backend.md → Supabase BFF, modelo de dados, Edge Functions
- /specs/04_api_asaas.md → integração financeira Asaas (CRÍTICO)
- /specs/05_security.md → PIN scrambled, autenticação dupla (CRÍTICO)
- /specs/06_modules/ → spec detalhado de cada módulo
- /specs/07_open_decisions.md → o que está fora do MVP
- /specs/08_admin_panel.md → painel admin (pós-MVP)

## Regras obrigatórias — NUNCA violar
- NUNCA expor chaves Asaas no app mobile
- NUNCA armazenar PIN em texto puro — sempre hash SHA-256 antes de enviar
- NUNCA hardcodar strings de texto — sempre via i18next (locales/pt-BR.json)
- NUNCA usar AsyncStorage para dados sensíveis — sempre expo-secure-store
- SEMPRE implementar os 5 estados em todo componente de dados:
  loading, success, error, empty, disabled
- SEMPRE usar tokens do design system — nunca valores de cor ou tamanho hardcoded
- SEMPRE referenciar o design em /design/ antes de criar qualquer tela
- SEMPRE documentar decisões locais que extrapolem os specs

## Stack
- Framework: React Native + Expo SDK 51 (managed workflow)
- Navegação: Expo Router (file-based, grupos auth e app)
- Estado: Zustand (stores em /store/)
- Backend: Supabase Edge Functions (Deno/TypeScript)
- Banco: Supabase PostgreSQL com RLS ativo
- Auth: Supabase Auth + JWT armazenado em expo-secure-store
- BaaS financeiro: Asaas White Label (nunca chamado direto do app)
- i18n: i18next + react-i18next (locales/pt-BR.json)
- Build e deploy: EAS Build → Google Play + App Store

## Estrutura de pastas esperada
```
alber/
├── app/
│   ├── (auth)/          # splash, welcome, onboarding, login, forgot-pin
│   └── (app)/           # home, receber, carregar, transferir, split/, lounge/, achar, atividade, perfil/
├── components/
│   ├── core/            # Header, BottomNav, PrimaryButton, AlertCard, Banner
│   ├── financial/       # PINInput, SecurityConfirmation, QRCodeDisplay, BalanceBlock
│   ├── split/           # SplitCard, ParticipantRow, LaunchItem
│   ├── lounge/          # LoungeCard, EventCard, BatchBadge
│   └── shared/          # EmptyState, LoadingSkeleton, Rule, Eyebrow
├── store/
│   ├── auth.store.ts
│   ├── balance.store.ts
│   ├── split.store.ts
│   └── lounge.store.ts
├── services/
│   ├── auth.service.ts
│   ├── financial.service.ts
│   ├── split.service.ts
│   └── lounge.service.ts
├── tokens/
│   ├── colors.ts
│   ├── typography.ts
│   └── spacing.ts
├── locales/
│   ├── pt-BR.json       # MVP — completo
│   └── es.json          # próxima versão — vazio
├── supabase/
│   └── functions/       # Edge Functions
├── design/              # arquivos do Claude Design (referência visual)
└── specs/               # especificações do produto (fonte de verdade)
```
## Ordem de implementação (sprints)
Sprint 0: tokens + componentes base (FAZER PRIMEIRO — tudo depende disso)
Sprint 1: autenticação (splash, welcome, onboarding, login, forgot-pin)
Sprint 2: Home + Carregar/Descarregar
Sprint 3: Receber + Transferir
Sprint 4: Split (fixo, variável, prestar conta, foto)
Sprint 5: Alber Lounge (criar, entrar, eventos com lotes)
Sprint 6: Atividade + Achar + Perfil + KYC

## Como iniciar cada sprint
Antes de qualquer sprint diga:
"Leia CLAUDE.md, /design/README.md e os specs relevantes antes de começar."
Depois especifique exatamente o que implementar nessa sessão.
Mantenha o escopo pequeno — um componente ou uma tela por vez.