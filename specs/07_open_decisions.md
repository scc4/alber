# Alber — Decisões em Aberto e Backlog
**Versão:** 1.0  
**Data:** 28/04/2026

---

## 1. Funcionalidades removidas do MVP

### 1.1 Transmitir
**Descrição original:** Transação mediada em device de terceiro. Usuário logado
cede o device para que A envie para B. Usuário logado ≠ origem ou destino.
**Motivo da remoção:** Fluxo muito similar ao Receber. Complexidade de segurança
alta. Caso de uso de nicho sem frequência justificável no MVP.
**Para retomar:** Definir diferenciação clara do Receber, casos de uso reais
e revisar implicações de segurança do encerramento limpo de sessão.

### 1.2 Consumir (parceiros)
**Descrição original:** Descoberta e consumo em parceiros via grid, lista e
categorias com busca, filtros e destaque contextual.
**Motivo da remoção:** Requer infraestrutura de cadastro de parceiros,
categorização, geolocalização e integração com Asaas no lado do parceiro.
**Para retomar:** Definir modelo de cadastro de parceiros, fluxo de consumo
e integração financeira.
**Assets disponíveis:** Telas de grid, lista, categorias e saldo insuficiente
já ilustradas no PRD — referência visual preservada.

### 1.3 BI / Analytics
**Descrição original:** Módulo de dados e métricas para o usuário.
**Motivo da remoção:** Escopo indefinido. Depende do que for prioritário medir
e da capacidade real de captura da engenharia.
**Para retomar:** Definir quais métricas são prioritárias, quem é o usuário
do BI (membro comum, dono de Lounge, admin) e profundidade dos dados.

---

## 2. Módulos com escopo reduzido no MVP

### 2.1 Achar
**MVP:** busca simples de usuários por @handle.
**Futuro:**
- Busca de Alber Lounge
- Busca de parceiros (Consumir)
- Ações diretas do resultado (convidar para Split, enviar Albers, adicionar ao Lounge)
- Filtros e categorias

### 2.2 Alber Lounge — profundidade
**MVP:** entrada, membros, gestores, mensagens, eventos básicos.
**Futuro:**
- Feed de conteúdo do Lounge
- Enquetes e interações
- Métricas para donos (engajamento, membros ativos)
- Integração com Consumir (parceiros do Lounge)
- Múltiplos níveis de membership

---

## 3. Painel administrativo

Escopo completo detalhado em 08_admin_panel.md. Itens mapeados:

### 3.1 Taxas
- Taxa de retenção no cash out (descarregar)
- Taxa sobre recebimentos (receber)
- Taxa sobre ingressos de eventos
- Histórico de alterações com timestamp
- Receita → conta pai Alber

### 3.2 Alber Lounge
- Criação de Lounges via painel
- Convite e habilitação de donos
- Gestão de contas PJ e contas especiais
- Desativação de Lounges

### 3.3 Usuários
- Visualização de cadastros
- Status de KYC e período de avaliação
- Bloqueio de contas

### 3.4 Financeiro
- Receita consolidada (fees)
- Movimentações da conta pai
- Relatórios de transações

---

## 4. Decisões técnicas pendentes

### 4.1 Validação de CPF no webhook Pix — BLOQUEANTE
**Pendência:** confirmar com Asaas se `pixTransaction.payer.cpfCnpj`
é retornado no webhook de confirmação.
**Impacto:** bloqueante para validação de titularidade no Carregar.
**Alternativa se não disponível:** exigir chave Pix tipo CPF obrigatória
para carregamento.

### 4.2 Cotação Albers vs R$
**MVP:** paridade 1:1.
**Futuro:** cotação configurável via painel admin.
Definir se por Lounge, global ou por tipo de operação.

### 4.3 Limites de transferências Asaas
**Pendência:** confirmar limites de transferências internas
subconta→subconta por dia/mês.
**Impacto:** pode afetar volume de Split e Receber em escala.

### 4.4 Taxa Asaas sobre transferências internas
**Pendência:** confirmar se há custo em transferências subconta→subconta.
**Impacto:** cálculo de margem nas taxas do produto.

### 4.5 Prazo aprovação KYC produção
**Pendência:** confirmar prazo médio com Asaas.
**Impacto:** UX do período de avaliação e expectativa do usuário.

### 4.6 Habilitação White Label produção
**Pendência:** confirmar prazo de habilitação com gerente de contas Asaas.
**Impacto:** cronograma de go-live.

### 4.7 Renda do usuário no onboarding
**Status atual:** `incomeValue` fixo em R$ 1.000 no backend (campo obrigatório pelo Asaas).
**Melhoria futura:** coletar renda/faturamento do usuário durante o onboarding
(etapa entre endereço e handle) e enviar valor real ao Asaas.
**Impacto:** melhor qualificação de crédito e compliance KYC no Asaas.

---

## 5. Funcionalidades futuras identificadas

| Feature | Contexto | Prioridade |
|---|---|---|
| Edição de dados cadastrais | Perfil somente leitura no MVP | Média |
| Biometria no login | Citada como futura no spec | Baixa |
| Gestão de múltiplos devices | Notificação impl., gestão não | Média |
| Export de Atividade (PDF/CSV) | Extrato exportável | Baixa |
| Split — rateio por consumo | PRD original tinha esse escopo | Alta |
| Notificações in-app | MVP só push | Média |
| Dark/light mode manual | MVP segue sistema do device | Baixa |
| Suporte in-app | Chat de suporte integrado | Média |
| Histórico de @handles | Quarentena impl., histórico não | Baixa |
| Transmitir (mediado) | Removido do MVP — ver seção 1.1 | Alta futura |
| Transferir (direto) | Implementado no MVP — ver 06_modules/transferir.md | ✅ |
| Consumir (parceiros) | Removido do MVP — ver seção 1.2 | Alta futura |
| BI / Analytics | Removido do MVP — ver seção 1.3 | Média futura |

---

## 6. Decisões tomadas em reunião de validação (v1.3)

| Decisão | Resolução |
|---|---|
| Nomenclatura Alber Spaces | → Renomeado para **Alber Lounge** |
| Criação de Lounge | → Qualquer usuário, limite 1 por usuário, sem aprovação |
| Split variável — foto | → Câmera obrigatória (não galeria), opcional ao fechar |
| Split variável — prestar conta | → Lançamentos em tempo real com débito imediato |
| Split variável — novo participante | → Recálculo igualitário do saldo restante |
| Redes sociais no onboarding | → Opcional, badge "Perfil verificado" como incentivo |
| Multi-idiomas | → i18n preparado no MVP, Espanhol na próxima versão |
| Exportação lista de confirmados | → Backlog pós-MVP |
