# Alber — Spec Segurança
**Versão:** 1.0  
**Data:** 28/04/2026  
**Depende de:** 00_architecture.md, 03_backend.md

---

## 1. Princípio central

Segurança no Alber é uma camada transversal. Toda operação financeira passa
por pelo menos dois fatores de verificação. O sistema protege o usuário mesmo
em situações de device comprometido ou shoulder surfing.

---

## 2. Fator 1 — PIN numérico scrambled

**Especificação:**
- 6 dígitos numéricos
- Armazenado como SHA-256 em trânsito, bcrypt (cost 12) no banco
- Nunca em texto puro em nenhuma camada

**Teclado scrambled par-a-par:**
```
Pares fixos por tecla:
┌─────────┬─────────┬─────────┐
│  0 | 2  │  4 | 6  │  5 | 7  │
├─────────┼─────────┼─────────┤
│  8 | 9  │  1 | 3  │   ⌫    │
└─────────┴─────────┴─────────┘
Posição de cada par randomizada a cada render.
```

**Bloqueio:**
```
3 tentativas erradas consecutivas → bloqueio 15 minutos
5 tentativas erradas no dia       → bloqueio 24 horas
10 tentativas erradas no mês      → bloqueio até suporte
```

**Anti-shoulder surfing:**
- Posições randomizadas a cada render
- Screenshot bloqueada (Android: FLAG_SECURE | iOS: secureTextEntry + blur)

---

## 3. Fator 2 — Confirmação de segurança

**Especificação:**
- 4 perguntas cadastradas pelo usuário no onboarding
- Respostas: bcrypt (cost 12)
- Por operação: sorteia 1 das 4 aleatoriamente
- Exibe 4 opções: 1 real mascarada + 3 falsas geradas

**Mascaramento:**
```
Até 4 chars:    mostrar primeiro e último — "Ana" → "A*a"
5 a 8 chars:    2 primeiros e 2 últimos — "Bolinha" → "Bo***ha"
Mais de 8:      3 primeiros e 3 últimos — "Joaquina" → "Joa**ina"
```

**Bloqueio:** 3 tentativas erradas → bloqueio 15 min + exige código SMS/email

---

## 4. Fluxos com autenticação dupla

| Operação | PIN | Confirmação segurança |
|---|---|---|
| Login | ✅ | ✅ |
| Receber (pagador) | ✅ | ✅ |
| Descarregar | ✅ | ✅ |
| Trocar PIN | ✅ | ✅ + código SMS/email |
| Trocar @handle | ✅ | ✅ |
| Cadastrar/trocar chave Pix | ✅ | ✅ |
| Recuperar PIN | — | ✅ + código SMS/email |
| Fechar Split (dono) | ✅ | ❌ |
| Comprar ingresso evento | ✅ | ❌ |
| Carregar (gerar QR) | ❌ | ❌ |

---

## 5. Fluxo "Esqueci meu PIN"

```
1. Informa CPF ou @handle
2. Sistema sorteia 1 das 4 perguntas
3. Seleciona resposta correta entre mascaradas
4. Código 6 dígitos via SMS ou email (válido 10 min, uso único)
5. Define novo PIN no teclado scrambled
6. Todas as sessões ativas invalidadas
7. Log de auditoria registrado
```

---

## 6. Gestão de sessão

```
Token JWT — expiração: 30 dias com uso ativo
Refresh token com rotação automática
Armazenado em expo-secure-store

Timeout:
- Foreground sem interação 15 min → solicita PIN
- Background > 5 min → solicita PIN ao retornar
- App fechado e reaberto → sempre solicita PIN

Invalidação:
- Troca de PIN invalida TODAS as sessões
- Logout manual invalida token no servidor
```

---

## 7. Proteção de dados sensíveis

| Dado | Armazenamento |
|---|---|
| PIN | bcrypt cost 12; SHA-256 em trânsito |
| Respostas de segurança | bcrypt cost 12 |
| CPF | Hash SHA-256 no banco |
| Chave Pix | AES-256 no banco |
| API key subconta Asaas | AES-256 no banco |
| Token JWT | expo-secure-store |

**Mascaramento na UI:**
- CPF: `***.***.*XX-XX`
- Telefone: `(**) *****-XXXX`
- Email: `us***@dom***.com`

---

## 8. Proteção contra ataques

- Rate limiting por user_id e IP no BFF
- Bloqueio progressivo por tentativas
- Tokens de operação de uso único
- Idempotência via externalReference
- TLS 1.3 obrigatório
- Certificate pinning no app
- Webhook Asaas validado por HMAC
- RLS ativo em todas as tabelas Supabase

---

## 9. Auditoria obrigatória

```sql
-- Eventos registrados em audit_logs:
'login_success' | 'login_failed' | 'pin_failed' | 'pin_blocked'
'security_question_failed' | 'security_question_blocked'
'pin_changed' | 'handle_changed' | 'pix_key_changed'
'pin_recovery_started' | 'pin_recovery_completed'
'cashout_initiated' | 'cashout_completed'
'pix_rejected_cpf_mismatch'
'kyc_submitted' | 'kyc_approved' | 'kyc_rejected'
'session_invalidated'
```

---

## 10. Lista de perguntas de segurança

```
- Nome do seu primeiro animal de estimação
- Nome da sua avó materna
- Nome da sua avó paterna
- Cidade onde seus pais se conheceram
- Nome do seu melhor amigo da infância
- Qual era o modelo do primeiro carro da sua família
- Nome da rua onde você cresceu
- Nome do seu professor favorito do ensino fundamental
- Qual era o apelido que seus amigos te davam
- Nome do seu time favorito quando criança
```

**Regras:**
- 4 perguntas distintas obrigatórias
- Resposta: mínimo 2, máximo 50 caracteres
- Case-insensitive (lowercase antes do hash)
- Acentos removidos antes do hash

---

## 11. KYC — segurança no envio

```
Upload via URL assinada temporária (5 min) → Supabase Storage (bucket privado)
→ BFF envia referência ao Asaas
→ Documentos deletados após confirmação de recebimento pelo Asaas
```

---

## 12. Checklist pré go-live

```
[ ] Certificate pinning implementado e testado
[ ] Rate limiting ativo em todas as Edge Functions
[ ] RLS validado em todas as tabelas
[ ] Webhook Asaas validando assinatura HMAC
[ ] Nenhuma chave privada em variável EXPO_PUBLIC_*
[ ] Screenshot bloqueada nas telas de PIN e segurança
[ ] Logs de auditoria registrando todos os eventos críticos
[ ] Testes de brute force no PIN e perguntas de segurança
[ ] Validação de CPF no webhook testada com casos divergentes
[ ] Sessões invalidadas corretamente na troca de PIN
[ ] Dados sensíveis ausentes em crash reports e analytics
[ ] Penetration test básico antes do lançamento
```
