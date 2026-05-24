# Alber — Spec Módulo Alber Lounge
**Versão:** 1.2  
**Data:** 30/04/2026  
**Depende de:** 02_design_system.md, 03_backend.md

---

## 1. Visão geral

Comunidades dentro do Alber. Cada Lounge tem identidade visual própria (skin),
membros, gestores e pode criar eventos com venda de ingressos por lotes.
Qualquer usuário pode criar até 1 Lounge — sem aprovação prévia.

---

## 2. Perfis de acesso

| Perfil | Capacidades |
|---|---|
| Membro | Explorar, solicitar entrada, participar de eventos |
| Gestor | Membro + enviar mensagens, gerenciar membros, criar eventos, ver confirmados |
| Dono | Gestor + nomear gestores, customizar Lounge, definir tipo |

**Criação livre:** qualquer usuário cadastrado pode criar 1 Lounge pelo app.
Sem aprovação prévia do admin. Limite: 1 lounge ativo por usuário.


---

## 4. Criar Lounge (qualquer usuário)

```
Módulo Lounges → Meus Lounges → [+ Criar Lounge]
ou
Perfil → [+ Criar meu Lounge]
  ↓
Etapa 1: Nome e descrição
Etapa 2: Tipo (Público / Privado)
Etapa 3: Imagem de capa e customização visual básica
  ↓
Lounge criado — usuário vira dono automaticamente
```

**Regras:**
- Limite: 1 lounge ativo por usuário
- Usuário com lounge ativo vê botão desabilitado:
  "Você já possui um Lounge ativo. Encerre-o para criar um novo."
- Sem aprovação prévia — lounge fica visível imediatamente
- Moderação via painel admin (remoção por violação de termos)

---

## 5. Tela principal — tabs

**Meus Lounges:** Lounges onde é membro, gestor ou dono  
**Explorar:** busca + lista de Lounges públicos e privados

---

## 5. Tela de detalhe do Lounge

- Hero + logo + nome + descrição + nº membros
- [Solicitar entrada] ou [Membro ✓]
- Seção EVENTOS (EventCards com lote atual e disponibilidade)
- Seção MENSAGENS DO SPACE (feed de mensagens dos gestores/dono)

---

## 6. Entrada no Lounge

### Lounge público
```
Solicitar entrada → notifica dono/gestor → aprovação/recusa
→ push "Bem-vindo!" ou "Solicitação recusada"
```

### Lounge privado
```
Somente via link: alber://lounge/{id}/convite/{token}
→ Preview → [Entrar] → entrada imediata (link = autorização)
```

---

## 7. Painel de gestão (dono/gestor)

- Configurações: Público / Privado
- Membros: aprovações pendentes, lista completa, nomear gestores
- Convites: gerar link de convite, links ativos
- Mensagens: enviar para todos (push + feed)
- Visual: customizar Lounge
- Eventos: criar evento, eventos ativos, lista de confirmados por evento

---

## 8. Customizar Lounge

- Imagem de fundo (upload ou URL)
- Hero / logo (upload)
- Cor de acento (color picker com range seguro de contraste)
- Preview da Home com a skin aplicada
- Sistema rejeita cor com contraste insuficiente
- Shell fixa nunca alterada

---

## 9. Eventos

### 8.1 Criar evento (3 etapas)

**Etapa 1 — Informações básicas:**
- Nome do evento
- Descrição
- Data e hora
- Imagem (upload)
- Capacidade total: definida pela soma dos lotes
- Recorrente: sim / não
  - Se sim: frequência (diário / semanal / quinzenal / mensal)
  - Cada edição recorrente tem seus próprios lotes e ingressos independentes

**Etapa 2 — Tipo, lotes e visibilidade:**

Gratuito:
- Sem lotes de preço — apenas capacidade total (opcional)
- Visibilidade: Só membros / Aberto para todos

Pago:
- Configurar lotes de preço. Dois tipos:

  Lote por quantidade:
  ```
  Lote 1: primeiros [100] ingressos → R$ [50,00]
  Lote 2: próximos [100] ingressos → R$ [80,00]
  [+ Adicionar lote]
  ```

  Lote por data:
  ```
  Lote 1: até [DD/MM/AAAA] → R$ [50,00]
  Lote 2: até [DD/MM/AAAA] → R$ [80,00]
  [+ Adicionar lote]
  ```

  Regras dos lotes:
  - Mínimo 1 lote, sem máximo definido
  - Esgotado um lote → próximo abre automaticamente
  - Capacidade do evento = soma das capacidades de todos os lotes
  - Valor em R$ → convertido em Albers no momento da compra (paridade 1:1 no MVP)

- Visibilidade: Só membros / Aberto para todos

**Etapa 3 — Revisão e publicar:**
- Resumo completo do evento, lotes e configuração
- [Publicar] → evento ativo no Lounge

---

### 8.2 Comprar ingresso

```
Membro abre detalhe do evento
  ↓
EventCard exibe:
  - Lote atual ativo + preço em R$ + equivalente em Albers
  - Vagas restantes no lote atual
  - Badge "Últimas vagas" quando restarem ≤ 10% da capacidade do lote
  - Badge "Esgotado" e botão desabilitado quando lote esgotado
    e não há próximo lote
  ↓
Gratuito:
  → [Garantir ingresso] → confirmação imediata

Pago:
  → [Comprar ingresso — R$ X (Y Albers)]
  → Verifica saldo ≥ valor em Albers
  → Saldo insuficiente: CTA carregar
  → Saldo suficiente: PIN (scrambled) → BFF debita + taxa evento → confirmado
```

---

### 8.3 Ingresso confirmado

- Confirmação visual no módulo Atividade > Ingressos
- Não é QR code
- Exibe: nome do evento, data/hora, Lounge, valor pago, lote
- [Ver evento] no card de Atividade

---

### 8.4 Lista de confirmados (dono/gestor)

Acessível no painel de gestão do Lounge → aba do evento:
- Lista de membros com ingresso confirmado
- Nome, @handle, lote comprado, data/hora da compra
- Exportação futura (escopo pós-MVP)

---

### 8.5 Edição pós-publicação

**Pode editar:**
- Nome do evento
- Descrição
- Imagem
- Data e hora

**Não pode editar:**
- Valor dos lotes
- Capacidade dos lotes
- Tipo (gratuito/pago)

**Ao salvar edição:** push automático para todos com ingresso confirmado:
"O evento '{nome}' foi atualizado. Verifique as novas informações."

---

### 8.6 Cancelamento de evento

**Evento avulso:**
```
Dono cancela → confirmação → BFF reembolsa todos automaticamente
→ push: "O evento '{nome}' foi cancelado. Seu saldo foi reembolsado."
```

**Evento recorrente:**
```
Dono cancela → escolha:
  ○ Cancelar só esta edição
  ○ Cancelar esta e todas as futuras

→ Para cada edição cancelada: reembolso automático imediato
→ push para cada participante com ingresso pago
```

---

### 8.7 Modelo de dados de eventos

```sql
CREATE TABLE events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id        UUID REFERENCES lounges(id) ON DELETE CASCADE,
  creator_id      UUID REFERENCES users(id),
  name            TEXT NOT NULL,
  description     TEXT,
  image_url       TEXT,
  date            TIMESTAMPTZ NOT NULL,
  visibility      TEXT NOT NULL,        -- 'members_only' | 'public'
  is_paid         BOOLEAN DEFAULT false,
  is_recurring    BOOLEAN DEFAULT false,
  recurrence_freq TEXT,                 -- 'daily'|'weekly'|'biweekly'|'monthly'
  parent_event_id UUID REFERENCES events(id), -- para edições recorrentes
  status          TEXT DEFAULT 'active',-- 'active' | 'cancelled'
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE event_batches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID REFERENCES events(id) ON DELETE CASCADE,
  batch_number INT NOT NULL,            -- ordem do lote (1, 2, 3...)
  batch_type   TEXT NOT NULL,           -- 'quantity' | 'date'
  price_brl    NUMERIC(10,2) NOT NULL,
  capacity     INT NOT NULL,
  sold         INT DEFAULT 0,
  valid_until  TIMESTAMPTZ,             -- para tipo 'date'
  status       TEXT DEFAULT 'pending',  -- 'pending'|'active'|'sold_out'|'expired'
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE event_tickets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id),
  batch_id    UUID REFERENCES event_batches(id),
  user_id     UUID REFERENCES users(id),
  price_brl   NUMERIC(10,2),
  price_albers NUMERIC(10,2),
  status      TEXT DEFAULT 'confirmed', -- 'confirmed' | 'refunded'
  purchased_at TIMESTAMPTZ DEFAULT now()
);
```

---

### 8.8 Lógica de ativação automática de lotes

```
Lote por quantidade:
  batch.sold >= batch.capacity
  → batch.status = 'sold_out'
  → próximo lote (batch_number + 1) com status 'pending'
    → status = 'active'

Lote por data:
  now() >= batch.valid_until
  → batch.status = 'expired'
  → próximo lote → status = 'active'

Ambos verificados:
  - No momento de cada compra (sincrono)
  - Job periódico a cada 5 minutos para lotes por data
```

---

## 10. Lounge ativo na Home

- Definido em: detalhe do Lounge → [Definir como Lounge atual]
- Ou em: Perfil → Lounges → selecionar ativo
- Apenas Lounges onde o usuário é membro
- Sem Lounge ativo: skin padrão black/white

---

## 11. Analytics obrigatórios

| Evento | Trigger |
|---|---|
| `lounge_list_viewed` | Tela principal aberta |
| `lounge_detail_viewed` | Detalhe de Lounge aberto |
| `lounge_join_requested` | Solicitação enviada |
| `lounge_joined` | Membro aprovado/entrou |
| `lounge_set_active` | Lounge definido como ativo na Home |
| `event_detail_viewed` | Detalhe de evento aberto |
| `event_batch_viewed` | Lote ativo exibido ao abrir evento |
| `event_batch_sold_out` | Lote esgotado, próximo ativado |
| `event_ticket_initiated` | Toque em garantir/comprar ingresso |
| `event_ticket_completed` | Ingresso confirmado |
| `event_ticket_insufficient` | Saldo insuficiente no evento |
| `event_cancelled_edition` | Dono cancelou edição específica |
| `event_cancelled_all` | Dono cancelou todas as edições futuras |
| `event_edited` | Dono editou informações do evento |
| `lounge_message_sent` | Mensagem enviada para membros |

---

## 12. Critérios de aceitação

| ID | Critério |
|---|---|
| AS-01 | Donos habilitados apenas via painel admin |
| AS-02 | Lounge público exige solicitação + aprovação |
| AS-03 | Lounge privado acessível apenas via link |
| AS-04 | Mensagem entregue via push + feed |
| AS-05 | Customização validada automaticamente por contraste |
| AS-06 | Shell fixa nunca alterada pela skin |
| AS-07 | Evento pago exige PIN e verifica saldo |
| AS-08 | Cancelamento reembolsa automaticamente todos |
| AS-09 | Ingresso confirmado visível em Atividade |
| AS-10 | Lounge ativo reflete skin na Home |
| AS-11 | Taxa de evento configurada no painel admin |
| AS-12 | Lote esgotado ativa próximo automaticamente |
| AS-13 | Badge "Últimas vagas" com ≤ 10% de capacidade |
| AS-14 | Evento recorrente — cada edição tem lotes próprios |
| AS-15 | Cancelamento recorrente oferece opção: só esta ou todas futuras |
| AS-16 | Edição pós-publicação não permite alterar valor ou lotes |
| AS-17 | Edição de nome/descrição/data dispara push para confirmados |
| AS-18 | Lista de confirmados visível no painel de gestão |
