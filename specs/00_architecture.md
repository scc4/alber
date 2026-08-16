# Alber — Arquitetura Geral
**Versão:** 1.0  
**Data:** 28/04/2026  
**Status:** Aprovado — fonte de verdade para desenvolvimento

---

## 1. Visão geral do produto

Alber é um app mobile de carteira digital baseada em Albers (moeda proprietária),
com foco em operações entre usuários, splits de despesas, espaços sociais (Alber
Spaces) e controles de governança avançada. O backend financeiro é provido pelo
Asaas via White Label — invisível ao usuário final.

---

## 2. Princípios arquiteturais

- **BaaS invisível:** Asaas opera em background. O usuário nunca vê marca Asaas.
- **API-first:** toda regra de negócio vive no backend, nunca no app.
- **Segurança transversal:** PIN, confirmação de segurança e validações não são
  features isoladas — são camadas que atravessam todos os fluxos sensíveis.
- **Componentização antes de escalar:** nenhuma tela nasce como arte isolada.
- **Specs como fonte de verdade:** qualquer decisão que extrapole este documento
  deve ser documentada explicitamente antes de implementada.

---

## 3. Stack definida

### 3.1 Frontend — Mobile
| Camada | Tecnologia | Justificativa |
|---|---|---|
| Framework | React Native + Expo (managed) | Melhor suporte a vibe coding, Claude Code e builders |
| Navegação | Expo Router (file-based) | Estrutura previsível, deep links nativos |
| Design system | StyleSheet + tokens próprios | Controle total sobre o visual black/white premium |
| Estado global | Zustand | Leve, simples, fácil de manter com IA |
| Push notifications | Expo Notifications | Integrado ao managed workflow |
| Contatos | Expo Contacts | Permissão explícita, sincronização sob demanda |
| Deep links | Expo Linking | Convites do Split via link universal |
| Build e deploy | EAS Build (Expo Application Services) | Google Play + App Store sem CI/CD manual |
| Armazenamento seguro | Expo SecureStore | PIN hash, tokens de sessão |

### 3.2 Backend — BFF (Backend for Frontend)
| Camada | Tecnologia | Justificativa |
|---|---|---|
| Runtime | Supabase Edge Functions (Deno/TypeScript) | Serverless, rápido, integrado ao banco |
| Banco de dados | Supabase PostgreSQL | RLS nativo, tempo real quando necessário |
| Auth | Supabase Auth + JWT | Sessão, refresh token, expiração controlada |
| Storage | Supabase Storage | Documentos KYC, imagens de perfil e Spaces |
| Webhooks | Supabase Edge Functions | Recebe eventos Asaas (Pix confirmado, KYC aprovado) |

### 3.3 Integração financeira
| Camada | Tecnologia |
|---|---|
| BaaS | Asaas White Label |
| Subcontas | Asaas API — uma subconta por usuário Alber |
| Pix | Asaas API — QR code dinâmico, webhooks de confirmação |
| Cash out | Asaas API — transferência para chave Pix validada |
| KYC | Asaas — validação de documentos e selfie |
| Taxas | Retidas pela conta pai Alber antes de crédito ao usuário |

---

## 4. Arquitetura de camadas

```
┌─────────────────────────────────────────┐
│           Alber App (React Native)       │
│  Expo Router / Zustand / SecureStore    │
└──────────────────┬──────────────────────┘
                   │ HTTPS
┌──────────────────▼──────────────────────┐
│         BFF — Supabase Edge Functions   │
│  Auth / Regras de negócio / Webhooks    │
└──────┬───────────────────┬──────────────┘
       │                   │
┌──────▼──────┐   ┌────────▼────────────┐
│  Supabase   │   │    Asaas API        │
│  PostgreSQL │   │  White Label BaaS   │
│  Auth       │   │  Pix / KYC / Split  │
│  Storage    │   │  Subcontas / Taxas  │
└─────────────┘   └─────────────────────┘
```

---

## 5. Estrutura de pastas do projeto

```
alber/
├── app/                        # Expo Router — telas e navegação
│   ├── (auth)/                 # Onboarding, login, recuperação
│   ├── (app)/                  # App autenticado
│   │   ├── index.tsx           # Home
│   │   ├── receber.tsx
│   │   ├── carregar.tsx
│   │   ├── split/
│   │   ├── spaces/
│   │   ├── achar.tsx
│   │   ├── atividade.tsx
│   │   └── perfil/
│   └── _layout.tsx
├── components/                 # Biblioteca de componentes
│   ├── core/                   # Header, BottomNav, Button, Input
│   ├── financial/              # BalanceBlock, PINInput, QRCode
│   ├── split/                  # SplitCard, ParticipantRow
│   ├── spaces/                 # SpaceCard, EventCard
│   └── shared/                 # AlertCard, EmptyState, Loading
├── store/                      # Zustand slices
│   ├── auth.store.ts
│   ├── balance.store.ts
│   ├── split.store.ts
│   └── spaces.store.ts
├── services/                   # Camada de API
│   ├── asaas.service.ts        # Nunca chamado direto do app
│   ├── auth.service.ts
│   ├── pix.service.ts
│   ├── split.service.ts
│   └── spaces.service.ts
├── tokens/                     # Design system tokens
│   ├── colors.ts
│   ├── typography.ts
│   └── spacing.ts
├── utils/
│   ├── crypto.ts               # Hash de PIN, criptografia
│   ├── validation.ts           # CPF, @handle, chave Pix
│   └── masks.ts                # Máscaras de exibição
└── specs/                      # Este diretório
```

---

## 6. Módulos MVP e responsabilidades

| Módulo | Arquivo de spec | Status |
|---|---|---|
| Onboarding | 06_modules/onboarding.md | ✅ Fechado |
| Home | 06_modules/home.md | ✅ Fechado |
| Carregar / Descarregar | 06_modules/carregar_descarregar.md | ✅ Fechado |
| Receber | 06_modules/receber.md | ✅ Fechado |
| Split | 06_modules/split.md | ✅ Fechado |
| Transferir | 06_modules/transferir.md | ✅ Fechado |
| Alber Lounge | 06_modules/alber_lounge.md | ✅ Fechado |
| Achar | 06_modules/achar.md | ✅ Fechado |
| Atividade | 06_modules/atividade.md | ✅ Fechado |
| Perfil | 06_modules/perfil.md | ✅ Fechado |
| Empresa / Operadores (PJ) | 06_modules/empresa_operadores.md | ⚠️ Implementado, pós-MVP — ver lacunas §11 do spec |

---

## 7. Fora do MVP — backlog documentado

| Item | Arquivo |
|---|---|
| Transmitir | 07_open_decisions.md |
| Consumir (parceiros) | 07_open_decisions.md |
| BI / Analytics | 07_open_decisions.md |
| Achar — busca de Spaces e parceiros | 07_open_decisions.md |
| Painel administrativo | 08_admin_panel.md |

---

## 8. Regras críticas para todos os agentes e times

- **NUNCA** expor a chave de API do Asaas no app mobile
- **NUNCA** armazenar PIN em texto puro — sempre hash
- **NUNCA** assumir usuário logado como origem/destino em operações de terceiros
- **NUNCA** permitir customização de Space que quebre shell fixa
- **SEMPRE** validar CPF da origem do Pix no webhook antes de creditar
- **SEMPRE** implementar componentes antes de escalar telas
- **SEMPRE** documentar decisões locais que extrapolem os specs
- **SEMPRE** registrar eventos de analytics nos pontos críticos

---

## 9. Convenções de código

- Linguagem: **TypeScript** em todo o projeto
- Componentes: **PascalCase** (ex: `BalanceBlock`)
- Arquivos de serviço: **camelCase.service.ts**
- Stores Zustand: **camelCase.store.ts**
- Tokens: exportados como objetos tipados (`colors.black[100]`)
- Commits: **Conventional Commits** (feat, fix, chore, docs)
- i18n: **i18next** — todas as strings em `locales/pt-BR.json`, nunca hardcoded
- Idiomas MVP: Português (pt-BR) | Próxima versão: Espanhol (es)
- Branches: `feature/nome-do-modulo`, `fix/descricao`

---

## 10. Referências

| Documento | Localização |
|---|---|
| PRD Executivo | PRD_Executivo_v28_ABRIL.pdf |
| Design System | Alber_Design_System_Executivo_Final_v1.pdf |
| Frontend spec | specs/01_frontend.md |
| Design system spec | specs/02_design_system.md |
| Backend spec | specs/03_backend.md |
| API Asaas spec | specs/04_api_asaas.md |
| Segurança spec | specs/05_security.md |
