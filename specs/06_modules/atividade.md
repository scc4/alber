# Alber — Spec Módulo Atividade
**Versão:** 1.0  
**Data:** 28/04/2026  
**Depende de:** 03_backend.md

---

## 1. Visão geral

Histórico completo de movimentações. As taxas retidas aparecem discriminadas,
ingressos são consultados e saldo bloqueado em splits é explicado.
Acessível pela bottom nav.

---

## 2. Tela principal

- Saldo disponível + Saldo reservado no topo
- Filtros: [Todas] [Entradas] [Saídas] [Splits] [Ingressos]
- Lista cronológica reversa agrupada por data (HOJE, ONTEM, etc.)

---

## 3. Tipos de transação

| Tipo | Ícone | Sinal | Descrição |
|---|---|---|---|
| `carregar` | ↓ | + | Pix recebido |
| `descarregar` | ↑ | - | Pix enviado |
| `receber` | ↓ | + | Albers recebidos de usuário |
| `enviar` | ↑ | - | Albers enviados |
| `split_block` | 🔒 | - reservado | Saldo bloqueado em split |
| `split_release` | 🔓 | + liberado | Excedente devolvido |
| `split_debit` | ⚡ | - | Débito final do split |
| `event_purchase` | 🎫 | - | Ingresso comprado |
| `event_refund` | 🎫 | + | Reembolso de evento |
| `fee` | % | - | Taxa retida |

---

## 4. Detalhe da transação

**Receber/Enviar:**
```
Valor recebido/enviado: X Albers
Taxa retida: -Y Albers  ← discriminada
Valor bruto: Z Albers
De/Para: @handle
Data + ID da transação
Status: Concluído ✓
```

**Split:**
```
Split: {nome}
Sua parte: -X Albers
Desbloqueado: +Y Albers
[Ver split]
```

**Ingresso:**
```
Evento: {nome} — {Space}
Data do evento: DD/MM/YYYY
Valor: -X Albers
Status: Confirmado ✓
[Ver evento]
```

---

## 5. Filtros

| Filtro | Tipos incluídos |
|---|---|
| Todas | Todos os tipos |
| Entradas | carregar, receber, split_release, event_refund |
| Saídas | descarregar, enviar, split_debit, event_purchase, fee |
| Splits | split_block, split_release, split_debit |
| Ingressos | event_purchase, event_refund |

---

## 6. Saldo bloqueado

Banner quando há saldo reservado:
```
🔒 50 Albers reservados em 1 split ativo
[Ver splits]
```

---

## 7. Paginação

- 20 itens por vez
- Scroll infinito
- Pull-to-refresh atualiza do topo

---

## 8. Analytics obrigatórios

`atividade_viewed`, `atividade_filter_changed`,
`atividade_transaction_tapped`, `atividade_load_more`

---

## 9. Critérios de aceitação

| ID | Critério |
|---|---|
| AT-01 | Transações em ordem cronológica reversa |
| AT-02 | Taxa retida discriminada no detalhe |
| AT-03 | Saldo bloqueado exibido separadamente |
| AT-04 | Filtros por tipo funcionam |
| AT-05 | Ingresso confirmado consultável |
| AT-06 | Paginação com scroll infinito |
| AT-07 | Pull-to-refresh atualiza lista |
| AT-08 | Estado vazio contextual |
