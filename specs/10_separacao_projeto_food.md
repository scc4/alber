# Alber — Plano: Alber Food em projeto Supabase próprio
**Versão:** 1.3 (11/11/2026: fases 1 e 2 publicadas e conferidas pela tela)
**Data:** 09/11/2026
**Status:** Fases 1 e 2 em produção (projeto atual): `food-admin` (Food, migration 0041) e Admin usando a API (`HttpFoodAdminClient`; segredos `FOOD_ADMIN_URL/KEY/SIGNING_KEY`). Teste real nas telas do Admin confirmado em 11/11/2026. Pendente da fase 2: aplicar `db/pending/drop_food_views.sql` no Admin (apaga as views `admin.v_food_*`) e separar o papel `admin_app` (hoje igual ao que a API assume, então o Admin ainda poderia ler `food_admin.*`). Fases 3 a 7 não iniciadas; D3 a D5 em aberto (§3).
**Depende de:** `09_responsabilidades_sistemas.md` (fronteiras e segredos), `06_modules/food_company_service.md` (contrato Food → Alber).

---

## 1. Por que separar

Hoje Alber, Alber Food e Alber Admin são três produtos no **mesmo projeto Supabase** (um banco, um conjunto de segredos). A auditoria de 09/11/2026 (`09_...md` §13.3) e a revisão do Food apontaram o risco que isto cria para um produto ligado a um BaaS financeiro:

- **Segredos compartilhados em tempo de execução.** Segredos de Edge Function valem para o projeto inteiro. Qualquer código que rode na `food-api` (uma dependência comprometida, uma falha de execução de código) enxerga `ASAAS_API_KEY` (chave mestre da conta pai), `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (superusuário do banco inteiro), `ALBER_KEYS_ENCRYPTION_KEY`, `FOOD_OP_SIGNING_KEY` e a chave de serviço do Alber. A regra "o Food não tem chaves do Asaas" vale para o **código**, não para o **ambiente**.
- **Banco compartilhado.** O papel `takeaway_app` (menor privilégio) protege o acesso normal, mas o ambiente da função também tem a URL de superusuário.
- **Acoplamento do Admin por SQL.** O Admin lê o Food por views e escreve por funções SQL dentro do mesmo banco (§2.2).

**Objetivo:** depois da separação, comprometer o backend do Food dá acesso **só aos dados e segredos do Food** e à capacidade de pedir operações ao Alber, que continua aplicando os controles dele (destino único do saque, limites, carência de 48 h, vínculo do responsável com o quadro societário, revisão da equipe). Comprometer o Alber deixa de entregar o Food, e vice-versa. E o **Admin deixa de ter credencial de banco no Food**.

**Por que agora:** não há restaurantes reais (2 empresas, 2 contas, 2 restaurantes e 4 pedidos, todos de teste) e `public.users` está vazio. Migrar com dados reais, depois, custa muito mais.

---

## 2. Estado atual (verificado no código em 09/11/2026)

### 2.1 O que o Food usa do projeto compartilhado

| Item | Como é hoje | Impacto da separação |
|---|---|---|
| Banco | schema `takeaway` no mesmo Postgres; papel `takeaway_app` (RLS, sem `UPDATE/DELETE` em `audit_logs` e `ledger_entries`) via pooler (`FOOD_DATABASE_URL`) | Banco próprio; o papel e as migrations se repetem lá |
| Função | `food-api` (Deno), `verify_jwt` desligado, protegida por `FOOD_BFF_SECRET` | Publicar no projeto novo |
| Site | Railway (`food.usealber.com.br`), só conhece `FOOD_API_URL` e `FOOD_BFF_SECRET` | Trocar `FOOD_API_URL` e o segredo |
| Storage | bucket público `menu-images` (escrita com `service_role` na `SupabaseImageStore`); caminhos relativos no banco | Recriar o bucket (vazio); ajustar a CSP `img-src` (o host vem de variável) |
| Alber | HTTP: `ALBER_FUNCTIONS_URL` (hoje o **padrão é a URL do próprio projeto**), `ALBER_ANON_KEY` (padrão: a anon do próprio projeto), `ALBER_SERVICE_KEY` | Passam a ser **explícitos**, apontando para o projeto do Alber |
| Pagamento | Alber → Food: webhook assinado para o site (`FOOD_WEBHOOK_URL`), HMAC `ALBER_WEBHOOK_SECRET` | Sem mudança (já é HTTP, entre projetos) |
| Extensões, cron, realtime | Nenhum no Food (sem `pg_cron`, sem publicação realtime) | Nada a recriar |
| Migrations | `scripts/migrate-remote.mjs --workdir ../alber` (usa o projeto vinculado do Alber), histórico em `takeaway.schema_migrations` | Apontar para o projeto do Food |
| Deploy | Workflow manual "Deploy backend (Supabase)" com `SUPABASE_ACCESS_TOKEN` | Novo `project-ref` (e, se possível, outro token) |

O Alber **não lê** `takeaway` e o Food **não lê** `public` (regras já verificadas). Essa é a base que torna a separação viável.

### 2.2 O acoplamento difícil: o Alber Admin

O Admin vive no banco compartilhado (`admin`, papel `admin_app`) e acessa o Food **por SQL**:

- **28 views** do Admin leem `takeaway.*` (inventário no Anexo A). **25 são só do Food**; **3 juntam também dados do Alber** (`v_fee_revenue`, `v_fin_fees`, `v_subaccounts`).
- **14 funções `takeaway.admin_*`** são chamadas por SQL (taxas, destravar login, revogar sessão/convite, suspender restaurante, decisões de recebimento, troca de titular, Spaces).
- **11 módulos do Admin** tocam dados do Food: `b1-food`, `b2-alber`, `b3-finance`, `c2-fees`, `c3-unlock`, `c4-contain`, `d1-overview`, `e1-platform`, `e4-receiving-requests`, `e5-food-spaces`, `f1-search`. As listas montam `WHERE` dinâmico sobre as views.
- A regra do Admin é gravar a **auditoria na mesma transação da ação**. Com dois bancos isso deixa de ser possível (fase 2).

---

## 3. Decisões

| # | Decisão | Estado |
|---|---|---|
| **D1** | O que fazer com os dados de teste do Food | **DECIDIDA (10/11/2026): começar do zero.** Ver §3.1 |
| **D2** | Como o Admin acessa o Food depois da separação | **DECIDIDA (10/11/2026): API HTTP administrativa no Food.** O Admin não terá credencial de banco no Food. Desenho no Anexo B |
| **D3** | Região e plano do projeto novo | Em aberto. Recomendação: mesma região do Alber (`sa-east-1`) e plano de produção (cópia/recuperação pontual). O custo de um segundo projeto entra na conta |
| **D4** | O Admin também sai do projeto do Alber | Em aberto. Recomendação: **depois**; o Admin segue no projeto do Alber nesta fase |
| **D5** | Janela de corte | Em aberto. Como não há usuários, uma janela curta de indisponibilidade é aceitável |

### 3.1 Restrição que decidiu a D1: os segredos do Supabase são só de escrita

O Supabase não devolve o valor de um segredo depois de gravado. Para **preservar** os dados do Food seria preciso ter guardados fora do Supabase os valores de `APP_ENCRYPTION_KEY` (cifra de CNPJ/CPF e das credenciais das integrações), `APP_PIN_PEPPER` e `APP_PASSWORD_PEPPER`. **Não estão guardados** (confirmado em 10/11/2026): os dados atuais ficariam ilegíveis e os PINs deixariam de conferir. Por isso a opção de começar do zero.

**Consequências da D1 = começar do zero**

- Nenhum dado do Food é migrado: o banco do projeto novo nasce **vazio** (só as migrations), sem dump nem restauração, e o bucket `menu-images` não precisa de cópia.
- As **2 empresas de teste do Alber** (origem `food`) e a operação de saque de teste (`food_ops`) ficam órfãs e devem ser **zeradas no corte** (as subcontas correspondentes ficam órfãs no Asaas; em sandbox, sem custo).
- Os 4 pedidos, os 2 restaurantes e as 2 contas de teste do Food são descartados; cadastro e abertura de empresa serão refeitos no projeto novo.
- **Todos os segredos do Food são gerados novos**, e **cada valor é guardado num gerenciador de senhas no momento em que é gerado**, antes de gravar no Supabase.
- `FOOD_OP_SIGNING_KEY`, `ALBER_SERVICE_KEY` (= `ALBER_FOOD_SERVICE_KEY`) e `ALBER_WEBHOOK_SECRET` (= `FOOD_WEBHOOK_SECRET`) também são trocados: valor novo, o **mesmo** nos dois projetos.

> **Alerta operacional (vale já, antes da separação):** os valores atuais desses segredos existem **só** dentro do Supabase. Se algum for sobrescrito por engano, os dados que ele protege ficam perdidos sem volta. Sempre que um segredo novo for criado, guarde o valor fora do Supabase na mesma hora.

---

## 4. Arquitetura alvo

```
 Projeto Supabase "alber" (public, admin)              Projeto Supabase "alber-food" (takeaway)
 ┌──────────────────────────────────────┐              ┌───────────────────────────────────────┐
 │ Edge Functions do Alber              │  HTTP        │ food-api    (site: x-food-bff-secret) │
 │  food-company-*, takeaway-*          │◀────────────│  chama o Alber: chave de serviço +    │
 │  webhooks-asaas-*                    │              │  operação assinada                    │
 │                                      │──webhook────▶│ food-admin  (Admin: chave + assinatura)│
 │ admin-api ───────────────────────────┼──── HTTP ───▶│  leituras tipadas + 14 ações          │
 │ Postgres: public, admin              │              │ Postgres: schema takeaway             │
 │ Segredos: Asaas, Alber, Admin        │              │ Storage: menu-images                  │
 └──────────────────────────────────────┘              │ Segredos: SÓ os do Food               │
                                                       └───────────────▲───────────────────────┘
 Site do Food (Railway) ──▶ food-api do projeto novo (FOOD_API_URL, FOOD_BFF_SECRET)
```

Fronteiras que **não mudam** (spec 09): dinheiro só no Alber; identidade só no Food; o Admin não move dinheiro. Muda o **canal do Admin com o Food**: deixa de ser SQL (funções e views) e passa a ser HTTP (novo canal C11, §Anexo B).

---

## 5. Inventário de segredos

Nenhum valor deve passar por chat; use a CLI e o seu gerenciador de senhas.

| Segredo | Projeto Food | Projeto Alber | Como obter o valor novo |
|---|---|---|---|
| `FOOD_BFF_SECRET` | ✅ | ❌ (remover) | Gerar novo; gravar no Railway |
| `APP_ENCRYPTION_KEY`, `APP_ENCRYPTION_KEY_V` | ✅ | ❌ (remover) | Gerar novo (D1 = A) |
| `APP_PIN_PEPPER`, `APP_PASSWORD_PEPPER` | ✅ | ❌ (remover) | Gerar novo |
| `FOOD_OP_SIGNING_KEY` | ✅ | ✅ | Gerar novo; mesmo valor nos dois |
| `ALBER_SERVICE_KEY` (Food) = `ALBER_FOOD_SERVICE_KEY` (Alber) | ✅ | ✅ | Gerar novo; mesmo valor nos dois |
| `ALBER_WEBHOOK_SECRET` (Food) = `FOOD_WEBHOOK_SECRET` (Alber) | ✅ | ✅ | Gerar novo; mesmo valor nos dois |
| `FOOD_ADMIN_KEY` e `FOOD_ADMIN_SIGNING_KEY` (novos, canal C11) | ✅ (confere) | ✅ (o Admin envia) | Gerar novos; mesmo valor nos dois |
| `ALBER_FUNCTIONS_URL`, `ALBER_ANON_KEY` | ✅ (**explícitos**) | — | URL e anon key do projeto do Alber |
| `FOOD_ADMIN_URL` (novo) | — | ✅ | URL da função `food-admin` |
| `FOOD_DATABASE_URL`, `FOOD_DB_ROLE` | ✅ | ❌ (remover) | Novo pooler do projeto do Food |
| `RESEND_API_KEY`, `EMAIL_FROM` | ✅ | ✅ (o Admin, que fica nesse projeto, também envia e-mail) | Preferir chave própria para o Food |
| `WEB_PUSH_*`, `IFOOD_*`, `CARDAPIOWEB_PARTNER_KEY`, `CNPJ_LOOKUP`, `OWNER_LINK_LOOKUP` | ✅ | ❌ (remover) | Mesmos valores |
| `ASAAS_API_KEY`, `ALBER_KEYS_ENCRYPTION_KEY`, `ALBER_CREDENTIAL_PEPPER`, demais do Alber/Admin | ❌ | ✅ | **Nunca** no projeto do Food |

---

## 6. Fases

**Ideia central da D2:** a API administrativa do Food é construída e adotada **antes** de o Food mudar de projeto. Assim o trabalho pesado (fases 1 e 2) acontece com tudo ainda no projeto atual, onde se testa paridade com o comportamento de hoje; a mudança de projeto (fases 3 a 7) fica quase só configuração.

### Fase 0 — Preparação (sem risco)
1. D3 a D5 decididas. Regra de guarda de segredos (§3.1) combinada.
2. Contrato da API administrativa revisado (Anexo B).
3. Criar o projeto `alber-food` (mesma região, plano de produção), ativar a cópia/recuperação pontual e a verificação em dois fatores; guardar `project-ref`, URL, anon key, pooler e senha **fora do repositório**.

### Fase 1 — API administrativa do Food (no projeto atual)
1. Nova função `food-admin` no repositório do Food, com a lógica das 28 views movida para consultas internas (acessadas como `takeaway_app`) e as 14 ações chamando as funções `takeaway.admin_*` já existentes (ou o equivalente em SQL do próprio Food).
2. Autenticação, assinatura, idempotência e auditoria própria do Food (Anexo B).
3. Testes do Food (vitest + PGlite) por endpoint, com paridade: a mesma massa de dados deve produzir o que as views produzem hoje.
- **Verificar:** suíte do Food; contrato publicado em `docs/food-admin-api.md`.
- **Voltar:** a função é nova e não é chamada por ninguém ainda; apagá-la.

### Fase 2 — Admin passa a usar a API (ainda no projeto atual)
1. Cliente HTTP tipado no Admin (`lib/food-admin-client.ts`), com os mesmos tipos de resposta do contrato.
2. Nos 11 módulos, trocar a origem dos dados do Food (views e funções SQL) pelo cliente. As 3 views mistas passam a ser **duas consultas combinadas no código do Admin**: a parte do Alber vem do banco do Admin, a do Food vem da API.
3. **Auditoria sem transação única.** Gravar a auditoria **antes**, com situação `pendente` (já confirmada), chamar a ação do Food (idempotente pelo `action_id`) e então gravar o desfecho (`aplicada` ou `falhou`). Garantia mantida: **nenhuma ação existe sem registro de auditoria**; o pior caso é um registro `pendente` sem ação, visível e conciliável. O padrão já existe nas taxas (`fee_changes`) e nas contenções (`containment_actions`).
4. Dado pessoal: o Admin passa a receber do Food **mascarado por padrão**; revelar um campo vira uma chamada própria, com permissão, 2FA recente e motivo (e o Food grava o motivo e o autor).
5. Depois de estável: **apagar as views do Admin sobre o Food** e o acesso do Admin ao schema `takeaway`; trocar `product-contract.test.ts` (funções SQL) por um **teste de contrato HTTP** (vetores de assinatura + esquemas das respostas, iguais nos dois repositórios).
- **Verificar:** suíte do Admin (hoje 463 testes); uma ação de teste por módulo (taxa, destravar, suspender) conferindo auditoria e efeito; comparação lado a lado das telas com os dados atuais.
- **Voltar:** reverter o Admin para as views (as views só são apagadas ao fim da fase).

### Fase 3 — Banco do Food no projeto novo
1. Aplicar as migrations do Food no projeto novo. **Banco vazio** (D1 = A).
2. Criar o papel `takeaway_app` e o pooler; conferir RLS e `REVOKE` nas tabelas imutáveis (`audit_logs`, `ledger_entries`).
- **Verificar:** `npm test` do Food contra o banco novo; nenhum acesso de `anon`/`authenticated` ao schema `takeaway`; schema idêntico ao do banco antigo.
- **Voltar:** apagar o projeto novo.

### Fase 4 — Funções, Storage e segredos no projeto novo
1. **Gerar** os segredos do Food (§5), **guardar cada valor no gerenciador de senhas** e só então gravá-los, com `ALBER_FUNCTIONS_URL` e `ALBER_ANON_KEY` **explícitos**.
2. Publicar `food-api` e `food-admin` (sem `--verify-jwt`, como hoje).
3. Criar o bucket `menu-images` (vazio) com as mesmas regras; a CSP `img-src` passa a usar o host novo (variável existente).
4. Ajustar o workflow "Deploy backend (Supabase)" e o `migrate-remote` para o novo `project-ref`.
- **Verificar:** saúde do site de teste contra a função nova; chamada direta sem segredo devolve 401 nas duas funções.

### Fase 5 — Alber (só configuração)
1. Gravar no projeto do Alber os valores **novos** de `ALBER_FOOD_SERVICE_KEY`, `FOOD_OP_SIGNING_KEY`, `FOOD_WEBHOOK_SECRET`/`FOOD_WEBHOOK_URL`, `FOOD_ADMIN_KEY`, `FOOD_ADMIN_SIGNING_KEY` e `FOOD_ADMIN_URL` (mesmos valores do Food).
2. Nenhuma função do Alber muda de código.
- **Verificar:** conferência cruzada Food ↔ Alber (assinatura, vetores de `contract-vectors.test`); `food-company-handle-check` e `food-company-status` com o projeto novo; teste de contrato do canal C11.

### Fase 6 — Corte (janela curta, sem usuários)
1. Pausar pedidos no Food antigo.
2. Confirmar que o banco novo está vazio; zerar no Alber as 2 empresas de teste de origem `food` e a operação de saque de teste (`food_ops`).
3. No Railway: trocar `FOOD_API_URL` e `FOOD_BFF_SECRET`; publicar. No Admin: trocar `FOOD_ADMIN_URL` (e as chaves).
4. Fumaça: cadastro de restaurante, abertura de empresa (sandbox), saque de R$ 10, pedido pago e uma ação do Admin (taxa).
- **Voltar:** devolver os valores antigos no Railway e no Admin (a função e o banco antigos seguem intactos durante o período de observação).

### Fase 7 — Limpeza (depois de alguns dias estável)
1. No projeto do Alber: apagar o schema `takeaway`, o papel `takeaway_app`, as funções `food-api` e `food-admin` e **todos os segredos exclusivos do Food** (§5, coluna "Alber ❌").
2. Revogar o token de deploy antigo do Food; cada projeto com o seu.
3. Atualizar `09_responsabilidades_sistemas.md` (canal C11, §8 banco, §9 segredos, §10 deploy), os `CLAUDE.md` dos três repositórios e a nota de memória.
- **Verificar:** `supabase secrets list` do Alber sem nomes do Food; catálogo sem `takeaway`; testes de contrato passando.

---

## 7. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Segredo perdido impede preservar dados | **Resolvido pela D1 = A.** Daqui em diante, todo segredo novo é guardado fora do Supabase ao ser gerado |
| Auditoria do Admin sem transação única | Auditar antes (`pendente`), agir com ação idempotente (`action_id`), registrar o desfecho |
| A API administrativa vira um canal poderoso | Lista **fechada** de ações (as 14 de hoje, sem nenhuma financeira), chave e assinatura próprias, validade curta e nonce, limites por ação, auditoria própria no Food; compromisso do Admin **não** move dinheiro (o Food não expõe nada disso) |
| Paridade de dados entre a API e as views | Testes lado a lado na fase 1 e comparação das telas na fase 2, antes de apagar as views |
| Filtros dinâmicos das listas do Admin | Filtros **tipados e fechados** por endpoint; sem `WHERE` livre, sem SQL no contrato |
| Latência e falhas de rede Admin → Food | Leituras repetíveis; ações idempotentes (repetir é seguro); tempo limite e mensagem clara; fila `pendente` conciliável |
| Mais dado pessoal viajando pela rede | Mascarado por padrão no Food; revelar é chamada própria, auditada nos dois lados |
| URLs de imagem e CSP | Caminhos relativos no banco; host na variável da CSP; bucket recriado antes do corte |
| Chaves trocadas fora de sincronia (assinatura, serviço, webhook, administrativa) | Mesmos valores nos dois projetos no mesmo passo; testes de contrato antes do corte |
| Custo e operação de dois projetos | Aceito: é o preço da contenção do risco; documentar dono e rotina de cada projeto |
| Admin continua no projeto do Alber | Fora do escopo (D4); o ganho principal (Food isolado do Asaas e do banco do Alber) já vem |

---

## 8. O que muda em cada repositório

- **Alber Food:** função `food-admin` (consultas, 14 ações, assinatura, idempotência, auditoria), tabela de operações administrativas, `docs/food-admin-api.md`, `.env.example` e `docs/deploy.md` (novo projeto, variáveis explícitas e as do canal C11), workflow de deploy e `migrate-remote` com o novo `project-ref`, `rules.md`/`CLAUDE.md`.
- **Alber:** só configuração (segredos) e, na limpeza, remoção do schema/segredos do Food; spec 09 (canal C11) e spec 10.
- **Alber Admin:** cliente HTTP do Food, 11 módulos, junções reescritas (duas consultas), auditoria em duas fases, remoção das views e funções SQL do Food, teste de contrato HTTP.

---

## 9. Critério de pronto

- O projeto do Alber não contém schema, função nem segredo do Food; o projeto do Food não contém segredo do Alber (nem `ASAAS_API_KEY`); **o Admin não tem credencial de banco no Food**.
- Saque de teste, pedido pago e ação do Admin funcionando ponta a ponta.
- Conferência cruzada Food ↔ Alber, vetores de contrato e teste de contrato do canal C11 passando.
- Spec 09 e os `CLAUDE.md` descrevendo a nova fronteira.

## 10. Ordem de grandeza

As fases 0, 3, 4, 5, 6 e 7 são operação e configuração, com pouco código. O esforço de código está nas **fases 1 e 2** (a API administrativa no Food e o Admin passando a usá-la): é o trabalho que decide o prazo, e é maior do que seria com uma segunda conexão de banco, em troca de o Admin não ter credencial de banco no Food. Vantagem de ordem: como as fases 1 e 2 rodam no projeto atual, o risco de paridade é tratado **antes** de qualquer mudança de projeto.

---

## Anexo A — Inventário do que a API substitui

**28 views do Admin sobre o Food** (25 só do Food, 3 mistas):

| Grupo | Views | Endpoints de leitura previstos |
|---|---|---|
| Restaurantes | `v_food_restaurants`, `v_food_members`, `v_food_invites`, `v_food_accounts`, `v_food_asaas_accounts`, `v_food_onboarding`, `v_food_consents`, `v_food_integrations` | `restaurants.list` (filtros: situação, KYC, origem, busca por nome/@/e-mail), `restaurants.get` e abas (`members`, `invites`, `asaas`, `onboarding`, `integrations`, `consents`), `accounts.get` |
| Financeiro | `v_fin_orders`, `v_fin_order_items`, `v_fin_payments`, `v_fin_refunds`, `v_fin_ledger`, `v_fin_ledger_balance`, `v_fin_payouts`, `v_fin_outbox`, `v_fin_webhook_events` | `orders.list/get`, `refunds.queue`, `ledger.list/balance`, `payouts.list`, `outbox.list`, `webhook_events.list` |
| Taxas e receita | `v_fin_fees`\*, `v_fee_revenue`\* | `fees.get` (parte do Food: taxa global e overrides), `revenue.summary` (parte do Food); o Admin soma a parte do Alber |
| Recebimento e titular | `v_food_receiving_requests`, `v_food_receiving_request_secrets`, `v_food_owner_transfers` | `receiving.list/get`, `receiving.reveal` (campos sensíveis, só com motivo), `owner_transfers.list` |
| Spaces | `v_food_spaces`, `v_food_space_owners`, `v_food_space_owner_documents`, `v_food_restaurant_spaces`, `v_food_restaurant_locations` | `spaces.list/get`, `space_owners.list`, `restaurant_space.get`, `restaurant_location.get` |
| Subcontas | `v_subaccounts`\* | `subaccounts.food` (parte do Food); o Admin junta com as empresas do Alber |
| Busca e visão geral | (consultas de `f1-search`, `d1-overview`, `e1-platform`) | `search`, `overview.counts` |

\* mistas: a parte do Alber continua vindo do banco do Admin (que lê o `public`).

**14 ações (escrita)** hoje chamadas por SQL: `admin_set_fees`, `admin_unlock_account`, `admin_revoke_sessions`, `admin_revoke_invite`, `admin_reset_onboarding_code`, `admin_set_restaurant_status`, `admin_review_owner_link`, `admin_decide_receiving_request`, `admin_set_owner_transfer`, `admin_save_space`, `admin_save_space_owner`, `admin_set_space_status`, `admin_set_restaurant_space`, `admin_set_restaurant_location`.

## Anexo B — Desenho da API administrativa do Food (canal C11)

**Função própria.** `food-admin`, separada da `food-api` (que serve o site público): chave e superfície diferentes, nenhuma rota compartilhada. `verify_jwt` desligado, como a `food-api`; a proteção é a chave e a assinatura.

**Autenticação (duas camadas).**
1. Cabeçalho `x-food-admin-key` = `FOOD_ADMIN_KEY` (≥ 32 caracteres, comparação em tempo constante; sem o segredo configurado a função recusa tudo, `503`).
2. **Escritas** exigem também `x-admin-signature: v1=<HMAC-SHA256 do JSON canônico>` com `FOOD_ADMIN_SIGNING_KEY` (chave **separada**, a mesma regra de bytes decodificados do `FOOD_OP_SIGNING_KEY`), cobrindo: `action`, parâmetros, `actor`, `action_id`, `nonce`, `issued_at`, `expires_at` (vida máxima de 120 s). Leituras usam só a chave.

**Quem agiu.** Toda chamada leva `actor = { staff_id, role }` (e, nas escritas, `reason` e `case_id`). O Admin continua sendo quem confere papel, 2FA recente, motivo e caso; o Food **não** reconfere papel, mas **registra** tudo no seu próprio livro append-only (`takeaway.admin_ops`), independente da auditoria do Admin.

**Idempotência e repetição.** `action_id` (o id do registro de auditoria do Admin) e `nonce` são únicos em `takeaway.admin_ops`: repetir a mesma ação devolve o desfecho original; reaproveitar o `action_id` com outro conteúdo é recusado; falha passageira antes de qualquer efeito desfaz a reserva e permite repetir. É o mesmo padrão de `food_ops` no Alber.

**Lista fechada.** Só as 14 ações do Anexo A existem, mais as leituras. **Nenhuma ação financeira** (sem saque, estorno, transferência ou ajuste de saldo): o Food não oferece ao Admin nada que o Admin hoje não possa fazer.

**Leituras.** `POST` com filtros **tipados** e fechados por endpoint, ordenação fixa, página com teto (ex.: 100). Nada de `WHERE` livre nem de SQL no contrato.

**Dado pessoal.** Respostas saem **mascaradas por padrão** (as regras de `lib/mask.ts` do Admin passam a valer no Food para o que sai dele). Revelar é uma chamada própria (`*.reveal`) para **um campo de um registro**, com `reason` obrigatório; o Food grava autor, motivo e campo (nunca o valor) em `takeaway.admin_ops`. Segredos (token de convite, hashes, chaves cifradas, CNPJ/CPF completos) **nunca** saem.

**Erros.** Mesma forma de hoje: `{ error, code, message }`, com `403` (chave/assinatura), `404`, `409` (estado mudou: o Admin já manda `expected`), `422`. O Admin traduz para os seus códigos (`ACTION_APPLY_FAILED`, `CONTAIN_STALE` etc.).

**Contrato.** Fonte única em `docs/food-admin-api.md` (Food), com esquemas de resposta e **vetores de assinatura** repetidos nos dois repositórios (como `contract-vectors.test`); o Admin tem um cliente tipado e um teste que quebra se o contrato mudar. Substitui o `product-contract.test.ts` para o Food.
