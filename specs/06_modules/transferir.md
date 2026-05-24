# Alber — Spec Módulo Transferir
**Versão:** 1.0  
**Data:** 30/04/2026  
**Depende de:** 03_backend.md, 05_security.md

---

## 1. Visão geral

Transferência direta de Albers entre dois usuários Alber (subcontas Asaas).
O remetente inicia o fluxo, busca o destinatário, define o valor e autentica
com PIN scrambled e confirmação de segurança.

**Diferenças em relação ao Receber:**
- Remetente inicia — não o recebedor
- Sem taxa — transferência interna gratuita
- Remetente autentica no próprio device

**Posicionamento na navegação:** action row na Home, junto com Receber,
Carregar e Split.

---

## 2. Fluxo completo

```
Home → Transferir
  ↓
Etapa 1: Busca do destinatário (CPF, @handle ou e-mail)
  ↓
Etapa 2: Definição do valor em Albers
  ↓
Etapa 3: PIN scrambled par-a-par
  ↓
Etapa 4: Confirmação de segurança
  ↓
Etapa 5: Tela de sucesso com recibo
```

---

## 3. Telas e especificações

### 3.1 Etapa 1 — Busca do destinatário

```
┌─────────────────────────────────┐
│  [‹]        Transferir          │
├─────────────────────────────────┤
│                                 │
│  [ CPF, @handle ou e-mail    ] │
│  Digite CPF, @handle ou e-mail  │
│                                 │
│  RECENTES                       │
│  [avatar] João Pedro @joaopedro │
│  [avatar] Ana Lima   @analima   │
│  [avatar] Carlos     @carlos    │
│                                 │
└─────────────────────────────────┘
```

**Campo de busca:**
- Aceita CPF (com ou sem máscara), @handle (com ou sem @), e-mail
- Busca disparada a partir de 2 caracteres (debounce 300ms)
- Busca apenas usuários Alber cadastrados

**Estados:**
- Sem input: lista de recentes (últimas 10 transferências)
- Digitando: resultado em tempo real
- Encontrado: exibe nome + @handle + avatar
- Não encontrado: "Usuário não encontrado. Verifique o CPF, @handle ou e-mail."

**Ao selecionar:** avança para etapa 2 com animação de slide

---

### 3.2 Etapa 2 — Definição do valor

```
┌─────────────────────────────────┐
│  [‹]    Quanto transferir?      │
├─────────────────────────────────┤
│  [avatar] {Nome}  {handle}  Trocar│
│                                 │
│            [50]                 │
│            Albers               │
│  Saldo disponível: 120 Albers   │
│                                 │
│  [ 1 ]  [ 2 ]  [ 3 ]           │
│  [ 4 ]  [ 5 ]  [ 6 ]           │
│  [ 7 ]  [ 8 ]  [ 9 ]           │
│         [ 0 ]  [ ⌫ ]           │
│                                 │
│  [       Continuar       ]      │
└─────────────────────────────────┘
```

**Teclado numérico nativo** (não o scrambled — o scrambled é só para PIN)

**Validações:**
- Valor mínimo: 1 Alber
- Valor máximo: saldo disponível
- Acima do saldo: valor bloqueado em tempo real + mensagem "Saldo insuficiente"
- Botão desabilitado com valor zero

**"Trocar":** volta para etapa 1 para selecionar outro destinatário

---

### 3.3 Etapa 3 — PIN scrambled

```
┌─────────────────────────────────┐
│  [‹]     Confirmar PIN          │
├─────────────────────────────────┤
│  TRANSFERIR ALBERS              │
│  Digite seu PIN                 │
│                                 │
│  ┌─────────────────────────┐    │
│  │ Para:   @{handle}       │    │
│  │ ─────────────────────   │    │
│  │ Valor:  {N} Albers      │    │
│  │ Taxa:   Gratuita ✓      │    │
│  └─────────────────────────┘    │
│                                 │
│  ○ ○ ○ ○ ○ ○  (6 dots)         │
│                                 │
│  [ 0|2 ] [ 5|7 ] [ 4|6 ]       │
│  [ 1|3 ] [ 8|9 ] [  ⌫  ]       │
│                                 │
│  [       Confirmar       ]      │
└─────────────────────────────────┘
```

**Especificação PIN:** idêntica ao spec de segurança (05_security.md seção 2.1)
- Teclado scrambled par-a-par, posições randomizadas a cada render
- 6 dígitos, screenshot bloqueada
- 3 tentativas erradas → bloqueio 15 minutos

**Recap card:** exibe destinatário, valor e taxa gratuita antes da digitação

---

### 3.4 Etapa 4 — Confirmação de segurança

Idêntica ao padrão descrito em 05_security.md seção 2.2:
- 1 pergunta sorteada das 4 cadastradas
- 4 opções: 1 real mascarada + 3 falsas
- Posição da correta randomizada
- 3 tentativas erradas → bloqueio 15 minutos

---

### 3.5 Etapa 5 — Sucesso

```
┌─────────────────────────────────┐
│                                 │
│           [✓ ícone]             │
│                                 │
│   {N} Albers enviados!          │
│                                 │
│   Transferência para @{handle}  │
│   concluída com sucesso         │
│                                 │
│  ┌─────────────────────────┐    │
│  │ Para:          @handle  │    │
│  │ Valor:        N Albers  │    │
│  │ Taxa:         Gratuita  │    │
│  │ Saldo restante: X Albers│    │
│  └─────────────────────────┘    │
│                                 │
│  [       Voltar para Home      ]│
│                                 │
└─────────────────────────────────┘
```

**Push para o destinatário:**
"Você recebeu {N} Albers de @{handle_remetente}"

---

## 4. Processamento no BFF

```
POST /financial/transferir

Request:
{
  destinatario_identifier: string   // CPF, @handle ou e-mail
  amount_albers: number
  pin_hash: string                  // SHA-256
  security_answer_hash: string      // bcrypt
}

Validações:
1. Localizar destinatário pelo identificador
2. Verificar que remetente ≠ destinatário
3. Validar PIN do remetente
4. Validar resposta de segurança
5. Verificar saldo suficiente (sem taxa)
6. Debitar remetente
7. Creditar destinatário
8. Registrar 2 transações: enviar(remetente) e receber(destinatario)

Response 200:
{ transaction_id, amount, destinatario_handle, novo_saldo }
```

**Diferença do Receber:** sem cálculo de taxa, débito = crédito exato.

---

## 5. Regras críticas

- Remetente não pode transferir para si mesmo → erro "Você não pode transferir para sua própria conta"
- Sem taxa em nenhum cenário — transferência interna Alber é sempre gratuita
- Limite: saldo disponível (não bloqueado em splits)
- Histórico aparece em Atividade como tipo `transferir_enviado` e `transferir_recebido`

---

## 6. Atualização da Home

Action rows na Home passam de 3 para 4 itens:

| Ícone | Label | Rota |
|---|---|---|
| ↓ | Receber | /receber |
| ↑ | Carregar | /carregar |
| → | Transferir | /transferir |
| ⚡ | Split | /split |

---

## 7. Analytics obrigatórios

| Evento | Trigger |
|---|---|
| `transferir_initiated` | Módulo aberto |
| `transferir_user_found` | Destinatário localizado |
| `transferir_user_not_found` | Busca sem resultado |
| `transferir_value_set` | Valor confirmado, avança |
| `transferir_pin_success` | PIN validado |
| `transferir_pin_failed` | PIN incorreto |
| `transferir_pin_blocked` | 3 tentativas excedidas |
| `transferir_security_success` | Confirmação de segurança ok |
| `transferir_security_failed` | Resposta incorreta |
| `transferir_completed` | Transferência concluída |
| `transferir_insufficient_balance` | Saldo insuficiente ao tentar |

---

## 8. Critérios de aceitação

| ID | Critério |
|---|---|
| TR-01 | Busca por CPF, @handle e e-mail retorna usuário correto |
| TR-02 | Não encontrado exibe estado vazio com mensagem contextual |
| TR-03 | Teclado numérico limita ao saldo disponível em tempo real |
| TR-04 | Recap card exibe destinatário, valor e taxa gratuita antes do PIN |
| TR-05 | PIN scrambled par-a-par randomizado a cada abertura |
| TR-06 | Screenshot bloqueada na tela de PIN |
| TR-07 | 3 tentativas erradas de PIN bloqueiam por 15 minutos |
| TR-08 | Confirmação de segurança com 1 pergunta sorteada |
| TR-09 | Sem taxa — débito = crédito exato |
| TR-10 | Remetente não pode transferir para si mesmo |
| TR-11 | Push enviado ao destinatário |
| TR-12 | Transação visível em Atividade para ambos |
| TR-13 | Saldo restante correto exibido na tela de sucesso |
