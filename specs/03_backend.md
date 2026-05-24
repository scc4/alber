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
  pix_key           TEXT,
  pix_key_type      TEXT,
  kyc_status        TEXT DEFAULT 'pending',
  account_status    TEXT DEFAULT 'evaluation',
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
  user_id          UUID REFERENCES users(id),
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
  pix_key: string
  pix_key_type: string
  terms_accepted: boolean
}

// Response 201
{ user_id, token, refresh_token, kyc_status, account_status }

// Errors
// 409 CPF_DUPLICATE | 409 HANDLE_TAKEN | 422 CPF_INVALID | 503 ASAAS_ERROR
```

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

### 4.4 POST /financial/descarregar
```typescript
// Request
{ amount_albers: number; pin_hash: string; security_answer_hash: string }

// Validações: PIN, segurança, saldo, chave Pix, CPF, taxa

// Response 200
{ transaction_id, amount_sent, fee, pix_key, status: 'processing' }
```

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
ASAAS_API_KEY=
ASAAS_WEBHOOK_SECRET=
ASAAS_ENVIRONMENT=           # sandbox | production
ASAAS_PARENT_ACCOUNT_ID=
SUPABASE_SERVICE_ROLE_KEY=
JWT_SECRET=
PIX_EXPIRATION_MINUTES=30
```
