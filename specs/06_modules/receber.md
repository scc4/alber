# Alber — Spec Módulo Receber
**Versão:** 1.0  
**Data:** 28/04/2026  
**Depende de:** 03_backend.md, 05_security.md

---

## 1. Visão geral

Transferência de Albers entre dois usuários. O recebedor inicia o fluxo,
define o valor e identifica o pagador. O pagador autentica no device do
recebedor com PIN scrambled e confirmação de segurança.

**Exclusivamente entre usuários Alber.** Não há entrada de valor externo.

---

## 2. Fluxo completo

```
Recebedor define valor → Pagador informa identificador (CPF/@handle/telefone)
→ Sistema localiza pagador → Pagador digita PIN (scrambled)
→ Confirmação de segurança → BFF processa → Sucesso
```

---

## 3. Telas

### 3.1 Definição do valor
- Recebedor exibido automaticamente (usuário logado)
- Input numérico em Albers, mínimo 1
- Botão "Continuar"

### 3.2 Identificação do pagador
- Campo aceita: CPF, @handle (com ou sem @), telefone brasileiro
- Busca ao completar formato ou tocar "Buscar"
- Encontrado: exibe nome + CPF mascarado
- Não encontrado: "Usuário não encontrado"

### 3.3 PIN do pagador — teclado scrambled par-a-par

```
Pares por tecla (posições randomizadas a cada render):
┌───────┬───────┬───────┐
│ 0|2   │ 5|7   │ 4|6   │
├───────┼───────┼───────┤
│ 1|3   │ 8|9   │  ⌫   │
└───────┴───────┴───────┘

6 caixas preenchidas com •
Screenshot bloqueada
Botão "USE ALBER" habilitado com 6 dígitos
```

**Erros:** shake + "PIN incorreto" + contador | 3 tentativas → bloqueio 15min

### 3.4 Confirmação de segurança
- 1 pergunta sorteada das 4 cadastradas
- 4 opções: 1 real mascarada + 3 falsas
- Posição da correta randomizada
- Confirmação automática ao selecionar
- 3 tentativas erradas → bloqueio 15min
- "Cancelar" → volta sem débito

### 3.5 Processamento BFF
```
Valida PIN → Valida segurança → Verifica saldo (amount + fee)
→ fee = amount * rates.receber
→ Debita pagador (amount + fee)
→ Credita recebedor (amount)
→ Credita conta pai (fee)
→ 3 transações registradas
```

### 3.6 Sucesso
- Tela: "120 Albers recebidos! De: @pagador Para: @recebedor"
- Push para pagador: "Você enviou 120 Albers para @recebedor"
- Push para recebedor (se background): "Você recebeu 120 Albers de @pagador"

---

## 4. Saldo insuficiente

Detectado após PIN e segurança válidos:
```
Saldo atual: 45 Albers
Valor necessário: 120 Albers
Faltam: 75 Albers (em laranja)
[Voltar]
```

Recebedor vê a tela — pode tentar valor menor ou encerrar.

---

## 5. Analytics obrigatórios

`receber_initiated`, `receber_value_set`, `receber_payer_found`,
`receber_payer_not_found`, `receber_pin_success`, `receber_pin_failed`,
`receber_pin_blocked`, `receber_security_success`, `receber_security_failed`,
`receber_insufficient_balance`, `receber_completed`, `receber_cancelled`

---

## 6. Critérios de aceitação

| ID | Critério |
|---|---|
| RE-01 | Recebedor define valor e identifica pagador |
| RE-02 | Busca por CPF, @handle e telefone |
| RE-03 | Pagador exibido com CPF mascarado |
| RE-04 | PIN teclado scrambled par-a-par randomizado |
| RE-05 | Screenshot bloqueada no PIN |
| RE-06 | 3 tentativas erradas → bloqueio 15min |
| RE-07 | Confirmação de segurança com 1 pergunta sorteada |
| RE-08 | Taxa retida do pagador e creditada à conta pai |
| RE-09 | Saldo insuficiente exibe valores detalhados |
| RE-10 | Push para pagador e recebedor |
| RE-11 | Cancelar não realiza débito |
