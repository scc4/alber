# Alber — Spec Painel Administrativo
**Versão:** 0.1 — escopo a detalhar
**Data:** 28/04/2026  
**Status:** Backlog — não faz parte do MVP do app mobile

---

## 1. Propósito

Interface de gestão da operação Alber. Acessado exclusivamente pela equipe
interna. Não faz parte do app mobile. Será detalhado em sprint dedicado
após lançamento do MVP.

---

## 2. Funcionalidades mapeadas

### 2.1 Taxas

| Configuração | Descrição |
|---|---|
| Taxa de cash out | % retida em todo descarregamento |
| Taxa de recebimento | % retida em todo Receber entre usuários |
| Taxa de evento | % retida na venda de ingressos de eventos |

**Regras:**
- Efeito imediato em novas transações após alteração
- Transações em andamento usam taxa vigente no início
- Log de todas as alterações com timestamp e responsável
- Toda receita → conta pai Alber no Asaas

---

### 2.2 Alber Lounge

| Ação | Descrição |
|---|---|
| Criar Lounge | Nome, tipo inicial (público/privado), dono |
| Convidar dono | Email + link de habilitação |
| Habilitar conta especial | Marcar conta como elegível a ser dono de Lounge |
| Desativar Lounge | Bloquear Lounge sem deletar dados |
| Listar Lounges | Visão geral com nº de membros, status, receita |

---

### 2.3 Usuários

| Ação | Descrição |
|---|---|
| Listar usuários | Filtros: status, KYC, período de avaliação |
| Ver detalhes | Dados cadastrais, status, saldo, histórico |
| Bloquear conta | Com motivo registrado e notificação ao usuário |
| Monitorar avaliação | Limite utilizado vs disponível por subconta |

---

### 2.4 Financeiro

| Relatório | Descrição |
|---|---|
| Receita de taxas | Por período, por tipo (cashout / receber / evento) |
| Movimentações conta pai | Entradas e saídas consolidadas |
| Volume de transações | Por tipo e período |
| Saldo por subconta | Visão das subcontas Asaas |

---

## 3. Stack sugerida (a confirmar)

- **Frontend:** Next.js (web admin — não mobile)
- **Auth:** Supabase Auth com role `admin`
- **Backend:** mesmo BFF Supabase com RLS para role admin
- **Acesso:** restrito por IP ou VPN (a definir em sprint dedicado)

---

## 4. Próximos passos

1. Priorizar funcionalidades após lançamento MVP
2. Definir roles do painel (super admin, financeiro, suporte)
3. Detalhar spec completo em sprint dedicado
4. Definir requisitos de segurança e política de acesso
5. Avaliar auditoria de ações admin (quem fez o quê e quando)
