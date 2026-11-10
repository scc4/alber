# Alber — Plano: Alber Food em projeto Supabase próprio
**Versão:** 1.0 (rascunho para decisão)
**Data:** 09/11/2026
**Status:** Plano. Nada foi implementado. Depende das decisões D1 a D5 (§3).
**Depende de:** `09_responsabilidades_sistemas.md` (fronteiras e segredos), `06_modules/food_company_service.md` (contrato Food → Alber).

---

## 1. Por que separar

Hoje Alber, Alber Food e Alber Admin são três produtos no **mesmo projeto Supabase** (um banco, um conjunto de segredos). A auditoria de 09/11/2026 (`09_...md` §13.3) e a revisão do Food apontaram o risco que isto cria para um produto ligado a um BaaS financeiro:

- **Segredos compartilhados em tempo de execução.** Segredos de Edge Function valem para o projeto inteiro. Qualquer código que rode na `food-api` (uma dependência comprometida, uma falha de execução de código) enxerga `ASAAS_API_KEY` (chave mestre da conta pai), `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (superusuário do banco inteiro), `ALBER_KEYS_ENCRYPTION_KEY`, `FOOD_OP_SIGNING_KEY` e a chave de serviço do Alber. A regra "o Food não tem chaves do Asaas" vale para o **código**, não para o **ambiente**.
- **Banco compartilhado.** O papel `takeaway_app` (menor privilégio) protege o acesso normal, mas o ambiente da função também tem a URL de superusuário.
- **Acoplamento do Admin por SQL.** O Admin lê o Food por views e escreve por funções SQL dentro do mesmo banco (§2.2).

**Objetivo:** depois da separação, comprometer o backend do Food dá acesso **só aos dados e segredos do Food** e à capacidade de pedir operações ao Alber, que continua aplicando os controles dele (destino único do saque, limites, carência de 48 h, vínculo do responsável com o quadro societário, revisão da equipe). Comprometer o Alber deixa de entregar o Food, e vice-versa.

**Por que agora:** não há restaurantes reais (2 empresas, 2 contas, 2 restaurantes e 4 pedidos, todos de teste) e `public.users` está vazio. Migrar com dados reais, depois, custa muito mais.

---

## 2. Estado atual (verificado no código em 09/11/2026)

### 2.1 O que o Food usa do projeto compartilhado

| Item | Como é hoje | Impacto da separação |
|---|---|---|
| Banco | schema `takeaway` no mesmo Postgres; papel `takeaway_app` (RLS, sem `UPDATE/DELETE` em `audit_logs` e `ledger_entries`) via pooler (`FOOD_DATABASE_URL`) | Banco próprio; o papel e as migrations se repetem lá |
| Função | `food-api` (Deno), `verify_jwt` desligado, protegida por `FOOD_BFF_SECRET` | Publicar no projeto novo |
| Site | Railway (`food.usealber.com.br`), só conhece `FOOD_API_URL` e `FOOD_BFF_SECRET` | Trocar `FOOD_API_URL` e o segredo |
| Storage | bucket público `menu-images` (escrita com `service_role` na `SupabaseImageStore`); caminhos relativos no banco | Recriar o bucket, copiar os arquivos; ajustar a CSP `img-src` (o host vem de variável) |
| Alber | HTTP: `ALBER_FUNCTIONS_URL` (hoje o **padrão é a URL do próprio projeto**), `ALBER_ANON_KEY` (padrão: a anon do próprio projeto), `ALBER_SERVICE_KEY` | Passam a ser **explícitos**, apontando para o projeto do Alber |
| Pagamento | Alber → Food: webhook assinado para o site (`FOOD_WEBHOOK_URL`), HMAC `ALBER_WEBHOOK_SECRET` | Sem mudança (já é HTTP, entre projetos) |
| Extensões, cron, realtime | Nenhum no Food (sem `pg_cron`, sem publicação realtime) | Nada a recriar |
| Migrations | `scripts/migrate-remote.mjs --workdir ../alber` (usa o projeto vinculado do Alber), histórico em `takeaway.schema_migrations` | Apontar para o projeto do Food |
| Deploy | Workflow manual "Deploy backend (Supabase)" com `SUPABASE_ACCESS_TOKEN` | Novo `project-ref` (e, se possível, outro token) |

O Alber **não lê** `takeaway` e o Food **não lê** `public` (regras já verificadas). Essa é a base que torna a separação viável.

### 2.2 O acoplamento difícil: o Alber Admin

O Admin vive no banco compartilhado (`admin`, papel `admin_app`) e acessa o Food **por SQL**:

- **30 views** do Admin leem `takeaway.*` (restaurantes, membros, pedidos, pagamentos, livro-razão, estornos, saques, Spaces, pedidos de recebimento, trocas de titular, taxas…), e algumas **juntam `takeaway` com `public`** (migrations `0005_finance_views`, `0010_platform_views`, `0017_food_origin_companies`).
- **14 funções `takeaway.admin_*`** são chamadas por SQL (taxas, destravar login, revogar sessão/convite, suspender restaurante, decisões de recebimento, troca de titular, Spaces).
- **11 módulos do Admin** tocam dados do Food: `b1-food`, `b2-alber`, `b3-finance`, `c2-fees`, `c3-unlock`, `c4-contain`, `d1-overview`, `e1-platform`, `e4-receiving-requests`, `e5-food-spaces`, `f1-search`.
- A regra do Admin é gravar a **auditoria na mesma transação da ação**. Com dois bancos isso deixa de ser possível (§4, fase 4).

---

## 3. Decisões necessárias

| # | Decisão | Opções | Recomendação |
|---|---|---|---|
| **D1** | O que fazer com os dados de teste do Food | **A)** começar do zero (zerar também as 2 empresas de teste do Alber); **B)** migrar preservando ids | **A**, a menos que você queira manter os dados de teste. Ver a restrição abaixo |
| **D2** | Como o Admin acessa o Food | **A)** segunda conexão de banco do Admin ao banco do Food, com papel somente-leitura nas views e `EXECUTE` nas funções `admin_*`; **B)** o Food expõe uma API HTTP de administração (como o Alber expõe `food-company-*`) | **A** no curto prazo (reaproveita as 30 views e as 14 funções sem reescrever); **B** só se quiser eliminar de vez a credencial de banco do Admin no Food |
| **D3** | Região e plano do projeto novo | mesma região do Alber (`sa-east-1`) | Mesma região; plano de produção (cópia/recuperação pontual). O custo de um segundo projeto entra na conta |
| **D4** | O Admin também sai do projeto do Alber | agora / depois | **Depois.** O Admin segue no projeto do Alber nesta fase; separá-lo é o mesmo exercício e fica fora deste plano |
| **D5** | Janela de corte | fora do horário, sem usuários | Como não há usuários, uma janela curta de indisponibilidade é aceitável |

### Restrição que decide a D1: os segredos do Supabase são só de escrita

O Supabase não devolve o valor de um segredo depois de gravado. Para **preservar** os dados do Food, você precisa ter guardados, fora do Supabase, os valores de `APP_ENCRYPTION_KEY` (cifra de CNPJ/CPF e das credenciais das integrações), `APP_PIN_PEPPER` e `APP_PASSWORD_PEPPER`.

- Se **você tem** os valores: a opção B é possível (copiar os segredos e restaurar os dados).
- Se **não tem**: os CNPJs, CPFs e credenciais já gravados ficam ilegíveis, e os PINs deixam de conferir (o dono recuperaria o PIN pelo fluxo de e-mail + pergunta). Nesse caso, a opção A.
- `FOOD_OP_SIGNING_KEY`, `ALBER_SERVICE_KEY` (= `ALBER_FOOD_SERVICE_KEY` no Alber) e `ALBER_WEBHOOK_SECRET` (= `FOOD_WEBHOOK_SECRET`) podem simplesmente ser **trocados**: gere um valor novo e grave o mesmo valor nos dois projetos.

---

## 4. Arquitetura alvo

```
 Projeto Supabase "alber" (public, admin)              Projeto Supabase "alber-food" (takeaway)
 ┌──────────────────────────────────────┐              ┌───────────────────────────────────────┐
 │ Edge Functions do Alber              │  HTTP        │ Edge Function food-api                │
 │  food-company-*, takeaway-*          │◀────────────│  (x-alber-food-key + op assinada)     │
 │  webhooks-asaas-*                    │              │ Postgres: schema takeaway             │
 │ admin-api  ───────────────┐          │──webhook────▶│ Storage: menu-images                  │
 │ Postgres: public, admin   │          │ (via site)   │ Segredos: SÓ os do Food               │
 │ Segredos: Asaas, Alber…   │          │              └───────────────▲───────────────────────┘
 └───────────────────────────┼──────────┘                              │
                             │ conexão 2 (somente leitura nas views +  │
                             └──── EXECUTE nas funções admin_*) ───────┘
 Site do Food (Railway) ──▶ food-api do projeto novo (FOOD_API_URL, FOOD_BFF_SECRET)
```

Fronteiras que **não mudam** (spec 09): dinheiro só no Alber; identidade só no Food; o Admin não move dinheiro; canais C1 a C9 continuam os mesmos.

---

## 5. Inventário de segredos

Marque a origem do valor antes do corte. Nenhum valor deve passar por chat; use a CLI e o seu gerenciador de senhas.

| Segredo | Fica no projeto Food | Fica no projeto Alber | Como obter o valor novo |
|---|---|---|---|
| `FOOD_BFF_SECRET` | ✅ | ❌ (remover) | Mesmo valor do Railway (ou trocar nos dois) |
| `APP_ENCRYPTION_KEY`, `APP_ENCRYPTION_KEY_V` | ✅ | ❌ (remover) | **Só a opção B** (valor guardado por você); na A, gerar novo |
| `APP_PIN_PEPPER`, `APP_PASSWORD_PEPPER` | ✅ | ❌ (remover) | Idem |
| `FOOD_OP_SIGNING_KEY` | ✅ | ✅ | Gerar novo; gravar o **mesmo** valor nos dois |
| `ALBER_SERVICE_KEY` (Food) = `ALBER_FOOD_SERVICE_KEY` (Alber) | ✅ | ✅ | Gerar novo; mesmo valor nos dois |
| `ALBER_WEBHOOK_SECRET` (Food) = `FOOD_WEBHOOK_SECRET` (Alber) | ✅ | ✅ | Gerar novo; mesmo valor nos dois |
| `ALBER_FUNCTIONS_URL`, `ALBER_ANON_KEY` | ✅ (**explícitos**) | — | URL e anon key do projeto do Alber |
| `FOOD_DATABASE_URL`, `FOOD_DB_ROLE` | ✅ | ❌ (remover) | Novo pooler do projeto do Food |
| `RESEND_API_KEY`, `EMAIL_FROM` | ✅ | ✅ (o Admin, que fica nesse projeto, também envia e-mail) | Preferir chave própria para o Food |
| `WEB_PUSH_*`, `IFOOD_*`, `CARDAPIOWEB_PARTNER_KEY`, `CNPJ_LOOKUP`, `OWNER_LINK_LOOKUP` | ✅ | ❌ (remover) | Mesmos valores |
| `ASAAS_API_KEY`, `ALBER_KEYS_ENCRYPTION_KEY`, `ALBER_CREDENTIAL_PEPPER`, demais do Alber/Admin | ❌ | ✅ | **Nunca** no projeto do Food |

O projeto do Food passa a ter só o que o Food precisa (mais o `SUPABASE_SERVICE_ROLE_KEY` e a URL de banco **do próprio projeto**, que agora só enxergam dados do Food).

---

## 6. Fases

Cada fase tem passos, como verificar e como voltar. As fases 1 a 3 não afetam o que está no ar.

### Fase 0 — Preparação (sem risco)
1. Decidir D1 a D5. Se D1 = B, confirmar que você tem os segredos (§3).
2. Criar o projeto `alber-food` (mesma região, plano de produção), ativar a cópia/recuperação pontual e a verificação em dois fatores na conta.
3. Registrar o `project-ref`, a URL, a anon key, o pooler e a senha do banco **fora do repositório**.
- **Verificar:** projeto criado, vazio, acessível pela CLI.

### Fase 1 — Banco do Food
1. Aplicar as migrations do Food (`db/migrations`, 0001 a 0039+) no projeto novo, com o runner apontado para ele (D1 = A) **ou** restaurar o dump de `takeaway` (D1 = B, preservando ids).
2. Criar o papel `takeaway_app` e o pooler; conferir RLS e `REVOKE` nas tabelas imutáveis (`audit_logs`, `ledger_entries`).
3. Criar o papel somente-leitura do Admin para o Food (D2 = A): `SELECT` só nas views `admin_v` do Food e `EXECUTE` só nas funções `admin_*`.
- **Verificar:** `npm test` do Food contra o banco novo; consulta de privilégios (nenhum acesso de `anon`/`authenticated` ao schema `takeaway`); contagens iguais ao banco de origem (D1 = B).
- **Voltar:** apagar o projeto novo; nada no ar mudou.

### Fase 2 — Função, Storage e segredos do Food
1. Gravar os segredos do Food (§5) no projeto novo, com `ALBER_FUNCTIONS_URL` e `ALBER_ANON_KEY` **explícitos**.
2. Publicar a `food-api` (sem `--verify-jwt`, como hoje) com a região correta (`x-region` já é tratado pelo cliente do site).
3. Criar o bucket `menu-images` e copiar os arquivos (volume pequeno); a CSP `img-src` passa a usar o host novo (variável existente).
4. Ajustar o workflow "Deploy backend (Supabase)" e o `migrate-remote` para o novo `project-ref`.
- **Verificar:** `GET /api/health` do site de teste contra a função nova; chamada direta sem segredo devolve 401.
- **Voltar:** apagar a função nova; o site continua apontando para a antiga.

### Fase 3 — Alber (só configuração)
1. Gravar no projeto do Alber os valores **novos** de `ALBER_FOOD_SERVICE_KEY`, `FOOD_OP_SIGNING_KEY` e `FOOD_WEBHOOK_SECRET`/`FOOD_WEBHOOK_URL` (mesmos valores do Food).
2. Nenhuma função do Alber muda de código: `food-company-*` e `takeaway-*` já falam HTTP com chave de serviço.
- **Verificar:** conferência cruzada Food ↔ Alber (assinatura, vetores de `contract-vectors.test`), chamada de `food-company-handle-check` e `food-company-status` do projeto novo.

### Fase 4 — Alber Admin com duas conexões (a fase pesada)
1. Acrescentar a conexão ao banco do Food (D2 = A): variável nova, pool próprio, papel somente-leitura (fase 1).
2. Mover as **30 views do Admin sobre o Food** para o banco do Food (schema `admin_v` lá) e as migrations delas para o repositório do Food ou para uma pasta do Admin aplicada nesse banco. Reescrever as **junções entre `takeaway` e `public`** (`0005`, `0010`, `0017`) como **duas consultas combinadas no código** do Admin (os volumes são pequenos).
3. Trocar nos 11 módulos a origem dos dados do Food para o pool novo.
4. **Auditoria sem transação única.** Hoje a auditoria entra "na mesma transação da ação". Com dois bancos: gravar a auditoria **antes** com situação `pendente` (já confirmada), chamar a função `takeaway.admin_*` (idempotente, com `expected`), e então gravar o desfecho (`aplicada` ou `falhou`). Garantia mantida: **nenhuma ação existe sem registro de auditoria**; o pior caso é um registro `pendente` sem ação, visível e conciliável. O padrão já existe nas taxas (`fee_changes`) e nas contenções (`containment_actions`).
5. Atualizar `product-contract.test.ts` para checar as funções do Food nas migrations do repositório do Food **e** seu `GRANT` ao novo papel.
- **Verificar:** suíte do Admin (hoje 463 testes) com os dois bancos em PGlite; ação de teste por módulo (taxa, destravar, suspender) conferindo auditoria e efeito.
- **Voltar:** a conexão nova é aditiva; sem ela o Admin continua lendo o banco antigo até o corte.

### Fase 5 — Corte (janela curta, sem usuários)
1. Congelar escrita no Food antigo (pausar pedidos / manter a função antiga só leitura).
2. Se D1 = B: dump final de `takeaway` → restaurar no projeto novo; copiar o bucket de novo.
3. Se D1 = A: confirmar que o banco novo está vazio e zerar as 2 empresas de teste do Alber.
4. No Railway: trocar `FOOD_API_URL` e `FOOD_BFF_SECRET` para o projeto novo; publicar.
5. No Admin: ligar a conexão nova como padrão para os dados do Food.
6. Fumaça: cadastro de restaurante, abertura de empresa (sandbox), saque de R$ 10, pedido pago, ação do Admin (taxa).
- **Voltar:** devolver `FOOD_API_URL` e o segredo antigos no Railway (a função antiga continua publicada e o banco antigo intacto durante o período de observação).

### Fase 6 — Limpeza (depois de alguns dias estável)
1. No projeto do Alber: apagar o schema `takeaway`, o papel `takeaway_app`, a função `food-api` e **todos os segredos exclusivos do Food** (§5, coluna "Alber ❌").
2. Revogar o token de deploy antigo do Food; cada projeto com o seu.
3. Atualizar `09_responsabilidades_sistemas.md` (§8 banco compartilhado, §9 segredos, §10 deploy), o `CLAUDE.md` dos três repositórios e a nota de memória.
- **Verificar:** `supabase secrets list` do Alber sem nomes do Food; consulta de catálogo sem `takeaway`; o teste de contrato do Admin passando.

---

## 7. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Segredo perdido (`APP_ENCRYPTION_KEY`) impede preservar os dados | Decidir D1 antes; na dúvida, opção A (os dados são de teste) |
| Auditoria do Admin sem transação única | Auditar antes (`pendente`), agir com função idempotente, registrar o desfecho (fase 4, item 4) |
| Junções `takeaway` × `public` das views do Admin | Duas consultas combinadas no código (volumes pequenos); testes de paridade com o resultado atual |
| Latência Food → Alber entre projetos | Mesma região; o Food já chama o Alber por HTTP hoje (a diferença é só o host) |
| URLs de imagem e CSP | Caminhos relativos no banco; host na variável da CSP; cópia do bucket antes do corte |
| Chaves trocadas fora de sincronia (assinatura, serviço, webhook) | Gravar os mesmos valores nos dois projetos no mesmo passo; conferência cruzada e vetores de contrato antes do corte |
| Custo e operação de dois projetos | Aceito: é o preço da contenção do risco; documentar dono e rotina de cada projeto |
| Admin continua no projeto do Alber | Fora do escopo (D4); o ganho principal (Food isolado do Asaas) já vem |

---

## 8. O que muda em cada repositório

- **Alber Food:** `.env.example` e `docs/deploy.md` (novo projeto, variáveis explícitas), workflow de deploy e `migrate-remote` com o novo `project-ref`, `rules.md`/`CLAUDE.md`, views `admin_v` do Food (fase 4) e o papel somente-leitura do Admin.
- **Alber:** apenas configuração (segredos) e, na limpeza, remoção do schema/segredos do Food; atualizar a spec 09.
- **Alber Admin:** conexão ao banco do Food, 11 módulos, migrations das views movidas, junções reescritas, auditoria em duas fases e o teste de contrato.

---

## 9. Critério de pronto

- O projeto do Alber não contém schema, função nem segredo do Food; o projeto do Food não contém segredo do Alber (nem `ASAAS_API_KEY`).
- Saque de teste, pedido pago e ação do Admin funcionando ponta a ponta.
- Conferência cruzada Food ↔ Alber e vetores de contrato passando.
- Spec 09 e os `CLAUDE.md` descrevendo a nova fronteira.

## 10. Ordem de grandeza

As fases 0 a 3 e 5 a 6 são operação e configuração, com pouco código. O esforço de código está concentrado na **fase 4** (Admin com duas conexões, 30 views, 11 módulos e a auditoria em duas fases). É a que decide o prazo.
