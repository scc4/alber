# Alber — Spec Módulo Food Company Service (API de serviço para o Alber Food)
**Versão:** 1.0
**Data:** 04/11/2026
**Depende de:** 00_architecture.md §4.1, 03_backend.md, 04_api_asaas.md, 05_security.md §7.1, 06_modules/empresa_operadores.md
**Status:** Implementado e mesclado no `main` (04/11/2026, vindo da branch `claude/fase1-api-servico-944c65`, sem push); **nada publicado** (nem migration 058, nem funções, nem segredo). O corte é único, depois (ver §10).
**Contraparte:** Alber Food, fase 2 (identidade do dono). Plano e desenho: `docs/plano-separacao-pf-pj.md` e `specs/phases/4_identidade_financeira_e_saque.md` no repositório do Alber Food.

---

## 1. Visão geral

O dono de um restaurante do Alber Food **não tem usuário no Alber**. A empresa (subconta PJ do Asaas) conhece só uma referência opaca dele, `companies.owner_ref` (o id da conta no Alber Food). O Alber atua como **backend de dinheiro**: guarda as chaves das subcontas, abre a subconta, controla o KYC, aplica a guarda de saque e os limites, e executa o Pix de saque. Identidade, login, papéis e telas ficam no Alber Food.

Princípios:

- **Uma única saída de dinheiro:** Pix de saque para a chave cadastrada da empresa. Não existe `carregar`, `transferir` nem `receber` para essas empresas. As funções do app (`financial-*`, `company-*` com JWT) continuam como estão e **não conseguem operar** uma empresa do Alber Food (não há master nem operador em `users`: `requireCompanyPermission` recusa; ver teste `_shared/food-company.test.ts`).
- **Chave de serviço não basta para sacar:** saque, chave Pix de saque e troca de titular exigem uma **autorização assinada** (§3) que só o Alber Food consegue produzir depois de passar pelos controles dele (sessão, PIN, pergunta, código por e-mail).
- **Mundo pessoa física intacto:** nada do comportamento de `users`, `auth-*`, `financial-*` e `company-*` mudou. Os únicos ajustes nele são tolerâncias a `owner_id`/`user_id` nulos (§8).

## 2. Convenções das chamadas

| Item | Valor |
|---|---|
| Método | `POST`, corpo JSON (objeto). Outros métodos: `405 METHOD_NOT_ALLOWED`; corpo inválido: `400 INVALID_BODY` |
| Autenticação | cabeçalho `x-alber-food-key` = segredo `ALBER_FOOD_SERVICE_KEY` (comparação em tempo constante). Ausente/errado: `401 UNAUTHORIZED`; segredo não configurado (ou < 32 caracteres): `503 SERVICE_NOT_CONFIGURED` |
| JWT | **sem JWT de usuário.** `verify_jwt` fica no padrão (**ligado**), igual às `takeaway-*`: o Alber Food manda `apikey` e `Authorization: Bearer <anon key>` do projeto (como já faz no `HttpPaymentGateway`). Publicar **sem** `--no-verify-jwt`. A autenticação real é a chave de serviço |
| Valores | **centavos inteiros** (`amount_cents`, `balance_cents`). 1 Alber = R$ 1,00. Exceção: os limites de saque ficam em **reais** (`per_tx_brl`, `per_day_brl`), como em `company-limit-request` e `company-list` |
| Sucesso | `json({...})` com 200 (201 onde indicado) |
| Erro | `{ error, code, message, ...extra }` (mesmo código em `error` e `code`), via `err(code, message, status, extra)` |
| Ordem das verificações | chave de serviço → corpo → dono (`owner_ref` igual a `companies.owner_ref`, senão `403 NOT_OWNER`) → (operações assinadas) autorização → reserva → regras de negócio |
| Empresa | inexistente ou com `deleted_at`: `404 COMPANY_NOT_FOUND`. Empresa aberta pelo app (sem `owner_ref`): `403 NOT_OWNER`. **Exceção:** `food-company-abandon` responde `404 COMPANY_NOT_FOUND` também para dono errado e para empresa do app (§4.8) |
| Ids | `company_id` UUID (`422 INVALID_COMPANY`); `owner_ref` texto de 1 a 128 caracteres ASCII sem espaço (`422 INVALID_OWNER`) |

## 3. Autorização assinada (`op`)

Verificador: `supabase/functions/_shared/food-op.ts`. Usada por `food-company-withdraw`, `food-company-set-pix-key` e `food-company-owner-transfer`.

### 3.1 Formato

Objeto `op` no corpo da chamada e cabeçalho `x-food-op-signature: v1=<hex do HMAC-SHA256 do JSON canônico de op>`.

| Campo | Tipo | Regra |
|---|---|---|
| `kind` | `'withdraw' \| 'set_pix_key' \| 'owner_transfer'` | tem de ser o da função chamada |
| `company_id` | UUID | igual ao do corpo |
| `owner_ref` | texto | igual ao do corpo (`owner_ref`; na troca de titular, `from_owner_ref`) |
| `amount_cents` | inteiro > 0 | **só `withdraw`** (obrigatório); igual ao do corpo |
| `destination_digest` | 64 hex minúsculos | **`withdraw`: obrigatório**, igual a `SHA-256 hex de "${company_id}|${chave Pix em claro guardada}"`; **`set_pix_key`: opcional**, ver §4.5; `owner_transfer`: ausente |
| `new_owner_ref` | texto | **só `owner_transfer`** (obrigatório); igual a `to_owner_ref` do corpo |
| `nonce` | `[A-Za-z0-9_-]{16,64}` | nunca visto antes |
| `issued_at` | ISO 8601 com fuso (`2026-11-10T12:00:00.000Z`) | no máximo 60 s à frente do relógio do Alber |
| `expires_at` | ISO 8601 | `0 < expires_at − issued_at ≤ 120 s` e ainda não vencida |
| `idempotency_key` | 8 a 64 caracteres ASCII visíveis | repetir devolve o resultado original |

Campos que o tipo não prevê, ou desconhecidos, tornam a autorização inválida (cada tipo carrega só o que lhe cabe: uma autorização de saque não serve de troca de titular).

### 3.2 Assinatura

> **ATENÇÃO — o segredo é DECODIFICADO.** `FOOD_OP_SIGNING_KEY` é um segredo em **hexadecimal (64 ou mais caracteres, tamanho par)** ou em **base64**, com **no mínimo 32 bytes** depois de decodificado. A **chave do HMAC-SHA256 são os BYTES decodificados**, e **nunca** a string do segredo (`new TextEncoder().encode(segredo)` está errado). Assinar com a string produz uma assinatura diferente e toda operação assinada volta `403 INVALID_AUTHORIZATION`, sem pista do motivo. Regra de decodificação, igual nos dois lados: se o texto é só hexadecimal, tamanho par e tem 64+ caracteres, é hexadecimal; senão é base64 (padrão ou url-safe). Segredo que não decodifica para 32+ bytes é rejeitado (`503 SERVICE_NOT_CONFIGURED`). O vetor de teste de §3.3 usa a mesma chave de 32 bytes em hexadecimal e em base64 e dá a mesma assinatura: confira o assinador do Alber Food com ele antes de integrar.

- **JSON canônico:** chaves em ordem alfabética (recursivo), sem espaços, valores como `JSON.stringify` escreve; `undefined` some. Dados em UTF-8.
- **Segredo `FOOD_OP_SIGNING_KEY`:** ver o aviso acima (decodificado; os bytes são a chave do HMAC).
- A comparação é em tempo constante (`crypto.subtle.verify`).

### 3.3 Vetor de teste (confira o assinador do Alber Food com ele; está em `_shared/food-op.test.ts`)

```
segredo (hex)   000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
segredo (b64)   AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=      (os mesmos 32 bytes)
digest          SHA-256 hex de "11111111-1111-4111-8111-111111111111|11222333000181"
                = 00741111dadb7014c4a789aa8ee428fb274debb4e0dd3354e5ec06ac40351226
canônico        {"amount_cents":150000,"company_id":"11111111-1111-4111-8111-111111111111","destination_digest":"00741111dadb7014c4a789aa8ee428fb274debb4e0dd3354e5ec06ac40351226","expires_at":"2026-11-10T12:01:30.000Z","idempotency_key":"chal_7f3a9c1e-0b52-4c1d-9d11-aa01","issued_at":"2026-11-10T12:00:00.000Z","kind":"withdraw","nonce":"Zm9vZC1vcC1ub25jZS0wMDAx","owner_ref":"22222222-2222-4222-8222-222222222222"}
assinatura      v1=6e0f446afeb74f118f186759351d1f4a9c75b28bdfebd2d2198bde14a7015a18
```

### 3.4 O que o Alber confere, nesta ordem

1. `FOOD_OP_SIGNING_KEY` válida (senão `503 SERVICE_NOT_CONFIGURED`: não opera sem poder conferir).
2. Cabeçalho presente e no formato `v1=<64 hex>`.
3. **Assinatura** sobre o objeto como chegou.
4. Formato do objeto (tabela de §3.1).
5. **Validade:** vida de no máximo 120 s, não vencida (`agora < expires_at`), não emitida no futuro além de 60 s de tolerância de relógio.
6. **Amarração:** `kind`, `company_id`, `owner_ref`, e por tipo: `amount_cents` do corpo (saque), `destination_digest` (saque: digest da chave que o **Alber** guarda; chave Pix: digest da chave do corpo), `new_owner_ref` (troca de titular).
7. **Nonce e idempotência** (tabela `food_ops`, §6): reserva atômica antes de executar.

Qualquer falha de 2 a 7 devolve **a mesma resposta** `403 INVALID_AUTHORIZATION` ("Autorização da operação inválida"), sem dizer qual verificação falhou. O motivo vai só para `audit_logs` (`food_op_rejected`, com `reason`), nunca para a resposta.

### 3.5 Idempotência

`idempotency_key` e `nonce` são **únicos** em `food_ops`. Chave de idempotência sugerida ao Alber Food: o `challenge_id` do saque.

| Situação | Resposta |
|---|---|
| Operação nova | executa uma vez e guarda o desfecho (sucesso **ou** erro de negócio) |
| Mesma `idempotency_key` e mesmo conteúdo (mesmo nonce ou nonce novo, autorização ainda válida) | devolve o **desfecho original**, sem executar de novo. Vale mesmo que o estado da empresa tenha mudado depois |
| Mesma operação ainda em andamento | `409 OPERATION_IN_PROGRESS` |
| `idempotency_key` reaproveitada com outro valor/destino/empresa/tipo, ou `nonce` já usado por outra operação | `403 INVALID_AUTHORIZATION` |
| Falha passageira antes de qualquer efeito (`WITHDRAW_CHECK_FAILED`, falha do Asaas ao consultar saldo ou gerar chave, erro de banco) | a reserva é **desfeita**: a mesma operação pode tentar de novo |
| **Desfecho desconhecido** (o Pix foi enviado ao Asaas e a rede caiu sem resposta) | `503 ASAAS_ERROR` e a operação **fica `in_progress`**: repetir recebe `OPERATION_IN_PROGRESS`. O lançamento fica `pending` (com o id dele como `externalReference` no Asaas) para a equipe reconciliar. **Nunca** paga duas vezes |

## 4. Funções

Todas em `supabase/functions/<nome>/index.ts`, com testes ao lado (`index.test.ts`).

### 4.1 `food-company-create`

> **Atestado de liberação (05/11/2026, novo onboarding do Alber Food).** A criação passou a exigir `release` no corpo e o cabeçalho `x-food-release-signature: v1=<hex>` (HMAC-SHA256 do JSON canônico, mesma chave e mesma regra de bytes do `FOOD_OP_SIGNING_KEY`). Campos: `kind: "company_release"`, `request_id`, `owner_ref`, `cnpj_hash` e `cpf_hash` (SHA-256 hex dos dígitos), `decided_at`, `nonce`, `issued_at`, `expires_at` (no máximo 120 s). Significa "a equipe Alber conferiu este responsável contra este CNPJ" (plano: `docs/plano-onboarding-verificacao-manual.md` do Alber Food). Conferido contra o corpo (dono, CNPJ, CPF); qualquer falha dá `403 INVALID_AUTHORIZATION` sempre igual, com o motivo só em `audit_logs` (`food_op_rejected`, `kind: company_release`). Com o atestado o vínculo nasce `approved` (a conferência automática fica só como informação em `owner_link_check`). Sem nonce guardado: repetir o atestado só devolve a empresa já aberta. Código: `_shared/food-release.ts`.

Entrada: `{ owner_ref: uuid, owner: { cpf, name, phone, email? }, company: { cnpj, company_name, trading_name?, company_type: 'MEI'|'LIMITED'|'INDIVIDUAL'|'ASSOCIATION', email?, tax_regime?, address: { street, number, complement?, district, cep, city, state }, income_value: number, handle } }`

Saída `201`: `{ company_id, handle, kyc_status, account_status, onboarding_url|null, owner_link_check, owner_link_review }`.

- Reaproveita `createCompanyForOwner` (`_shared/company.ts`) com um dono do tipo `FoodCompanyOwner` (sem `users`): subconta, conferência do vínculo (dígitos 4 a 9 do CPF x quadro societário, BrasilAPI), disputa de CNPJ, subconta órfã nunca reaproveitada. O CPF (do cadastro da conta no Food) é validado e comparado, **não é guardado**; `owner.name`/`owner.email` são validados mas não usados. O insert grava `owner_id = NULL`, `owner_ref`, `origin = 'food'`.
- **Repetição do mesmo dono para o mesmo CNPJ** devolve a empresa existente (`200`), sem nova subconta.
- Limite: 5 aberturas por `owner_ref` a cada 15 minutos (`429 RATE_LIMITED`; auditoria `food_company_create_attempt`).
- Erros: `INVALID_OWNER` (422), `CPF_INVALID` (422), `MISSING_FIELDS` (400), `INVALID_COMPANY_TYPE`, `INVALID_TAX_REGIME`, `EMAIL_INVALID`, `COMPANY_HANDLE_INVALID` (400), `CNPJ_INVALID` (422), `COMPANY_HANDLE_TAKEN` (409), `CNPJ_DUPLICATE` (409, CNPJ já aprovado ou em análise), `CNPJ_UNDER_REVIEW` (409, pendente de outro dono), `CNPJ_IN_USE` (409, a subconta já existe no Asaas e não pode ser reaproveitada: fale com o suporte), `ASAAS_ERROR` (503), `DB_ERROR` (503).
- A chamada leva ~15 s quando o Asaas devolve a chave da subconta (espera pelo link de documentos). O cliente do Food deve ter timeout maior que isso (o `HttpPaymentGateway` usa 25 s).

### 4.2 `food-company-status`

Entrada: `{ company_id, owner_ref }`.

Saída: `{ company_id, handle, kyc_status, account_status, onboarding_url|null, owner_link_check, owner_link_review, pix_key: { configured, type: 'cnpj'|'random'|null, masked|null, digest|null, changed_at|null, available_at|null }, limits: { per_tx_brl, per_day_brl, source: 'default'|'approved' }, last_limit_request|null, withdraw: { allowed, code|null, message|null } }`.

- Empresa `pending`/`submitted`: consulta o Asaas (`pollCompanyKyc`, até 8 s; só aprova) e relê. Falha ou lentidão do Asaas não derrubam a leitura.
- `pix_key.masked`: CNPJ → 8 primeiros caracteres + `***`; aleatória → 8 primeiros + `...`. `digest` = `SHA-256 hex de "${company_id}|${chave}"` (é o que o Food usa em `destination_digest`). `changed_at` = quando foi cadastrada (qualquer tipo). `available_at` = fim da espera de 48 h (`pix_key_changed_at + 48 h`), **mesmo já vencida** (o Food compara com o relógio); existe também após troca de titular (sem chave configurada).
- `withdraw`: pré-checagem sem valor, na ordem em que o saque recusaria: `COMPANY_NOT_APPROVED`, `COMPANY_PIX_KEY_NOT_CONFIGURED`, depois a guarda (`OWNER_LINK_PENDING`, `OWNER_LINK_REJECTED`, `PIX_KEY_RECENTLY_CHANGED`). O limite por valor o Food compara com `limits`.
- `last_limit_request`: `{ id, status, requested_per_tx_brl, requested_per_day_brl, approved_per_tx_brl|null, approved_per_day_brl|null, created_at, decided_at|null }` (limites em reais).
- Nunca devolve chave Pix em claro, CNPJ, chave de subconta nem CPF.

### 4.3 `food-company-balance`

Entrada: `{ company_id, owner_ref }` → `{ balance_cents, generated_at }`. Só empresa aprovada (`409 COMPANY_NOT_APPROVED`); falha do Asaas: `502 BALANCE_PROVIDER_ERROR` (sem detalhe). O extrato continua em `takeaway-company-statement` (por `company_id`, sem `owner_ref`).

### 4.4 `food-company-withdraw`

Entrada: `{ company_id, owner_ref, amount_cents, op }` (+ `x-food-op-signature`). Saída `200`: `{ transaction_id, status: 'processing', amount_cents, destination_masked }`.

- `amount_cents`: inteiro de 1 000 (R$ 10, como `financial-descarregar`) a 50 000 000 (o maior limite que a equipe pode aprovar); senão `422 INVALID_AMOUNT`.
- Fluxo: dono → `COMPANY_PIX_KEY_NOT_CONFIGURED` (422) → autorização (amarrada ao valor e ao digest da chave que o Alber guarda) → reserva → **`COMPANY_NOT_APPROVED`** (409; empresa sem KYC aprovado, bloqueada ou sem chave de subconta) → **guarda de saque** (`checkCompanyWithdrawal`: vínculo, carência de 48 h da chave aleatória, limites por saque e por dia, inclusive o aprovado pela equipe; a soma do dia conta saques do Food e do app) → saldo na subconta (`INSUFFICIENT_BALANCE`, 422) → lançamento `pending` → **nova leitura da guarda** (fecha a corrida entre dois saques ao mesmo tempo: o que estourar o limite recua e fica `failed`) → Pix no Asaas.
- Lançamento: `transactions` com `company_id`, `actor_ref = owner_ref`, `user_id = NULL`, `type = 'descarregar'` (entra na soma do limite diário), `status = 'processing'` com `asaas_payment_id`. O webhook `TRANSFER_DONE`/`TRANSFER_FAILED` do Asaas leva a `completed`/`failed` (sem push, pois não há usuário). A resposta devolve sempre `processing`; o desfecho final não é enviado ao Food (ver §9, ponto 5).
- **Sem taxa.** A regra fica num único ponto: `FOOD_WITHDRAW_FEE_ENABLED` em `_shared/food-company.ts` (hoje `false`); ligada, o Pix sai por `valor − taxa` (`rates.cashout`, padrão 2%), há lançamento `fee` e repasse à carteira `ASAAS_PARENT_WALLET_ID`, como no `financial-descarregar`. **Decisão pendente do usuário** (§11).
- Erros: `INVALID_AMOUNT` (422), `NOT_OWNER` (403), `COMPANY_PIX_KEY_NOT_CONFIGURED` (422), `INVALID_AUTHORIZATION` (403), `COMPANY_NOT_APPROVED` (409), `OWNER_LINK_PENDING` (403), `OWNER_LINK_REJECTED` (403), `PIX_KEY_RECENTLY_CHANGED` (403, extra `available_at`), `WITHDRAW_LIMIT_PER_TX` (422, extra `limit_brl`), `WITHDRAW_LIMIT_DAILY` (422, extra `limit_brl`), `WITHDRAW_CHECK_FAILED` (503, repetível), `INSUFFICIENT_BALANCE` (422), `ASAAS_ERROR` (503), `OPERATION_IN_PROGRESS` (409), `CRYPTO_ERROR` (500).

### 4.5 `food-company-set-pix-key`

Entrada: `{ company_id, owner_ref, key_type: 'cnpj'|'random', cnpj, pix_key?, op }`. Saída `200`: `{ pix_key: { configured: true, type, masked, digest, changed_at, available_at } }`.

**Decisão de 04/11/2026:** a chave de saque é, de preferência, a do **CNPJ**; a chave aleatória (EVP) só é aceita com verificação de que pertence ao CNPJ da empresa. O Alber **nunca gera** uma EVP na subconta (o saque voltaria para a própria subconta).

- `cnpj`: **obrigatório nos dois tipos** (o Alber guarda só o hash do CNPJ); conferido contra `companies.cnpj` (`422 CNPJ_MISMATCH`, `422 CNPJ_INVALID`).
- `pix_key`: **obrigatório para `random`** (ausente: `400 MISSING_FIELDS`; formato EVP inválido: `422 PIX_KEY_INVALID`) e **proibido para `cnpj`** (`400 INVALID_BODY`). Guardada em minúsculas.
- A autorização `set_pix_key` leva **sempre** `destination_digest = SHA-256 hex de "${company_id}|${chave}"` (CNPJ normalizado em maiúsculas sem pontuação para `cnpj`; a EVP em minúsculas para `random`), amarrando a assinatura à chave confirmada pela pessoa.
- A chave **só é gravada uma vez** (`409 PIX_KEY_EXISTS`; conferido de novo na gravação, condicional a "ainda sem chave"). O único caminho que a limpa é `food-company-owner-transfer`.
- `cnpj`: destino é a conta do próprio CNPJ, **sem espera** e **sem consulta ao Asaas**. `random`: **48 h de espera** (`pix_key_changed_at`) antes do primeiro saque.
- Exige empresa aprovada (`409 COMPANY_NOT_APPROVED`, dentro da operação assinada).

**Verificação da EVP (só `random`) — fail-closed.** Depois da autorização assinada e da reserva (nunca antes), o Alber consulta o Asaas, `GET /v3/pix/addressKeys/external?type=EVP&key=<evp>`, com a chave de API da **subconta** da empresa (cabeçalho `access_token`, sem corpo; `lookupExternalPixKey` em `_shared/asaas.ts`, injetável nos testes). A resposta traz `owner.name` e `owner.cpfCnpj`. Só aceita se `owner.cpfCnpj`, normalizado como `normalizeCnpj`, tiver os **14 caracteres completos** e for **igual ao CNPJ do corpo**. Nunca aceita sem verificação conclusiva.

| Resultado da consulta | Resposta | Reservação |
|---|---|---|
| documento completo e igual ao CNPJ | grava a chave e segue (espera de 48 h) | concluída |
| chave não encontrada (404) | `422 PIX_KEY_NOT_FOUND` | erro guardado |
| dono com outro documento | `422 PIX_KEY_OWNER_MISMATCH` (mensagem genérica, sem nome nem documento de terceiro) | erro guardado |
| documento mascarado, incompleto ou ausente; ou 4xx inesperado | `503 PIX_KEY_VERIFICATION_UNAVAILABLE`, `retryable: false` (a mensagem manda usar a chave do CNPJ) | erro guardado |
| rede, 5xx, 429 / token bucket, exceção | `503 PIX_KEY_VERIFICATION_UNAVAILABLE`, `retryable: true` | liberada (a mesma autorização, se válida, tenta de novo) |

Toda recusa da verificação grava `audit_logs` `company_pix_key_rejected` (`user_id` nulo, `metadata = { company_id, via: 'food', owner_ref, reason }` com `reason` em `not_found`, `owner_mismatch`, `document_masked`, `verification_unavailable`), **sem dados do terceiro**.

**A verificação em produção depende da resposta do Asaas.** Na documentação do Asaas, no sandbox só a chave `47996515839` pode ser consultada e o `cpfCnpj` vem **mascarado**; em produção o comportamento para CNPJ não está documentado (pergunta em `docs/perguntas-asaas.md`, repositório do Alber Food). Se vier mascarado também em produção, toda chave `random` cai em `503 ... retryable: false` e só a chave do CNPJ funciona (comportamento seguro por desenho).

- Erros: `INVALID_KEY_TYPE` (422), `MISSING_FIELDS` / `INVALID_BODY` (400), `NOT_OWNER`, `INVALID_AUTHORIZATION`, `COMPANY_NOT_APPROVED`, `PIX_KEY_EXISTS` (409), `CNPJ_INVALID` / `CNPJ_MISMATCH` / `PIX_KEY_INVALID` / `PIX_KEY_NOT_FOUND` / `PIX_KEY_OWNER_MISMATCH` (422), `PIX_KEY_VERIFICATION_UNAVAILABLE` (503), `DB_ERROR`.
- Auditoria: `company_pix_key_changed` (`user_id` nulo, `metadata.via = 'food'`, `owner_ref`). Sem push (o aviso ao dono é do Food).

### 4.6 `food-company-limit-request` e `food-company-limit-cancel`

- Pedir: `{ company_id, owner_ref, per_tx_brl, per_day_brl, reason }` → `201 { request: { id, status, requested_per_tx_brl, requested_per_day_brl, current_per_tx_brl, current_per_day_brl, created_at } }`.
- Cancelar: `{ company_id, owner_ref }` → `200 { status: 'cancelled' }`; sem pedido aberto: `404 LIMIT_REQUEST_NOT_FOUND`.
- Mesmas regras de `company-limit-request` (módulo comum `_shared/limit-request.ts`): `COMPANY_NOT_APPROVED` (422), `OWNER_LINK_PENDING`/`OWNER_LINK_REJECTED` (403), `LIMIT_INVALID`, `LIMIT_ABOVE_CAP` (extra `max_per_tx_brl`/`max_per_day_brl`), `REASON_INVALID` (10 a 500 caracteres), `LIMIT_NOT_HIGHER` (extra `current_*`) (422), `LIMIT_REQUEST_PENDING` (409), `RATE_LIMITED` (429, 3 pedidos por dia). O pedido grava o dono em `company_limit_requests.requested_by_ref`; a equipe decide no Alber Admin (`admin_decide_limit_request`, que não tenta avisar usuário quando `requested_by` é nulo).

### 4.7 `food-company-owner-transfer`

Entrada: `{ company_id, from_owner_ref, to_owner_ref, new_owner: { cpf, name, phone }, op, cnpj }`. Saída `200`: `{ owner_link_check, owner_link_review, pix_key_reset: true, withdraw_available_at }`.

- Autorização `owner_transfer` (`owner_ref = from_owner_ref`, `new_owner_ref = to_owner_ref`). `to_owner_ref` diferente de `from_owner_ref` (`422 INVALID_OWNER`).
- Efeito (uma atualização condicional ao dono de antes): `owner_ref = to_owner_ref`; vínculo refeito para o **novo** dono (CPF x quadro societário; `match` → `not_needed`, qualquer outro resultado → `pending`, revisão da equipe); **chave Pix de saque zerada** (`pix_key`, `pix_key_type`, `pix_key_hash`, `pix_key_set_at` nulos) e **espera de 48 h reiniciada** (`pix_key_changed_at = agora`). `withdraw_available_at = agora + 48 h`. O CPF do novo dono não é guardado.
- Depois da troca o dono antigo recebe `403 NOT_OWNER` em tudo; para sacar, o novo dono precisa cadastrar a chave (`food-company-set-pix-key`) **e** esperar as 48 h (mesmo com chave do tipo CNPJ, pois a espera é da troca).
- Repetir a troca já feita (mesma autorização ou mesma `idempotency_key`) devolve o desfecho original; uma troca nova com dono de antes errado dá `403 NOT_OWNER`.
- **Campo aditivo (desvio, §7):** `cnpj` obrigatório (o Alber guarda só o hash; a conferência do quadro societário precisa do CNPJ em claro; conferido contra `companies.cnpj`: `422 CNPJ_MISMATCH`).
- **Decisão de 04/11/2026:** os **limites de saque voltam ao padrão** na troca (`withdraw_limit_per_tx_brl`, `withdraw_limit_per_day_brl` e `withdraw_limit_set_at` zerados; `food-company-status` passa a mostrar `limits.source = 'default'`) e qualquer **pedido de aumento em aberto (`pending`) é cancelado** (`status = 'cancelled'`; o histórico dos pedidos fica).

### 4.8 `food-company-abandon`

Entrada: `{ company_id, owner_ref }` (sem autorização assinada: não move dinheiro). Saída `200`: `{ company_id, abandoned: true }`.

- O dono desiste do cadastro **antes da aprovação do KYC** (ex.: digitou o CNPJ errado): marca `deleted_at` e `deleted_reason = 'abandoned'`, o que **libera o CNPJ e o @ na hora** (índices parciais da migration 044). Não mexe na subconta do Asaas: ela fica órfã, e abrir o mesmo CNPJ de novo dá `CNPJ_IN_USE` (caso do suporte), como na rejeição de KYC.
- Regra em `_shared/company-abandon.ts` (`abandonRefusal`, `abandonPatch`), a mesma de `company-abandon` (app): já cancelada → `409 ALREADY_ABANDONED`; KYC aprovado → `422 COMPANY_ALREADY_APPROVED`. KYC `pending`, `submitted` e `rejected` (ainda sem `deleted_at`) podem ser cancelados.
- Dono: empresa inexistente, **dono diferente** ou empresa do app (sem `owner_ref`) → `404 COMPANY_NOT_FOUND` (não revela que a empresa existe para outro dono). Diferente das demais funções, que dão `403 NOT_OWNER`.
- A gravação é **condicional** a "ainda sem `deleted_at` e ainda não aprovada": se o Asaas aprovar a empresa entre a leitura e a gravação, nada é apagado e a resposta é `422 COMPANY_ALREADY_APPROVED`. (O `company-abandon` do app não tem essa guarda e **continua como estava**; a janela é pequena, mas fica registrada como melhoria possível.)
- Auditoria: `audit_logs` `company_abandoned` com `user_id` nulo e `metadata = { company_id, previous_kyc_status, via: 'food', owner_ref }`.
- Erros: `INVALID_COMPANY`/`INVALID_OWNER` (422), `COMPANY_NOT_FOUND` (404), `ALREADY_ABANDONED` (409), `COMPANY_ALREADY_APPROVED` (422), `DB_ERROR` (503 na leitura, 500 na gravação).

### 4.9 `food-company-withdraw-status`

Entrada: `{ company_id, owner_ref, transaction_ids?: string[], idempotency_keys?: string[] }` (ao menos um; no total, de 1 a 20; ids em UUID e chaves de 8 a 64 caracteres imprimíveis; repetidos viram um; fora disso `422 INVALID_TRANSACTION_IDS` / `INVALID_IDEMPOTENCY_KEYS`). Saída `200`: `{ items: [{ transaction_id|null, idempotency_key|null, status: 'processing'|'completed'|'failed', amount_cents, destination_masked|null, created_at, completed_at|null, failure_code|null }] }`.

**Consulta pela chave de idempotência (04/11/2026, lacuna "resposta perdida").** O Food chama o saque com `idempotency_key` = id do desafio da etapa extra. Se a resposta se perde (rede, tempo esgotado), ele não conhece o `transaction_id`; pergunta pela chave. Como o lançamento nasce **antes** do Pix, com a chave nos metadados:

| Situação da chave | Item devolvido |
|---|---|
| Há lançamento com a chave (saque do Food desta empresa) | o item de sempre, com `transaction_id` e `idempotency_key` |
| Sem lançamento, operação `in_progress` | `status: 'processing'`, `transaction_id: null`: o Alber ainda não terminou, o desfecho segue **desconhecido** e a equipe reconcilia pelo Admin (§4.10) |
| Sem lançamento, operação `failed` | `status: 'failed'`, `failure_code` = código da recusa guardada (ex.: `INSUFFICIENT_BALANCE`, `OPERATION_ABANDONED`; texto livre vira `OPERATION_FAILED`) |
| Chave desconhecida | o item **não aparece**: a chamada nunca chegou, e repetir o saque com a mesma chave é seguro |

O pedido por `transaction_ids` continua igual; o mesmo lançamento pedido por id e por chave vem uma vez só.

### 4.10 Encerrar operação presa (`public.admin_resolve_food_op`, migration 059)

Não é rota HTTP: é função SQL `SECURITY DEFINER` que só o Alber Admin (`admin_app`) executa, depois de a equipe **conferir o Asaas** (o Admin nunca move dinheiro). Resolve o saque cujo desfecho ficou desconhecido: o Pix pode ter saído ou não, a operação fica `in_progress` e repetir dá `OPERATION_IN_PROGRESS` para sempre. Assinatura: `(p_op_id uuid, p_outcome text, p_by text, p_transfer_id text DEFAULT NULL) -> { previous, new, transaction_id }`.

| Desfecho | Quando | Efeito |
|---|---|---|
| `not_sent` | A equipe conferiu: **não há** transferência no Asaas (a referência externa é o id do lançamento). Vale para qualquer tipo de operação | Lançamento pendente sem id de transferência vai a `failed` (sai da soma do limite do dia); operação vira `failed` com resultado `OPERATION_ABANDONED` (409). O Food, ao repetir ou consultar, recebe essa recusa e pode fazer um **pedido novo** |
| `sent` | A equipe conferiu: **há** transferência no Asaas e informou o id dela. Só saque, com lançamento pendente ainda sem id | Liga o id ao lançamento e o leva a `processing` (o webhook `TRANSFER_DONE`/`FAILED` conclui); operação vira `completed` com o desfecho original (`transaction_id`, `processing`, valor, destino mascarado) |

Travas: só operação `in_progress` **há mais de 10 minutos** (`CONTAIN_TOO_RECENT`: uma chamada ainda viva não é fechada por baixo); lançamento que já tem id de transferência nunca é dado como não enviado (`CONTAIN_INVALID_TRANSITION`); id de transferência inválido, desfecho desconhecido ou responsável em branco (`CONTAIN_ARGS_INVALID`/`CONTAIN_ACTION_INVALID`); operação inexistente (`CONTAIN_NOT_FOUND`). Cada uso grava `audit_logs` `food_op_resolved` (op, tipo, empresa, desfecho, lançamento, quem; nunca valor, chave Pix nem documento). Verificada em PGlite sobre as 59 migrations reais (incl. privilégios: `anon`, `authenticated` e `service_role` não executam). Caso fora do alcance: lançamento pendente **sem** id de transferência em que o Pix de fato saiu e a equipe usa `sent` com o id achado no Asaas; se nem isso for possível, é conciliação manual no banco.

- Somente leitura, **sem autorização assinada**. Acompanha os saques de `food-company-withdraw` (decisão de 04/11/2026).
- Só devolve lançamentos de **saque desta empresa** (`type = 'descarregar'` com `metadata.via = 'food'`): ids de outra empresa, de outro tipo ou inexistentes simplesmente **não aparecem** (nunca 403 que revele existência). Empresa de outro dono, inexistente, removida ou do app: `404 COMPANY_NOT_FOUND` (como `food-company-abandon`). Os itens vêm na ordem pedida.
- `status`: o que o webhook `TRANSFER_DONE`/`TRANSFER_FAILED` do Asaas grava na transação (`pending` e `processing` → `processing`; `completed`; `failed`). `completed_at`: data do `audit_logs` `descarregar_completed`/`descarregar_failed` do webhook (`transactions` não tem `updated_at`), ou `null` enquanto processa. `failure_code`: sempre `TRANSFER_FAILED` quando falhou (código genérico, nunca texto do Asaas). `amount_cents` e `destination_masked` são os do saque.
- O Alber não avisa o Food quando o Pix conclui: o Food consulta por esta função.

## 5. Tabela de erros comuns

| Código | HTTP | Quando |
|---|---|---|
| `METHOD_NOT_ALLOWED` | 405 | método diferente de POST |
| `INVALID_BODY` | 400 | JSON inválido ou que não é objeto |
| `MISSING_FIELDS` | 400 | campo obrigatório ausente (`op`, `owner`, `company`...) |
| `UNAUTHORIZED` | 401 | `x-alber-food-key` ausente ou errada |
| `SERVICE_NOT_CONFIGURED` | 503 | `ALBER_FOOD_SERVICE_KEY` ou `FOOD_OP_SIGNING_KEY` ausente/inválida |
| `INVALID_COMPANY` / `INVALID_OWNER` | 422 | `company_id` / `owner_ref` fora do formato |
| `COMPANY_NOT_FOUND` | 404 | empresa inexistente ou removida (em `food-company-abandon` e `food-company-withdraw-status`, também dono errado) |
| `PIX_KEY_NOT_FOUND` / `PIX_KEY_OWNER_MISMATCH` | 422 | `food-company-set-pix-key` com EVP não encontrada / de outro dono (§4.5) |
| `PIX_KEY_VERIFICATION_UNAVAILABLE` | 503 | verificação da EVP inconclusiva; `retryable` diz se vale tentar de novo (§4.5) |
| `INVALID_TRANSACTION_IDS` | 422 | `food-company-withdraw-status` com lista fora de 1 a 20 UUIDs |
| `ALREADY_ABANDONED` | 409 | `food-company-abandon` em empresa já cancelada |
| `COMPANY_ALREADY_APPROVED` | 422 | `food-company-abandon` em empresa com KYC aprovado |
| `NOT_OWNER` | 403 | `owner_ref` diferente de `companies.owner_ref` |
| `COMPANY_NOT_APPROVED` | 409 (422 em `limit-request`) | KYC não aprovado, conta bloqueada ou sem chave de subconta |
| `INVALID_AUTHORIZATION` | 403 | qualquer falha da autorização assinada (§3.4) |
| `OPERATION_IN_PROGRESS` | 409 | mesma operação ainda em andamento |
| `DB_ERROR` | 503/500 | falha de banco (503 nas leituras, 500 ao gravar) |

## 6. Modelo de dados (migration `20260101000058_food_company_service.sql`)

Aditiva e idempotente (`IF NOT EXISTS` / checagem em `pg_constraint`); **não aplicada em produção**.

**Verificação feita em 04/11/2026 (sem tocar no banco de produção):** (a) catálogo de produção, só leitura: última migration aplicada 057; `companies.owner_id`, `transactions.user_id` e `company_limit_requests.requested_by` eram `NOT NULL`; nenhuma coluna, restrição, índice ou tabela da 058 existia; nenhum dado violaria as restrições novas; as duas funções do Admin existem com a mesma assinatura, `SECURITY DEFINER`, `search_path = pg_catalog, public` e execução só para `admin_app`; o único gatilho das tabelas é `update_updated_at`. (b) As definições das duas funções em produção são idênticas às da 058, exceto pelo `IF ... IS NOT NULL` em volta do aviso in-app (nenhum ajuste feito direto em produção seria sobrescrito). (c) Execução num Postgres em memória (PGlite, com stubs de `auth`, `storage` e papéis do Supabase): as 58 migrations aplicam sem erro, a 058 reaplicada não falha, e sobre um banco com dados anteriores ela mantém as linhas como `origin = 'app'`, aceita empresa, saque e pedido de limite do Food (referência em vez de usuário), recusa linha sem dono e sem referência, mantém `food_ops` único por `nonce` e por `idempotency_key`, `cleanup_food_ops()` apaga só concluídas vencidas, `anon` e `authenticated` não leem `food_ops` nem executam a limpeza, e as funções do Admin decidem empresa e pedido do Food sem aviso e do app com aviso. Não coberto: o tempo de bloqueio das tabelas em produção (as tabelas têm 5, 61 e 0 linhas hoje) e a RLS de `companies` sob `authenticated`, que no ambiente em memória já dava recursão infinita antes da 058 (herança do esquema atual, sem relação com esta migration).

| Mudança | Detalhe |
|---|---|
| `companies.owner_id` | passa a aceitar nulo |
| `companies.owner_ref TEXT` | id opaco da conta no Alber Food (1 a 128 caracteres); índice parcial |
| `companies.origin TEXT NOT NULL DEFAULT 'app'` | `CHECK IN ('app','food')` |
| `companies_owner_present_check` | `owner_id IS NOT NULL OR owner_ref IS NOT NULL` |
| `companies.pix_key_set_at TIMESTAMPTZ` | quando a chave de saque foi cadastrada (qualquer tipo). `pix_key_changed_at` continua sendo só o que a guarda de saque usa |
| `transactions.user_id` | passa a aceitar nulo |
| `transactions.actor_ref TEXT` | quem pediu quando não há usuário; `transactions_actor_present_check`: `user_id IS NOT NULL OR actor_ref IS NOT NULL` (hoje não há lançamentos de sistema sem os dois) |
| `company_limit_requests.requested_by` | aceita nulo; `requested_by_ref TEXT`; `company_limit_requests_requester_present_check` |
| `food_ops` | `nonce` único, `idempotency_key` único, `kind`, `company_id` (FK com `ON DELETE CASCADE`), `owner_ref`, `amount_cents`, `destination_digest`, `new_owner_ref`, `status` (`in_progress`/`completed`/`failed`), `result JSONB`, `created_at`, `completed_at`, `expires_at` (padrão +7 dias). RLS ligada **sem policy** e sem acesso de `anon`/`authenticated`: só a service role |
| `cleanup_food_ops()` | apaga as operações encerradas e vencidas (as `in_progress` ficam para reconciliação); as funções também limpam a cada operação assinada |
| `admin_review_company_link`, `admin_decide_limit_request` | redefinidas: só inserem o aviso in-app ao dono quando existe usuário (`owner_id`/`requested_by` não nulos). Mesmos `GRANT`s |

RLS: as policies de `companies`/`transactions`/`company_operators` comparam `owner_id`/`user_id` com `auth_user_id()`; nulo nunca casa, então a empresa e os saques do Alber Food **não aparecem para nenhum usuário do app** (certo).

## 7. Desvios do contrato original (aditivos; a sessão de origem concilia com a fase 2)

| # | Onde | Desvio | Por quê |
|---|---|---|---|
| 1 | `food-company-set-pix-key` | campo `cnpj` obrigatório quando `key_type = 'cnpj'` | o Alber guarda só o hash do CNPJ (projeto), então não tem o valor em claro para gravar a chave |
| 2 | `food-company-set-pix-key` | `pix_key` **obrigatório** para `random` (proibido para `cnpj`) e o Alber **nunca gera** EVP; a EVP é verificada no Asaas (fail-closed, §4.5). **Decisão de 04/11/2026**, substitui o texto do contrato original ("`random` registra na subconta") | uma EVP gerada na própria subconta enviaria o saque de volta à própria subconta; a chave de saque útil é a do CNPJ ou uma chave do banco do dono que comprovadamente pertence ao CNPJ |
| 3 | `food-company-set-pix-key` | a autorização leva **sempre** `destination_digest` da chave; `cnpj` obrigatório nos dois tipos | amarra a assinatura à chave que a pessoa confirmou com o código por e-mail |
| 4 | `food-company-owner-transfer` | campo `cnpj` obrigatório | a conferência do quadro societário (BrasilAPI) precisa do CNPJ em claro; o Alber só tem o hash |
| 5 | `food-company-create` | repetir (mesmo dono, mesmo CNPJ) devolve `200` com a empresa existente | evita subconta duplicada em retry após timeout |
| 6 | `food-company-withdraw` | `status` da resposta é sempre `processing` | o Pix é assíncrono; `completed`/`failed` chegam pelo webhook do Asaas e o Food acompanha por `food-company-withdraw-status` (função nova, decisão de 04/11/2026, §4.9) |
| 7 | estados da empresa | `COMPANY_NOT_APPROVED` (e `PIX_KEY_EXISTS`) só aparecem **depois** da autorização nas operações assinadas | para a repetição de uma operação concluída devolver o original mesmo se a empresa mudou de estado |
| 8 | `loadOwnedCompany` | na troca de titular também aceita o **novo** dono | idem: a repetição de uma troca já feita chega à idempotência |
| 9 | `food-company-abandon` | função **nova**, fora da lista original de 8; dono errado dá `404 COMPANY_NOT_FOUND` (não `403 NOT_OWNER`); a gravação é condicional | pedido da sessão de origem (o Food já a chama); evita revelar a empresa a outro dono e nunca apaga uma empresa aprovada no meio da corrida |

## 8. Pontos que quebram (ou mudam) com `owner_id` nulo

No Alber (tratados nesta fase): `admin_review_company_link` e `admin_decide_limit_request` (migration 058), `applyCompanyKyc` em `company-kyc.ts` (sem push quando `owner_id` é nulo; usado por `webhooks-asaas-kyc` e `company-list`), `webhooks-asaas-pix` (`TRANSFER_DONE`/`TRANSFER_FAILED` sem push quando `user_id` é nulo), `auth-company-lookup` (sem master), `createCompanyForOwner`/`decideTakeover` (disputa com `owner_ref`; aviso de perda do CNPJ só se a empresa pendente tinha usuário). Funções do app que comparam `owner_id` com o usuário (`company-abandon`, `company-confirm-cnpj`, `company-owner-verify`, `company-set-pix-key`, `company-limit-request`, `requireCompanyPermission`) recusam a empresa do Alber Food sem mudança.

**No Alber Admin (a tratar na fase 4, repositório do Admin; conferido em leitura no banco de produção, schema `admin`):**

- `admin.v_alber_companies`: lista a empresa (sem perder linhas), mas `owner_id` vem nulo e **`owner_kyc_status`, `owner_other_companies`, `owner_other_approved` e `owner_companies_30d` ficam zerados/nulos para empresa do Alber Food** (comparam `o.owner_id = c.owner_id`; nulo nunca é igual). O alerta "responsável com 3 ou mais empresas em 30 dias" fica cego para o Food. Expor `owner_ref`, `origin`, `pix_key_set_at` e comparar por `COALESCE(owner_id::text, owner_ref)`.
- `admin.v_subaccounts`: marca toda empresa como `origin = 'app'`; usar `c.origin`.
- `admin.v_fin_transactions`: expõe `user_id` (nulo nos saques do Food); incluir `actor_ref` e `company_id`.
- `admin.v_alber_limit_requests`: não depende de `requested_by`; incluir `requested_by_ref` se a tela mostrar quem pediu.
- Funções `admin_review_company_link` e `admin_decide_limit_request`: já ajustadas pela migration 058 (o Admin só precisa saber que o aviso in-app não existe para o Food).
- Novas fontes para alertas: `audit_logs` `food_op_rejected` (autorização recusada, com `metadata.reason`), `company_withdraw_blocked` (`via = 'food'`), `company_owner_transferred`, `company_pix_key_changed` (`via = 'food'`), `descarregar_initiated` (`via = 'food'`); tabela `food_ops` (operações `in_progress` antigas = desfecho desconhecido a reconciliar).

## 9. Lacunas e pontos para a fase 2

1. **`FOOD_OP_SIGNING_KEY`:** decodificar hex/base64 em bytes e usar os bytes como chave do HMAC (§3.2); conferir o vetor de §3.3.
2. **`idempotency_key`:** pode ser o `challenge_id`; repetir a mesma chave com outro valor/destino é recusado.
3. **Timeouts:** `food-company-create` leva ~15 s com a chave de subconta; `food-company-status` até ~8 s se a empresa estiver pendente.
4. **Desfecho desconhecido do saque:** `503 ASAAS_ERROR` + repetição com `OPERATION_IN_PROGRESS` significa "não sabemos se saiu": o Food não deve liberar o valor nem tentar de novo com outra chave; a equipe reconcilia pelo lançamento `pending`.
5. **Acompanhar o saque:** a resposta de `food-company-withdraw` é `processing`; o desfecho final se consulta com `food-company-withdraw-status` (§4.9). O Alber não envia nada ao Food.
6. **Sem push/e-mail:** o Alber não avisa ninguém; os e-mails ao dono (saque, chave, troca) são do Food.
7. **Troca de titular e o Asaas:** o responsável da subconta continua o antigo no KYC. O plano pede saque bloqueado até a resposta do Asaas; o Alber só impõe as 48 h e o novo veredito do vínculo. Se for preciso bloqueio maior, é decisão nova.

## 10. Ordem de publicação sugerida para o corte (nada foi publicado)

Pré-requisito do plano: backup completo e autorização explícita do usuário no dia (a limpeza de dados de teste é destrutiva).

1. **Segredos do Alber** (`supabase secrets set`, pelo usuário, sem colar em chat): `FOOD_OP_SIGNING_KEY` (32 bytes, **o mesmo valor** do Food); conferir que existem `ALBER_FOOD_SERVICE_KEY`, `ENCRYPTION_KEY`, `ASAAS_API_KEY` (+ `ALBER_KEYS_ENCRYPTION_KEY`, ver `05_security.md` §7.1), `ASAAS_WEBHOOK_SECRET`, `ASAAS_ENVIRONMENT`.
2. **Zerar os dados de teste** (plano §5), com a limpeza das subcontas de teste no Asaas antes, se for o caso.
3. **Migrations 058 e 059** (`--dry-run` primeiro; a 059 depende da 058: `admin_resolve_food_op` usa `food_ops`). Funções antigas continuam funcionando antes e depois (o caminho do app não envia as colunas novas).
4. **Funções, nesta ordem:** `webhooks-asaas-pix` e `webhooks-asaas-kyc` (tolerância a nulo; seguem `--no-verify-jwt`), `auth-company-lookup`, `company-limit-request`, `company-create`, `auth-register`, `company-abandon`; depois as 10 novas (`food-company-create`, `-status`, `-balance`, `-set-pix-key`, `-withdraw`, `-limit-request`, `-limit-cancel`, `-owner-transfer`, `-abandon`, `-withdraw-status`) **sem** `--no-verify-jwt`. As funções de `_shared` são empacotadas com cada função: publicar todas as que importam `company.ts`, `company-kyc.ts`, `cnpj-dispute.ts`, `limit-request.ts` e `company-abandon.ts`.
5. **Alber Food** (migrations e `food-api`, depois o site) e **Alber Admin** (views e funções), conforme o plano.
6. **Fumaça** com CNPJs novos (sandbox): abrir empresa, status, chave Pix, saque de R$ 10, extrato, pedido de limite; conferir `food_ops` e `transactions`.
7. Trocar a chave do Asaas com segurança só depois de `ALBER_KEYS_ENCRYPTION_KEY` definido (nota `05_security.md` §7.1).

## 11. Decisões do usuário (04/11/2026)

1. **Chave Pix de saque:** preferencialmente a do **CNPJ**; chave aleatória (EVP) **colada pelo dono**, só com verificação no Asaas de que pertence ao CNPJ da empresa (fail-closed, §4.5). O Alber não gera chave. Fica registrado que a verificação em produção depende da resposta do Asaas (§4.5).
2. **Acompanhamento do saque:** função `food-company-withdraw-status` (§4.9).
3. **Troca de titular:** os limites de saque voltam ao padrão e o pedido de aumento em aberto é cancelado (§4.7).
4. **Taxa de saque do Alber Food: desligada** (é o padrão). A regra fica num único ponto, `FOOD_WITHDRAW_FEE_ENABLED` em `_shared/food-company.ts`; ligada, o Pix sai por `valor − taxa` (`rates.cashout`, padrão 2%), com lançamento `fee` e repasse à carteira `ASAAS_PARENT_WALLET_ID`. Ligar é uma decisão futura de negócio.

Ainda em aberto: a troca de titular depende de como o Asaas troca o responsável da subconta (§9, ponto 7).

## 12. Testes

`deno test supabase/functions --allow-env --allow-net --allow-read`. Cada função tem `index.test.ts` com banco falso em memória (`_shared/fake-postgrest.ts`, que respeita unicidade e CHECKs da migration 058) e Asaas simulado (`_shared/food-test-kit.ts`). O verificador (`_shared/food-op.test.ts`) cobre adulteração de cada campo, vencimento, vida acima de 120 s, repetição de nonce, valor e destino divergentes, cabeçalho ausente/malformado, segredo ausente e o vetor de teste. Corridas (dois saques, duas chaves, duas trocas, dois pedidos de limite ao mesmo tempo) têm teste próprio.
