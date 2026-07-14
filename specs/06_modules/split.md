# Alber — Spec Módulo Split
**Versão:** 1.3
**Data:** 14/07/2026
**Depende de:** 03_backend.md, 05_security.md

---

## 1. Visão geral

Divisão de despesas em grupo. Dono cria o split e escolhe os participantes
(busca por handle) **antes** de criar — não há convite por link. Participantes
selecionados entram como **pendentes**: ninguém é cobrado na criação. Cada
participante recebe uma notificação e precisa **aprovar** individualmente —
só na aprovação a transferência Asaas real acontece (participante → dono).
Recusar remove o participante do split, sem cobrança.

> Decisão v1.2 (extrapola a v1.0/1.1 original): o fluxo antigo de "convite
> via deep link + adesão posterior" foi removido. Motivo: bug em produção
> onde a criação falhava no meio do registro de participantes, deixando o
> split criado só com o dono — a causa raiz era esse modelo em duas fases
> (criar → convidar → aguardar adesão). O novo modelo torna a criação
> atômica: participantes só existem (mesmo que pendentes) se a validação de
> todos os handles passar numa única operação.

> Decisão v1.3: a v1.2 foi longe demais ao cobrar todo mundo automaticamente
> na criação — ninguém deu consentimento antes do débito. Reintroduzido um
> estado `pending` por participante, mas resolvido via aprovação self-service
> (o próprio convidado responde, sem token/link), não mais via convite por
> deep link como na v1.0.

---

## 2. Tipos de Split

| Tipo | Débito | Saldo bloqueado | Fechamento |
|---|---|---|---|
| Fixo | Na aprovação de cada participante (final) | Não | Automático (quando ninguém mais está pendente) |
| Variável | Na aprovação de cada participante (bloqueio) | valor alvo ÷ participantes | Manual pelo dono |

Em ambos os tipos, cada participante selecionado (exceto o dono) paga sua
quota via transferência Asaas real para a carteira do dono **no momento em
que aprova o convite**, não na criação do split. O dono nunca paga — no tipo
variável, a quota dele é reservada virtualmente na criação (o dinheiro já
está na própria subconta), sem transferência Asaas.

---

## 3. Criar Split

### Etapa 1 — Nome e tipo
- Nome do split (texto livre)
- Tipo: Fixo ou Variável (com explicação de cada)

### Etapa 2 — Valor e vagas

**Fixo:**
- Valor total do split
- Número de participantes (incluindo o dono)
- "Cada um paga: R$ X" (calculado live)

**Variável:**
- Valor alvo (teto obrigatório — não pode ultrapassar)
- Número de participantes (incluindo o dono)
- "Cada um terá bloqueado: R$ X" (calculado live)
- Aviso: valor reservado no saldo ao entrar, definido pelo dono no fechamento

### Etapa 3 — Selecionar participantes (obrigatório)
- Busca por handle (@handle ou CPF)
- Adiciona participantes até preencher exatamente `vagas - 1` (todas as vagas
  definidas na Etapa 2, menos o dono)
- Botão "Criar Split" só habilita quando todas as vagas estiverem preenchidas
- Cada participante exibido como chip removível antes de confirmar

### Criar (confirmação)
1. Backend valida que todos os handles resolvem para usuários existentes e
   têm conta financeira configurada (`PARTICIPANTS_NOT_FOUND`/`PARTICIPANTS_NO_ACCOUNT`)
   — não checa saldo aqui, saldo só importa na aprovação
2. Backend valida saldo do **dono**, se variável (quota virtual dele)
3. Split é criado (`status: 'open'`, mesmo fixo), dono entra `accepted`,
   participantes selecionados entram `pending` — ninguém além do dono é
   cobrado nesta etapa
4. Cada participante recebe push: "Você foi convidado para um Split"
5. App navega direto para o detalhe do split criado

---

## 3.1 Aprovar ou recusar convite (participante)

Sem link/token — o próprio convidado responde direto na tela de detalhe do
split (mesma rota do push de convite), com card mostrando sua quota e os
botões "Aceitar"/"Recusar".

**Aceitar:**
1. Backend verifica saldo Asaas do participante — insuficiente bloqueia com
   CTA "Carregar Albers", participante continua `pending` (pode tentar de novo)
2. Transferência Asaas real: participante → carteira do dono
3. Falha na transferência (raro, saldo já validado) → participante continua
   `pending`, sem alterações — diferente da criação, aqui não existe "desfazer
   o split todo", só essa tentativa falhou
4. Sucesso → participante vira `accepted` (`blocked_amount` só no variável)
5. Fixo: se depois dessa aprovação não sobrar mais ninguém `pending`, o split
   fecha automaticamente (`status: 'closed'`)
6. Push para o dono: "Fulano entrou no split"

**Recusar:**
- Remove a linha do participante (sem estado "recusado" — deletar é
  suficiente, o histórico fica no audit log)
- Push para o dono: "Fulano recusou o convite"
- Não redistribui o valor entre os demais nem cancela o split — o total
  efetivamente arrecadado pode ficar abaixo do valor alvo se alguém recusar

---

## 4. Gestão do Split (dono)

### Tela de detalhe
- Participantes com status `accepted` (✓, com valor bloqueado se variável)
  ou `pending` (⏳, aguardando aprovação)
- Total bloqueado (variável)
- `[Fechar Split]` — somente splits variáveis ainda abertos (fixo fecha
  sozinho quando não sobra ninguém pendente, ver §5)

### Fechar Split variável
```
Tela de alocação:
- Total disponível (sum dos bloqueios)
- Campo de valor individual por participante (editável)
- "Total alocado: R$ X | Teto: R$ Y ✓"
- Devolução automática calculada em tempo real
- Soma não pode ultrapassar valor alvo

→ PIN do dono → Confirmar
→ BFF: debita final_amount, libera excedente, registra transações
```

---

## 5. Split fixo

- Criação: nasce `open`, ninguém cobrado ainda
- Aprovação: débito imediato do participante que aprova, sem PIN (saldo
  validado no momento da aprovação, não na criação)
- Fechamento automático: quando o último participante `pending` aprova (ou é
  removido por recusa), o split vira `closed` sozinho

---

## 6. Lista de Splits

- Seções: ATIVOS | ENCERRADOS (colapsável)
- Card: nome, tipo, participantes, valor, status
- [+ Criar Split] no topo

---

## 7. Analytics obrigatórios

`split_list_viewed`, `split_create_started`, `split_created`,
`split_create_failed`, `split_invite_accepted`, `split_invite_declined`,
`split_close_started`, `split_closed`

---

## 8. Critérios de aceitação

| ID | Critério |
|---|---|
| SP-01 | Split fixo debita o participante somente quando ele aprova, não na criação |
| SP-02 | Split variável bloqueia valor alvo ÷ participantes somente na aprovação de cada um |
| SP-03 | Handle sem conta financeira configurada bloqueia a criação inteira, nada é criado |
| SP-04 | Etapa de participantes exige preencher todas as vagas antes de permitir criar |
| SP-05 | Handle inválido/inexistente bloqueia a criação com mensagem clara |
| SP-06 | Saldo insuficiente do participante na aprovação bloqueia só a aprovação dele, split e demais participantes não são afetados |
| SP-07 | Fechamento variável: dono define valor individual |
| SP-08 | Soma das alocações não ultrapassa valor alvo |
| SP-09 | Excedente devolvido automaticamente |
| SP-10 | PIN exigido do dono no fechamento variável |
| SP-11 | Participantes de um mesmo split enxergam nome/handle uns dos outros (RLS) |
| SP-12 | Push enviado ao participante quando convidado, e ao dono quando alguém aprova/recusa |

---

## 9. Ajustes v1.1 — Split variável aprimorado

### 9.1 Foto por item lançado

Cada item lançado pelo dono pode ter 1 foto vinculada.
Fotos são adicionadas no momento do lançamento — não ao fechar.

**Formulário de lançamento atualizado:**
```
[Lançar item]
  ↓
  - Descrição do item (ex: "Cerveja rodada 1")
  - Valor em R$
  - [📷 Adicionar foto] ← opcional, abaixo do valor
    → Somente câmera (não galeria)
    → 1 foto por item
    → Miniatura exibida no formulário após captura
    → Novo toque substitui a foto anterior
  ↓
[Confirmar lançamento]
```

**No feed do split (visível a todos):**
- Cada item exibe: descrição + valor total + valor por pessoa
- Se tiver foto: miniatura abaixo da descrição, tocável para ampliar em tela cheia
- Fotos visíveis para todos os participantes em tempo real
- Somente o dono pode lançar itens e adicionar fotos

**Armazenamento:**
- Foto armazenada no Supabase Storage vinculada ao item (`split_item_id`)
- Múltiplas fotos por split — uma por item lançado
- Visível em Atividade > detalhe do split após encerramento

**Tela de fechamento:** sem campo de foto — removido desta etapa.

---

### 9.2 Prestar conta progressiva

O dono pode lançar itens da conta em tempo real antes de fechar o split.
Cada lançamento é debitado imediatamente do valor bloqueado dos participantes.

**Fluxo:**
```
Dono abre detalhe do split → [Lançar item]
  ↓
  - Descrição do item (ex: "Cerveja rodada 1")
  - Valor em R$
  - [Confirmar lançamento]
  ↓
Sistema divide igualmente entre TODOS os participantes
  ↓
Débito imediato do valor proporcional do bloqueio de cada um
  ↓
Feed do split atualizado em tempo real para todos os participantes
```

**Visibilidade:**
- Todos os participantes veem o total acumulado da conta em tempo real
- Feed mostra cada item lançado: descrição, valor, valor por pessoa
- Participante vê: "Sua parte até agora: R$ X de R$ Y bloqueados"

**Regras:**
- Soma dos lançamentos não pode ultrapassar o valor alvo (teto)
- Se lançamento ultrapassaria o teto: bloqueado com mensagem ao dono
- Após lançamentos, ao fechar: tela de fechamento mostra total já debitado
  e permite ajuste fino dos valores finais (dentro do teto)

---

## 10. Critérios de aceitação adicionais (v1.1)

| ID | Critério |
|---|---|
| SP-13 | Foto opcional por item lançado — somente câmera, 1 foto por item |
| SP-14 | Foto do item visível no feed em tempo real para todos os participantes |
| SP-15 | Lançamento de item debita imediatamente do bloqueio de cada participante |
| SP-15b | Tela de fechamento não exibe campo de foto |
| SP-16 | Todos os participantes veem total acumulado em tempo real |
| SP-17 | Lançamento bloqueado se ultrapassar valor alvo |
