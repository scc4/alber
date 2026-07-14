# Alber — Spec Frontend
**Versão:** 1.0  
**Data:** 28/04/2026  
**Depende de:** 00_architecture.md, 02_design_system.md

---

## 1. Stack e dependências

```json
{
  "framework": "React Native 0.74+",
  "runtime": "Expo SDK 51+ (managed workflow)",
  "linguagem": "TypeScript 5+",
  "navegacao": "Expo Router 3+",
  "estado": "Zustand 4+",
  "storage_seguro": "expo-secure-store",
  "notificacoes": "expo-notifications",
  "contatos": "expo-contacts",
  "deep_links": "expo-linking",
  "camera_documentos": "expo-camera + expo-image-picker",
  "qrcode_exibicao": "react-native-qrcode-svg",
  "build": "EAS Build",
  "deploy": "Google Play + App Store"
}
```

---

## 2. Estrutura de navegação

### 2.1 Grupos de rotas (Expo Router)

```
app/
├── _layout.tsx                 # Root layout — fonte, tema, providers
├── (auth)/                     # Rotas sem autenticação
│   ├── _layout.tsx
│   ├── index.tsx               # Splash / onboarding
│   ├── login.tsx
│   ├── cadastro/
│   │   ├── dados.tsx           # Etapa 1 — dados pessoais
│   │   ├── endereco.tsx        # Etapa 2 — endereço
│   │   ├── handle.tsx          # Etapa 3 — @handle
│   │   ├── pin.tsx             # Etapa 4 — criação de PIN
│   │   ├── seguranca.tsx       # Etapa 5 — perguntas de segurança
│   │   └── pix.tsx             # Etapa 6 — chave Pix
│   └── recuperar/
│       ├── seguranca.tsx       # Pergunta de segurança
│       ├── codigo.tsx          # Código SMS/email
│       └── novo-pin.tsx        # Novo PIN
├── (app)/                      # Rotas autenticadas
│   ├── _layout.tsx             # Bottom nav + auth guard
│   ├── index.tsx               # Home
│   ├── receber.tsx
│   ├── carregar.tsx
│   ├── descarregar.tsx
│   ├── split/
│   │   ├── index.tsx           # Lista de splits ativos
│   │   ├── criar.tsx           # Criar novo split
│   │   ├── [id].tsx            # Detalhe do split
│   │   └── fechar/[id].tsx     # Fechar split variável
│   ├── spaces/
│   │   ├── index.tsx           # Explorar + Meus Spaces
│   │   ├── [id].tsx            # Detalhe do Space
│   │   ├── criar-evento/[id].tsx
│   │   └── gerenciar/[id].tsx  # Gestão (dono/gestor)
│   ├── achar.tsx
│   ├── atividade.tsx
│   └── perfil/
│       ├── index.tsx
│       ├── dados.tsx
│       ├── seguranca.tsx
│       ├── notificacoes.tsx
│       └── kyc.tsx             # Status e envio de documentos
```

### 2.2 Bottom nav

| Posição | Label | Ícone | Rota |
|---|---|---|---|
| 1 | Perfil | pessoa | /perfil |
| 2 | Achar | lupa | /achar |
| 3 | Spaces | grid/comunidade | /spaces |
| 4 | Atividade | lista/histórico | /atividade |

**Regra:** Bottom nav visível em todas as rotas `(app)/` exceto fluxos modais
(Receber, Carregar, Split criar, Descarregar).

---

## 3. Gerenciamento de estado — Zustand stores

### 3.1 auth.store.ts
```typescript
interface AuthStore {
  user: User | null
  token: string | null
  kycStatus: 'pending' | 'submitted' | 'approved' | 'rejected'
  isAuthenticated: boolean
  login: (credentials) => Promise<void>
  logout: () => void
  refreshToken: () => Promise<void>
}
```

### 3.2 balance.store.ts
```typescript
interface BalanceStore {
  available: number        // Saldo disponível em Albers
  blocked: number          // Saldo bloqueado em splits
  total: number            // available + blocked
  fetch: () => Promise<void>
}
```

### 3.3 split.store.ts
```typescript
interface SplitStore {
  splits: Split[]
  activeSplit: Split | null
  create: (data: CreateSplitDTO) => Promise<void>
  fetch: () => Promise<void>
  close: (id: string, allocations: Allocation[]) => Promise<void>
}
```

### 3.4 spaces.store.ts
```typescript
interface SpacesStore {
  mySpaces: Space[]
  exploring: Space[]
  currentSpace: Space | null   // Space ativo na Home
  fetch: () => Promise<void>
  setCurrentSpace: (id: string) => void
}
```

### 3.5 notifications.store.ts
```typescript
interface NotificationsStore {
  unread: number
  notifications: Notification[]
  fetch: () => Promise<void>
  markRead: (id: string) => void
}
```

---

## 4. Autenticação e sessão

- Token JWT armazenado em `expo-secure-store` — nunca em AsyncStorage
- Refresh token com rotação automática
- Expiração de sessão: 30 dias com uso ativo
- Sessão inativa por 15 minutos em foreground → solicita PIN novamente
- App em background por mais de 5 minutos → solicita PIN ao retornar
- Auth guard implementado no `(app)/_layout.tsx` — redireciona para login se não autenticado

---

## 5. Segurança no frontend

- PIN nunca trafega em texto puro — hash SHA-256 antes de enviar ao BFF
- Teclado PIN sempre scrambled par-a-par — posições randomizadas a cada render
- Perguntas de segurança — respostas hasheadas localmente antes de enviar
- Screenshots bloqueadas nas telas de PIN e confirmação de segurança
  (`FLAG_SECURE` no Android, `.allowsRecording = false` no iOS)
- Dados sensíveis nunca em logs ou crash reports

---

## 6. Deep links

| Rota | Formato | Uso |
|---|---|---|
| Space público | `alber://spaces/[id]` | Compartilhamento de Space |
| Evento | `alber://spaces/[id]/evento/[eventId]` | Compartilhamento de evento |

> Split não tem mais deep link de convite — participantes são fixados na
> criação (ver `specs/06_modules/split.md` §1).

---

## 7. Permissões do sistema

| Permissão | Quando solicitar | Obrigatória |
|---|---|---|
| Contatos | Primeira vez que abre Split | Não — degradação graciosa |
| Camera | Primeira tentativa de KYC | Sim para KYC |
| Notificações push | Após onboarding completo | Não — mas bloqueia features |
| Biometria | Opcional no Perfil (futuro) | Não |

**Regra:** nunca solicitar múltiplas permissões ao mesmo tempo. Uma por vez,
com contexto claro do motivo.

---

## 8. Tratamento de estados obrigatórios

Todo componente de dados deve implementar os 5 estados:

| Estado | Comportamento |
|---|---|
| `loading` | Skeleton ou spinner contextual |
| `success` | Dados renderizados |
| `error` | Mensagem + botão de retry |
| `empty` | Ilustração + CTA contextual |
| `disabled` | Visual bloqueado + explicação |

---

## 9. Performance e boas práticas

- Listas longas: `FlashList` (Shopify) em vez de `FlatList`
- Imagens: `expo-image` com cache e lazy loading
- Evitar re-renders: `useCallback` e `useMemo` nos componentes de lista
- Fontes: pré-carregadas no splash com `expo-font`
- Splash screen: mantida até auth verificada e dados iniciais carregados

---

## 10. Analytics — eventos obrigatórios

Registrar nos pontos críticos de cada fluxo:

| Evento | Trigger |
|---|---|
| `onboarding_started` | Abre app pela primeira vez |
| `onboarding_completed` | Cadastro finalizado |
| `kyc_submitted` | Documentos enviados |
| `kyc_approved` | Webhook Asaas aprovado |
| `carregar_initiated` | Abre tela de carregar |
| `carregar_completed` | Pix confirmado via webhook |
| `receber_completed` | Transação processada |
| `split_created` | Split criado com sucesso |
| `split_joined` | Participante aderiu via link |
| `split_closed` | Dono fechou o split |
| `space_joined` | Usuário entrou em um Space |
| `event_purchased` | Ingresso comprado |

---

## 11. Build e deploy

```bash
# Desenvolvimento
npx expo start

# Build de produção
eas build --platform android --profile production
eas build --platform ios --profile production

# Submit para lojas
eas submit --platform android
eas submit --platform ios
```

**Profiles EAS:**
- `development` — dev client com hot reload
- `preview` — APK/IPA para QA interno
- `production` — build para lojas

---

## 12. Variáveis de ambiente

```env
EXPO_PUBLIC_BFF_URL=           # URL do Supabase BFF
EXPO_PUBLIC_SUPABASE_URL=      # URL do projeto Supabase
EXPO_PUBLIC_SUPABASE_ANON_KEY= # Chave pública Supabase
EXPO_PUBLIC_APP_ENV=           # development | staging | production
```

**Regra crítica:** nenhuma chave privada ou chave Asaas em variáveis
`EXPO_PUBLIC_*` — essas são expostas no bundle do app.

---

## 13. Internacionalização (i18n)

```json
// Dependências
"i18next": "^23+",
"react-i18next": "^14+",
"expo-localization": "latest"
```

**Estrutura de arquivos:**
```
locales/
├── pt-BR.json    ← MVP — português completo
└── es.json       ← próxima versão — espanhol (vazio no MVP)
```

**Regras obrigatórias:**
- NUNCA texto hardcoded no JSX — sempre via `t('chave')`
- Chaves organizadas por módulo: `split.create.title`, `home.balance.label`
- Pluralização via i18next para valores numéricos
- Idioma detectado automaticamente do dispositivo
- Fallback: pt-BR quando idioma não suportado

**Exemplo:**
```typescript
import { useTranslation } from 'react-i18next'

const { t } = useTranslation()
// ✅ correto
<Text>{t('home.balance.label')}</Text>
// ❌ nunca
<Text>Seu saldo</Text>
```
