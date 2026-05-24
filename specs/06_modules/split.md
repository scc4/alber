# Alber — Spec Módulo Split
**Versão:** 1.0  
**Data:** 28/04/2026  
**Depende de:** 03_backend.md, 05_security.md

---

## 1. Visão geral

Divisão de despesas em grupo. Dono cria split, convida via link deep link,
participantes aderem com validação de saldo automática.

---

## 2. Tipos de Split

| Tipo | Débito | Saldo bloqueado | Fechamento |
|---|---|---|---|
| Fixo | Imediato na adesão | Não | Automático |
| Variável | No fechamento | valor alvo ÷ participantes | Manual pelo dono |

---

## 3. Criar Split

### Etapa 1 — Nome e tipo
- Nome do split (texto livre)
- Tipo: Fixo ou Variável (com explicação de cada)

### Etapa 2 — Valor e participantes

**Fixo:**
- Valor total do split
- Número de participantes (incluindo o dono)
- "Cada um paga: R$ X" (calculado live)

**Variável:**
- Valor alvo (teto obrigatório — não pode ultrapassar)
- Para quantas pessoas vai enviar o link (além do dono)
- "Cada um terá bloqueado: R$ X" (calculado live)
- Aviso: valor reservado no saldo ao entrar, definido pelo dono no fechamento

### Etapa 3 — Validade do link
- Opções: 1 hora | 24 horas | 7 dias | Personalizado

### Split criado
- Link gerado: `alber://split/convite/{token}`
- "Copiar" + "Compartilhar link" (share nativo)
- Lista de contatos Alber para facilitar compartilhamento (se permissão)
- Dono é automaticamente o primeiro participante

---

## 4. Entrar em Split via link

```
Link recebido → App abre → (login se necessário) → Preview do split
```

### Preview
- Nome, tipo, valor, dono, participantes atuais, prazo
- Valor a ser bloqueado (variável) ou debitado (fixo)
- Saldo do usuário: ✓ suficiente | ✗ insuficiente

**Saldo suficiente:** entra direto  
**Saldo insuficiente:** bloqueado + CTA "Carregar Albers" obrigatório

**Split fixo:** débito imediato na adesão  
**Split variável:** bloqueia `target_amount / max_participants` no saldo

### Link expirado
- Tela informativa + push para dono
- Dono pode reenviar ou estender prazo

---

## 5. Gestão do Split (dono)

### Tela de detalhe
- Participantes com status: ✓ aceito (R$ bloqueado 🔒) | ⏳ aguardando
- Total bloqueado
- [Reenviar link] [Estender prazo] [Fechar Split]

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

### Reenviar / Estender link
- Reenviar: novo link + mesma tela de compartilhamento
- Estender: date picker (mín: agora + 1h) + push para pendentes

---

## 6. Split fixo

- Adesão: débito imediato sem PIN (saldo já validado)
- Fechamento automático quando todos aderiram ou link expirou
- Dono pode encerrar manualmente

---

## 7. Contatos com Alber no Split

- Permissão solicitada ao abrir Split pela primeira vez
- Sincronização sob demanda (ao abrir ou atualizar manualmente)
- Lista de contatos da agenda que são usuários Alber
- "Compartilhar" abre share nativo com link pré-preenchido
- Se permissão negada: seção não exibida, sem erro

---

## 8. Lista de Splits

- Seções: ATIVOS | ENCERRADOS (colapsável)
- Card: nome, tipo, participantes, valor, status, prazo
- [+ Criar Split] no topo

---

## 9. Analytics obrigatórios

`split_list_viewed`, `split_create_started`, `split_created`,
`split_link_copied`, `split_link_shared`, `split_join_viewed`,
`split_joined`, `split_join_insufficient`, `split_join_declined`,
`split_link_expired`, `split_extended`, `split_close_started`, `split_closed`

---

## 10. Critérios de aceitação

| ID | Critério |
|---|---|
| SP-01 | Split fixo debita imediatamente na adesão |
| SP-02 | Split variável bloqueia valor alvo ÷ participantes |
| SP-03 | Saldo insuficiente bloqueia com CTA carregar |
| SP-04 | Deep link abre app e redireciona para preview |
| SP-05 | Link expirado exibe tela informativa e notifica dono |
| SP-06 | Dono pode reenviar link ou estender prazo |
| SP-07 | Fechamento variável: dono define valor individual |
| SP-08 | Soma das alocações não ultrapassa valor alvo |
| SP-09 | Excedente devolvido automaticamente |
| SP-10 | PIN exigido do dono no fechamento variável |
| SP-11 | Contatos Alber exibidos se permissão concedida |
| SP-12 | Push ao entrar e ao fechar split |

---

## 11. Ajustes v1.1 — Split variável aprimorado

### 11.1 Foto por item lançado

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

### 11.2 Prestar conta progressiva (novo comportamento)

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
Sistema divide igualmente entre TODOS os participantes ativos
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

### 11.3 Recálculo ao entrar novo participante após lançamentos

Quando um novo participante entra num split variável que já tem lançamentos:

```
Regra:
- O que já foi debitado permanece (lançamentos anteriores são imutáveis)
- O saldo restante (teto - total lançado) é recalculado igualmente
  entre TODOS os participantes incluindo o novo

Exemplo:
  Teto: R$ 300 | 3 participantes originais
  Lançamentos até agora: R$ 90 (R$ 30 cada)
  Novo participante entra:
  → Total agora: 4 participantes
  → Saldo restante: R$ 210
  → R$ 210 ÷ 4 = R$ 52,50 por pessoa (novo bloqueio adicional)
  → Participantes originais: desbloqueiam R$ 30 (excedente),
    bloqueiam R$ 52,50 (novo proporcional)
  → Novo participante: bloqueia R$ 52,50

Push para todos: "Um novo participante entrou. Seu valor foi recalculado."
```

**Bloqueio do novo participante ao entrar:**
- Sistema calcula: saldo_restante ÷ total_participantes
- Se saldo insuficiente: bloqueado de entrar com CTA carregar

---

## 12. Critérios de aceitação adicionais (v1.1)

| ID | Critério |
|---|---|
| SP-13 | Foto opcional por item lançado — somente câmera, 1 foto por item |
| SP-14 | Foto do item visível no feed em tempo real para todos os participantes |
| SP-15 | Lançamento de item debita imediatamente do bloqueio de cada participante |
| SP-15b | Tela de fechamento não exibe campo de foto |
| SP-16 | Todos os participantes veem total acumulado em tempo real |
| SP-17 | Lançamento bloqueado se ultrapassar valor alvo |
| SP-18 | Novo participante recalcula saldo restante igualmente entre todos |
| SP-19 | Push enviado a todos ao entrar novo participante após lançamentos |
| SP-20 | Lançamentos anteriores preservados no recálculo |
