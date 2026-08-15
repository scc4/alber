# Alber — Spec Integração Asaas
**Versão:** 1.0  
**Data:** 28/04/2026  
**Depende de:** 00_architecture.md, 03_backend.md

---

## 1. Visão geral

O Asaas é o BaaS do Alber operando sob modelo White Label. Toda comunicação
com o Asaas acontece exclusivamente no BFF — nunca no app mobile.

**Base URL Sandbox:** `https://sandbox.asaas.com/api/v3`  
**Base URL Produção:** `https://api.asaas.com/api/v3`  
**Autenticação:** Header `access_token: $ASAAS_API_KEY`

---

## 2. Modelo de contas

```
Conta Pai Alber
├── Subconta Usuário A (White Label)
├── Subconta Usuário B (White Label)
└── Subconta Space PJ (White Label)
```

---

## 3. Período de avaliação

| Restrição | Valor |
|---|---|
| Duração | 60 dias após criação |
| Limite por subconta | R$ 2.000 |
| Subcontas simultâneas | 10 |
| Resolução | Res. Conjunta nº 16/2025 BCB/CMN |

---

## 4. Endpoints utilizados

### 4.1 POST /accounts — Criar subconta
```typescript
{
  name, email, cpfCnpj, birthDate, companyType,
  phone, mobilePhone, address, addressNumber,
  complement, province, postalCode,
  webhooks: [{
    url, email, apiVersion: 'v3', enabled: true,
    authToken: string,
    events: ['PAYMENT_CONFIRMED','PAYMENT_RECEIVED',
             'PAYMENT_REFUNDED','TRANSFER_DONE','TRANSFER_FAILED']
  }]
}

// Response: { id, apiKey, walletId, ... }
// ⚠️ apiKey da subconta deve ser armazenado criptografado
```

### 4.2 POST /payments — QR Code Pix dinâmico
```typescript
// Header: access_token da subconta
{
  customer: string,
  billingType: 'PIX',
  value: number,
  dueDate: string,           // hoje + 30min
  description: 'Carregamento Alber',
  externalReference: string  // transaction_id para idempotência
}

// Após criar: GET /payments/{id}/pixQrCode
// Response: { encodedImage, payload, expirationDate }
```

### 4.3 Webhook PAYMENT_CONFIRMED — validação de CPF
```typescript
{
  event: 'PAYMENT_CONFIRMED',
  payment: {
    id, status, value, confirmedDate,
    pixTransaction: {
      payer: {
        cpfCnpj: string  // ⚠️ CONFIRMAR DISPONIBILIDADE COM ASAAS
      }
    }
  }
}

// cpfCnpj divergente → POST /payments/{id}/refund
```

### 4.4 POST /transfers — Transferências entre subcontas
```typescript
// Usado para: Receber (A→B), Split fechamento, Evento pago
{
  value: number,
  walletId: string,          // walletId da subconta destino
  description?: string,
  externalReference: string
}
```

### 4.5 POST /transfers — Cash out (Pix externo)
```typescript
{
  value: number,
  pixAddressKey: string,
  pixAddressKeyType: string, // 'CPF' | 'PHONE' | 'EMAIL' | 'EVP'
  description: 'Descarregamento Alber',
  externalReference: string
}
```

### 4.6 POST /payments/{id}/refund — Devolução Pix
```typescript
{ value: number, description: string }
```

### 4.7 POST /myAccount/documents — KYC
```typescript
// multipart/form-data
{ type: 'IDENTIFICATION', documentFile, documentFileBack }
{ type: 'SELFIE', documentFile }

// Status: GET /myAccount/documents
```

### 4.8 GET /finance/balance — Saldo da subconta
```typescript
// Header: access_token da subconta
// Response: { balance: number }
```

---

## 5. Mapeamento Albers ↔ R$

```
Paridade MVP: 1 Alber = R$ 1,00
Cotação configurável via painel admin (escopo futuro)
```

---

## 6. Idempotência

```typescript
// Padrão obrigatório em todas as chamadas financeiras:
const transaction_id = crypto.randomUUID()
// 1. Inserir transação status 'pending'
// 2. Chamar Asaas com externalReference = transaction_id
// 3. Atualizar status conforme resposta
// 4. Webhook: se já 'completed' → ignorar
```

---

## 7. Tratamento de erros

| HTTP | Significado | Ação |
|---|---|---|
| 400 | Dados inválidos | Retornar erro ao app |
| 401 | API key inválida | Alertar — erro crítico |
| 409 | Duplicata | Verificar idempotência |
| 429 | Rate limit | Retry exponential backoff (3x) |
| 500 | Erro Asaas | Registrar, retry 1x, alertar |

---

## 8. White Label — requisitos de ativação

| Requisito | Status |
|---|---|
| White Label habilitado na conta | ⚠️ Requer aprovação gerente de contas |
| Sandbox sem aprovação | ✅ |
| Produção requer habilitação manual | ⚠️ Solicitar antes do go-live |
| Playbook de adequação de branding | ⚠️ Via gerente de contas |

---

## 9. Pendências críticas — confirmar com Asaas

| Item | Impacto |
|---|---|
| `pixTransaction.payer.cpfCnpj` disponível no webhook | Bloqueante para validação CPF |
| Taxa Asaas sobre transferências internas | Impacta cálculo de margem |
| Limite de transferências subconta/dia | Impacta volume Split e Receber |
| Prazo médio aprovação KYC produção | Impacta UX período de avaliação |
| Prazo habilitação White Label produção | Impacta cronograma go-live |
| `POST /accounts` aceita `cpfCnpj` alfanumérico (CNPJ novo formato, IN RFB 2.229/2024, emissão iniciada em 31/07/2026)? | Bloqueante para abrir conta PJ com CNPJ alfanumérico — nosso validador já aceita (`_shared/cnpj.ts`), mas não confirmamos se o Asaas já processa esse formato na criação de subconta |
