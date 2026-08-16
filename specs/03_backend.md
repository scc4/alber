# Alber — Spec Backend (BFF)
**Versão:** 1.0  
**Data:** 28/04/2026  
**Depende de:** 00_architecture.md, 04_api_asaas.md

---

## 1. Visão geral

O BFF (Backend for Frontend) do Alber é a única camada que se comunica
com o Asaas. O app mobile nunca chama a API Asaas diretamente. O BFF
também é responsável por todas as regras de negócio, validações,
retenção de taxas e webhooks.

**Tecnologia:** Supabase (PostgreSQL + Edge Functions + Auth + Storage)

---

## 2. Estrutura do Supabase

```
supabase/
├── functions/
│   ├── auth/
│   │   ├── register.ts
│   │   ├── login.ts
│   │   └── refresh.ts
│   ├── users/
│   │   ├── profile.ts
│   │   ├── handle.ts
│   │   └── pix-key.ts
│   ├── financial/
│   │   ├── balance.ts
│   │   ├── carregar.ts
│   │   ├── descarregar.ts
│   │   └── receber.ts
│   ├── split/
│   │   ├── create.ts
│   │   ├── join.ts
│   │   ├── close.ts
│   │   └── invite.ts
│   ├── spaces/
│   │   ├── list.ts
│   │   ├── join.ts
│   │   ├── manage.ts
│   │   └── events.ts
│   ├── webhooks/
│   │   ├── asaas-pix.ts
│   │   ├── asaas-kyc.ts
│   │   └── asaas-transfer.ts
│   └── admin/
│       └── rates.ts
├── migrations/
└── seed/
```

---

## 3. Modelo de dados

### 3.1 users
```sql
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id           UUID UNIQUE REFERENCES auth.users(id),
  asaas_account_id  TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  email             TEXT UNIQUE NOT NULL,
  cpf               TEXT UNIQUE NOT NULL,
  phone             TEXT NOT NULL,
  birth_date        DATE NOT NULL,
  handle            TEXT UNIQUE NOT NULL,
  handle_updated_at TIMESTAMPTZ,
  pix_key           TEXT,        -- chave de SAQUE escolhida pelo usuário (cpf/phone/email/random) — destino em /financial/descarregar. NUNCA usada para gerar QR de carregamento.
  pix_key_type      TEXT,
  asaas_deposit_key TEXT,        -- chave de RECEBIMENTO da própria subconta Asaas — sempre EVP, criada pelo backend (nunca pelo usuário) via POST /pix/addressKeys, usada em /financial/carregar. Ver §4.3.
  kyc_status        TEXT DEFAULT 'pending',
  account_status    TEXT DEFAULT 'evaluation',
  deleted_at        TIMESTAMPTZ, -- soft delete (§10.1 perfil.md) — separado de account_status de propósito
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
```

### 3.2 security_questions
```sql
CREATE TABLE security_questions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  question    TEXT NOT NULL,
  answer_hash TEXT NOT NULL,
  position    INT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### 3.3 transactions
```sql
CREATE TABLE transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES users(id),  -- sempre quem executou a ação, mesmo em transações de empresa
  company_id       UUID REFERENCES companies(id), -- NULL = transação pessoal; ver 3.10b
  type             TEXT NOT NULL,
  amount           NUMERIC(10,2) NOT NULL,
  amount_brl       NUMERIC(10,2),
  fee_amount       NUMERIC(10,2) DEFAULT 0,
  status           TEXT NOT NULL,
  asaas_payment_id TEXT,
  reference_id     UUID,
  reference_type   TEXT,
  metadata         JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT now()
);
```

### 3.4 splits
```sql
CREATE TABLE splits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID REFERENCES users(id),
  name              TEXT NOT NULL,
  type              TEXT NOT NULL,
  target_amount     NUMERIC(10,2) NOT NULL,
  invite_token      TEXT UNIQUE NOT NULL,
  invite_expires_at TIMESTAMPTZ NOT NULL,
  max_participants  INT,
  status            TEXT DEFAULT 'open',
  closed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);
```

### 3.5 split_participants
```sql
CREATE TABLE split_participants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  split_id       UUID REFERENCES splits(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(id),
  status         TEXT DEFAULT 'pending',
  blocked_amount NUMERIC(10,2) DEFAULT 0,
  final_amount   NUMERIC(10,2),
  joined_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(split_id, user_id)
);
```

### 3.6 spaces
```sql
CREATE TABLE spaces (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  type             TEXT NOT NULL,
  owner_id         UUID REFERENCES users(id),
  asaas_account_id TEXT,
  skin             JSONB DEFAULT '{}',
  status           TEXT DEFAULT 'active',
  created_at       TIMESTAMPTZ DEFAULT now()
);
```

### 3.7 space_members
```sql
CREATE TABLE space_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id   UUID REFERENCES spaces(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id),
  role       TEXT DEFAULT 'member',
  status     TEXT DEFAULT 'pending',
  joined_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(space_id, user_id)
);
```

### 3.8 events
```sql
CREATE TABLE events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id     UUID REFERENCES spaces(id) ON DELETE CASCADE,
  creator_id   UUID REFERENCES users(id),
  name         TEXT NOT NULL,
  description  TEXT,
  image_url    TEXT,
  date         TIMESTAMPTZ NOT NULL,
  visibility   TEXT NOT NULL,
  is_paid      BOOLEAN DEFAULT false,
  price_brl    NUMERIC(10,2),
  price_albers NUMERIC(10,2),
  status       TEXT DEFAULT 'active',
  created_at   TIMESTAMPTZ DEFAULT now()
);
```


### 3.8b event_batches
```sql
CREATE TABLE event_batches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID REFERENCES events(id) ON DELETE CASCADE,
  batch_number INT NOT NULL,
  batch_type   TEXT NOT NULL,           -- 'quantity' | 'date'
  price_brl    NUMERIC(10,2) NOT NULL,
  capacity     INT NOT NULL,
  sold         INT DEFAULT 0,
  valid_until  TIMESTAMPTZ,
  status       TEXT DEFAULT 'pending',  -- 'pending'|'active'|'sold_out'|'expired'
  created_at   TIMESTAMPTZ DEFAULT now()
);
```

### 3.8c event_tickets
```sql
CREATE TABLE event_tickets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID REFERENCES events(id),
  batch_id     UUID REFERENCES event_batches(id),
  user_id      UUID REFERENCES users(id),
  price_brl    NUMERIC(10,2),
  price_albers NUMERIC(10,2),
  status       TEXT DEFAULT 'confirmed', -- 'confirmed' | 'refunded'
  purchased_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.9 rates
```sql
CREATE TABLE rates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       TEXT UNIQUE NOT NULL,
  rate       NUMERIC(5,4) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES users(id)
);
```

### 3.10b companies
```sql
CREATE TABLE companies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID NOT NULL REFERENCES users(id),  -- master, acesso total implícito
  asaas_account_id  TEXT UNIQUE NOT NULL,
  cnpj              TEXT NOT NULL,       -- hash SHA-256, único entre linhas com deleted_at IS NULL
  handle            TEXT NOT NULL,       -- único entre linhas com deleted_at IS NULL, cruza com users.handle na aplicação
  company_name      TEXT NOT NULL,
  trading_name      TEXT,
  company_type      TEXT NOT NULL,       -- MEI | LIMITED | INDIVIDUAL | ASSOCIATION
  pix_key           TEXT,                -- chave de SAQUE, configurável uma única vez pelo master
  pix_key_type      TEXT,
  asaas_deposit_key TEXT,                -- chave de RECEBIMENTO, sempre EVP, mesmo padrão de users.asaas_deposit_key
  kyc_status        TEXT DEFAULT 'pending',
  account_status    TEXT DEFAULT 'evaluation',
  deleted_at        TIMESTAMPTZ,         -- KYC rejeitado (automático) ou company-abandon (manual) — ver 06_modules/empresa_operadores.md §8
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
```

### 3.10c company_operators
```sql
CREATE TABLE company_operators (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id),
  status      TEXT DEFAULT 'pending',   -- pending | active | banned | invited ('banned' = removido via company-operator-remove, reversível por reconvite)
  permissions JSONB DEFAULT '{}',       -- matriz por funcionalidade, fail-closed — chaves em _shared/company-permissions.ts
  joined_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, user_id)
);
```
Master nunca aparece nesta tabela. Detalhe completo do fluxo de convite,
matriz de permissões e edição pelo master em 06_modules/empresa_operadores.md.

### 3.10d company_invites
```sql
CREATE TABLE company_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  permissions JSONB DEFAULT '{}',       -- aplicadas ao aceitar, via auth-register
  status      TEXT DEFAULT 'pending',   -- pending | consumed | revoked
  expires_at  TIMESTAMPTZ NOT NULL,     -- 7 dias
  created_by  UUID REFERENCES users(id),
  consumed_by UUID REFERENCES users(id)
);
```
Convite por link, para quem ainda não tem `users.id` — diferente do convite
por @handle, que já cria a linha direto em `company_operators`.

### 3.10 audit_logs
```sql
CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  event_type  TEXT NOT NULL,
  ip_address  TEXT,
  device_info JSONB,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

---

## 4. Edge Functions — contratos de API

### 4.1 POST /auth/register
```typescript
// Request
{
  name: string
  email: string
  cpf: string
  birth_date: string
  phone: string
  address: AddressDTO
  handle: string
  pin_hash: string
  security_questions: [{ question: string; answer_hash: string }] // x4
  pix_key: string       // chave de SAQUE — ver nota abaixo
  pix_key_type: string
  terms_accepted: boolean
}

// Response 201
{ user_id, token, refresh_token, kyc_status, account_status }

// Errors
// 409 CPF_DUPLICATE | 409 HANDLE_TAKEN | 422 CPF_INVALID | 503 ASAAS_ERROR
```

**Nota — dois conceitos de chave Pix (não confundir):**
`pix_key`/`pix_key_type` acima é a chave de **saque** informada pelo usuário
neste formulário (cpf/phone/email/random) — usada só como destino em
`POST /financial/descarregar` (§4.4). Ela nunca é, e nunca deve ser, registrada
como chave Pix na Asaas.

Separadamente, o backend registra uma chave de **recebimento** própria da
subconta na Asaas — sempre EVP (aleatória), nunca escolhida pelo usuário —
logo após criar a subconta nesta mesma chamada (best-effort: se a Asaas ainda
não permitir o registro nesse momento, ex. KYC pendente, fica para o fallback
em `webhooks-asaas-kyc`/`financial-carregar`, ver §4.3). Essa chave é salva em
`users.asaas_deposit_key` (§3.1) e é a usada para gerar o QR code de
carregamento — nunca `pix_key`.

### 4.2 POST /auth/login
```typescript
// Request
{ cpf: string; pin_hash: string; security_answer_hash: string }

// Response 200
{ token, refresh_token, user: UserDTO }

// Errors: 401 credenciais inválidas | 429 tentativas excedidas
```

### 4.3 POST /financial/carregar
```typescript
// Request
{ amount_albers: number }

// Response 201
{ qr_code, qr_code_image, expires_at, payment_id }
```
Gera um QR code Pix **estático** (`createPixStaticQrCode`, não o fluxo
dinâmico via `/payments` descrito em §4_api_asaas) vinculado à chave de
**recebimento** da própria subconta (`users.asaas_deposit_key`, sempre EVP —
nunca `pix_key`, que é a chave de saque do usuário, ver nota em §4.1).

Se `asaas_deposit_key` ainda não existir (conta criada antes desta correção,
ou o registro no cadastro falhou), este endpoint cria a chave EVP na hora
(`createPixAddressKey('EVP', ...)`) e grava em `users.asaas_deposit_key` antes
de gerar o QR — mesmo fallback usado em `webhooks-asaas-kyc` na aprovação do KYC.

Erros: `403 KYC_REQUIRED` | `422 EVALUATION_LIMIT` | `503 ACCOUNT_NOT_CONFIGURED`
| `503 PIX_KEY_FAILED` (falha ao registrar a chave de recebimento) | `503 ASAAS_ERROR`

### 4.4 POST /financial/descarregar
```typescript
// Request
{ amount_albers: number; pin_hash: string; security_answer_hash: string }

// Validações: PIN, segurança, saldo, chave Pix, CPF, taxa

// Response 200
{ transaction_id, amount_sent, fee, pix_key, status: 'processing' }
```
`pix_key` aqui é a chave de **saque** (`users.pix_key`/`pix_key_type`,
escolhida pelo usuário no cadastro ou em Perfil) — usada como destino externo
de `POST /transfers` na Asaas. Não precisa estar registrada na própria
subconta (diferente da chave de recebimento usada em §4.3).

### 4.5 POST /financial/receber
```typescript
// Request
{
  amount_albers: number
  payer_identifier: string
  payer_pin_hash: string
  payer_security_answer_hash: string
}

// Response 200
{ transaction_id, amount_received, fee, payer_name, status: 'completed' }
```

### 4.6 POST /split/create
```typescript
// Request
{ name, type, target_amount, max_participants?, invite_expires_at }

// Response 201
{ split_id, invite_token, invite_link, invite_expires_at }
```

### 4.7 POST /split/join
```typescript
// Request
{ invite_token: string }

// Response 200
{ split_id, blocked_amount, status: 'accepted' }

// Errors: 402 INSUFFICIENT_BALANCE | 410 INVITE_EXPIRED
```

### 4.8 POST /split/close
```typescript
// Request
{ split_id: string; allocations: [{ user_id, amount }] }

// Response 200
{ split_id, status: 'closed', transactions: TransactionDTO[] }
```


### 4.6 POST /financial/transferir
```typescript
// Request
{
  destinatario_identifier: string   // CPF, @handle ou e-mail
  amount_albers: number
  pin_hash: string
  security_answer_hash: string
}

// Validações:
// 1. Localizar destinatário
// 2. Remetente ≠ destinatário
// 3. Validar PIN e segurança
// 4. Verificar saldo suficiente (sem taxa)
// 5. Debitar remetente, creditar destinatário
// 6. Registrar 2 transações: transferir_enviado + transferir_recebido

// Response 200
{ transaction_id, amount, destinatario_handle, novo_saldo }
```

### 4.9 POST /conta-excluir

Spec completa: `06_modules/perfil.md §10.1`. Soft delete — ver §3.1 para o
campo `deleted_at`.

```typescript
// Request (checagem — só JWT, sem PIN)
{ action: 'status' }

// Response 200
{ eligible: boolean, balance_brl: number, blocks: {
  positive_balance, owns_active_split, owns_active_lounge, active_split_participation
} }

// Request (efetivar)
{ action: 'confirm', pin_hash: string, security_answer_hash: string, sms_code: string }

// Response 200
{ success: true }

// Errors
// 409 ALREADY_DELETED | 422 NOT_ELIGIBLE | 401 INVALID_CREDENTIALS |
// 401 WRONG_SECURITY_ANSWER | 401 SMS_EXPIRED | 401 SMS_INVALID
```

---

## 5. Regras de negócio críticas

### 5.1 Retenção de taxas
```
Receber:    valor_recebido = amount * (1 - rates.receber)
Descarregar: valor_enviado = amount * (1 - rates.cashout)
Evento:     fee = price_albers * rates.event
Fee → transação tipo 'fee' na conta pai Alber
```

### 5.2 Cooldown de @handle
```
handle_updated_at + 30 days > now() → rejeitar troca
Handle antigo em quarentena 30 dias após troca
```

### 5.3 Bloqueio de saldo no Split variável
```
blocked = target_amount / max_participants
Adesão:     saldo_disponível -= blocked; saldo_bloqueado += blocked
Fechamento: saldo_bloqueado -= blocked; saldo_disponível += (blocked - final_amount)
Débito:     saldo_disponível -= final_amount
```

### 5.4 Validação de CPF no Pix
```
cpf_pagador != users.cpf WHERE asaas_account_id = payment.account
→ devolução automática via Asaas API
→ registrar tentativa com CPF divergente
```

---

## 6. Segurança do BFF

- JWT validado em todas as Edge Functions
- Rate limiting por user_id em operações financeiras
- Webhooks Asaas validados por assinatura HMAC
- CPF armazenado com hash — nunca texto puro
- PIN nunca chega em texto puro — apenas SHA-256
- Respostas de segurança com bcrypt (cost 12)
- RLS ativo em todas as tabelas
- Logs de auditoria para operações financeiras e alterações sensíveis

---

## 7. Variáveis de ambiente do BFF

```env
ASAAS_API_KEY=                # também usado como secret de criptografia de asaas_api_key_enc
ASAAS_WEBHOOK_SECRET=
ASAAS_ENVIRONMENT=           # sandbox | production
ASAAS_PARENT_ACCOUNT_ID=
ASAAS_PARENT_WALLET_ID=
ENCRYPTION_KEY=               # secret de criptografia de pix_key e asaas_deposit_key (distinto de ASAAS_API_KEY — ver §3.1)
SUPABASE_SERVICE_ROLE_KEY=
JWT_SECRET=
PIX_EXPIRATION_MINUTES=30
CRON_SECRET=                  # autentica chamadas do scheduler a cron-activate-batches
```
