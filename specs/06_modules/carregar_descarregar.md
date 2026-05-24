# Alber — Spec Módulo Carregar / Descarregar
**Versão:** 1.0  
**Data:** 28/04/2026  
**Depende de:** 03_backend.md, 04_api_asaas.md, 05_security.md

---

## 1. Visão geral

Operações de entrada (Carregar) e saída (Descarregar) de valor real via Pix.
Ambas exigem conta Pix de mesma titularidade do usuário (mesmo CPF).
Ambas bloqueadas até KYC aprovado.

**Regra central:** Alber só movimenta dinheiro entre contas de mesma titularidade.

---

## 2. Ponto de entrada

Tela unificada com dois caminhos: Carregar Albers | Descarregar Albers

Acessado via: Action row "Carregar" na Home | CTA "+ Carregar mais" | Tela de saldo insuficiente

---

## 3. Fluxo — Carregar

### 3.1 Verificações iniciais
```
kyc_status != 'approved' → bloqueio com CTA para KYC
account_status = 'evaluation' + total >= R$2.000 → bloqueio de limite
```

### 3.2 Definição do valor
- Input em R$ com máscara monetária
- Valor mínimo: R$ 5,00
- Atalhos: R$ 20, R$ 50, R$ 100, R$ 200
- Botão "Gerar QR Code"

### 3.3 QR Code Pix
- QR code dinâmico gerado via BFF → Asaas
- Expiração: 30 minutos com countdown em tempo real (MM:SS)
- CPF exibido mascarado para confirmar ao usuário
- "Copiar código Pix" + "Compartilhar"
- Aviso: "Pague apenas de conta no seu CPF"

**Expiração:** QR riscado + "Gerar novo QR Code" → volta para tela de valor

### 3.4 Confirmação (via webhook)
```
CPF coincide → credita saldo + push "R$ {valor} carregados!"
CPF diverge  → devolução automática + push "Pix devolvido: CPF não corresponde"
```

---

## 4. Fluxo — Descarregar

### 4.1 Verificações
- KYC aprovado obrigatório
- Chave Pix cadastrada obrigatória

### 4.2 Definição do valor
- Input em R$, mínimo R$ 10,00, máximo = saldo disponível
- Destino: chave Pix mascarada + "Trocar chave"
- "Você receberá: R$ --,--" (atualiza live com taxa)

### 4.3 Autenticação dupla
```
PIN (scrambled) → Confirmação de segurança → Processamento
```

### 4.4 Processamento
```
BFF: valida PIN + segurança → verifica saldo → verifica CPF chave Pix
→ calcula taxa → debita saldo → chama Asaas transfer → registra transações
```

Falha no Asaas → saldo restaurado automaticamente

---

## 5. Gerenciamento de chave Pix

### 5.1 Cadastro
- Tipos: CPF (auto, read-only) | Telefone | Email | Chave aleatória
- Uma vez no perfil, reutilizada sempre

### 5.2 Troca
- Via Perfil → "Chave Pix"
- Exige PIN + confirmação de segurança
- Log de auditoria

---

## 6. Estados globais

| Estado | Comportamento |
|---|---|
| KYC não aprovado | Bloqueio com CTA |
| Sem chave Pix | Solicita cadastro |
| Saldo insuficiente | Botão desabilitado |
| Limite avaliação atingido | Bloqueio informativo |
| QR expirado | Visual expiração + gerar novo |
| Erro de rede | AlertCard + retry |

---

## 7. Analytics obrigatórios

`carregar_screen_viewed`, `carregar_initiated`, `carregar_qr_generated`,
`carregar_qr_copied`, `carregar_qr_expired`, `carregar_completed`,
`carregar_cpf_mismatch`, `descarregar_initiated`, `descarregar_pin_success`,
`descarregar_security_success`, `descarregar_completed`, `descarregar_failed`,
`kyc_blocked_carregar`

---

## 8. Critérios de aceitação

| ID | Critério |
|---|---|
| CD-01 | KYC não aprovado bloqueia carregar e descarregar |
| CD-02 | QR code com valor correto, expira em 30 minutos |
| CD-03 | Countdown visual em tempo real |
| CD-04 | Pix de CPF divergente devolvido automaticamente |
| CD-05 | Saldo creditado apenas após webhook |
| CD-06 | Descarregar exige PIN + confirmação de segurança |
| CD-07 | Saldo debitado antes de chamar Asaas |
| CD-08 | Falha no Asaas restaura saldo |
| CD-09 | Chave Pix mascarada em todas as telas |
| CD-10 | Limite de avaliação verificado antes do QR |
| CD-11 | Taxa no módulo Atividade após conclusão |
| CD-12 | Push ao confirmar carregamento ou devolução |
| CD-13 | Atalhos rápidos funcionam |
| CD-14 | Troca de chave Pix exige autenticação dupla |
