# Alber — Spec Módulo Home
**Versão:** 1.0  
**Data:** 28/04/2026  
**Depende de:** 02_design_system.md, 03_backend.md, 05_security.md

---

## 1. Visão geral

A Home é o hub central do Alber. Primeira tela após autenticação e ponto de
partida para todos os fluxos operacionais. Tela âncora: Home VF 27 Abril.

---

## 2. Composição (top → bottom)

```
[Logo A]  Boa noite, {nome}
          Você tem {X} Albers
          + Carregar mais
─────────────────────────────
      [Arte de fundo do Lounge]
         Seu Lounge atual
         {Nome do Lounge}
─────────────────────────────
  ☁ Receber
  ↑ Carregar
  ⚡ Split
─────────────────────────────
[Perfil] [Achar] [Lounge] [Atividade]
```

---

## 3. Componentes

### 3.1 Header
- Logo "A" (top left)
- Saudação por horário: 05h–12h "Bom dia" | 12h–18h "Boa tarde" | 18h–05h "Boa noite"
- Shell fixa — nunca removido por skin

### 3.2 Bloco de saldo
- "Você tem / [120] Albers / + Carregar mais"
- Toque no valor: toggle ocultar/exibir → "•••• Albers"
- Preferência salva em SecureStore

**Estados:** loading (skeleton), error (retry), zero (CTA destacado),
hidden (••••), blocked (mostra reservado em splits)

### 3.3 Lounge atual
- Label "Seu Lounge atual" + Nome do Lounge
- Arte de fundo: skin variável do Lounge
- Sem Lounge: "USE ALBER" + skin padrão black/white
- Toque → navega para detalhe do Lounge
- Overlay automático se contraste insuficiente

### 3.4 Action rows

| Ícone | Label | Rota | Condição |
|---|---|---|---|
| ☁ | Receber | `/receber` | Sempre disponível |
| → | Transferir | `/transferir` | Sempre disponível |
| ↑ | Carregar | `/carregar` | KYC pendente → abre fluxo KYC |
| ⚡ | Split | `/split` | Sempre disponível |

**Estados:** default, pressed, disabled, blocked-by-policy (tooltip ao tocar)

### 3.5 Bottom nav

| Posição | Label | Rota |
|---|---|---|
| 1 | Perfil | /perfil |
| 2 | Achar | /achar |
| 3 | Lounge | /lounge |
| 4 | Atividade | /atividade |

---

## 4. Banners contextuais (prioridade)

| Prioridade | Condição | CTA |
|---|---|---|
| 1 | KYC pendente | "Verificar agora" |
| 2 | KYC em análise | "Ver status" |
| 3 | KYC reprovado | "Reenviar" |
| 4 | Conta em avaliação | "Saiba mais" |
| 5 | Split expirado | "Ver Splits" |

Um banner por vez. Dispensável (exceto KYC reprovado).

---

## 5. Dados carregados

```typescript
// Paralelas — não sequenciais
Promise.all([
  fetchBalance(),
  fetchCurrentSpace(),
  fetchUserPermissions(),
  fetchPendingBanners(),
])
```

- Pull-to-refresh disponível
- Auto-refresh ao retornar de fluxo filho
- Auto-refresh ao receber push de transação

---

## 6. Comportamento com Lounge customizado

```
Shell fixa (nunca alterada): Header, Saldo, Action rows, Bottom nav
Skin variável: Arte de fundo, Hero, Nome do Lounge, Cor de acento
Proteção: sistema decide contraste automaticamente
```

---

## 7. Analytics obrigatórios

`home_viewed`, `home_balance_hidden`, `home_action_receber`,
`home_action_carregar`, `home_action_split`, `home_space_tapped`,
`home_banner_tapped`, `home_carregar_mais_tapped`, `home_pull_refresh`

---

## 8. Critérios de aceitação

| ID | Critério |
|---|---|
| HO-01 | Saldo com loading e erro tratados |
| HO-02 | Saudação contextual por horário |
| HO-03 | Lounge ativo exibe skin sem quebrar shell |
| HO-04 | Sem Lounge exibe skin padrão |
| HO-05 | Action rows respeitam permissões e KYC |
| HO-06 | Banner correto por prioridade |
| HO-07 | Pull-to-refresh atualiza dados |
| HO-08 | Toque no saldo faz toggle ocultar/exibir |
| HO-09 | Bottom nav com item ativo destacado |
| HO-10 | Overlay automático quando skin compromete contraste |
| HO-11 | Dados carregados em paralelo |
| HO-12 | Auto-refresh ao retornar de fluxo filho |
