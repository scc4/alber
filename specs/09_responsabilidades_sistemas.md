# Alber — Responsabilidades dos três sistemas (Alber, Alber Food, Alber Admin)
**Versão:** 1.7 (09/11/2026: auditoria de segurança, §13.3; v1.6: corte executado e tudo publicado, §13.2; v1.5: P2b concluído, funções apagadas do projeto; v1.4: P2b no código; v1.3: P2a e P4 aplicados; v1.2: P1 aplicado no código, @ da empresa pela função de serviço e sem reserva no Alber; v1.1: canais, funções e nomes de segredos conferidos contra o código; §13.1 lista os desvios conhecidos)
**Data:** 05/11/2026
**Status:** Documento de referência. Vale para os três repositórios; cada um deve apontar para ele (ou copiá-lo) no seu `CLAUDE.md`.
**Depende de:** `00_architecture.md` §4.1, `06_modules/food_company_service.md`, e, nos outros repositórios, `alber-food/rules.md` e `alber-admin/rules.md`.

> **Para que serve.** Responder, antes de escrever código, três perguntas: **em qual sistema isto vive?**, **quem é o dono do dado?** e **como o outro sistema fica sabendo?** Se a resposta não estiver aqui, a decisão é do produto: registre-a aqui antes de implementar.

---

## 1. Os três sistemas em uma frase

| Sistema | Repositório / endereço | Em uma frase |
|---|---|---|
| **Alber** | `alber` (app Expo + Edge Functions `supabase/functions`) | O **cofre do dinheiro**: guarda as chaves do Asaas, abre subcontas, controla KYC, cobra, saca e aplica limites. Também é o app de carteira para pessoa física, **que não será usado nesta fase**. |
| **Alber Food** | `alber-food` · `food.usealber.com.br` | O **produto do restaurante**: identidade do dono e da equipe, cardápio, pedidos, portal, menu público e telas de saque. Não guarda dinheiro nem chave do Asaas. |
| **Alber Admin** | `alber-admin` · `admin.usealber.com.br` | O **painel interno da equipe**: enxerga os dois mundos, configura taxas, destrava e contém casos. **Destrava, não opera**: nunca move dinheiro. |

### 1.1 Fase atual (decisão de 04/11/2026)

- O foco é **Alber Food + Alber Admin**. O app Alber para pessoa física **não será usado de início** (primeiro cresce a base de restaurantes).
- O **Alber é usado apenas como backend de dinheiro, quando necessário**. No futuro os produtos serão unificados; por isso as fronteiras abaixo existem e não devem ser "otimizadas" hoje.
- O dono do restaurante **não tem usuário no Alber** e não se relaciona com nenhuma conta pessoa física Alber.

### 1.2 Mapa

```
 Cliente final ──QR──▶  ALBER FOOD (site Next.js + Edge Function food-api, schema takeaway)
 Dono / gerente ─────▶    identidade, portal, cardápio, pedidos, telas de saque
                              │
                              │ servidor → servidor
                              │ x-alber-food-key  (+ autorização assinada nas operações que movem dinheiro)
                              ▼
                        ALBER (Edge Functions food-company-*, takeaway-payment-*, schema public)
                          subcontas, KYC, cobrança, saque, limites, chaves Asaas
                              │ ▲
                  Asaas ◀────┘ └──── webhooks do Asaas (entram no Alber)
                                          │
                                          └─ eventos de pedido repassados ao Food (HMAC)

 Equipe Alber ─────▶  ALBER ADMIN (site Next.js + Edge Function admin-api, schema admin)
                          LÊ  views mascaradas (admin_v.* / admin.v_*) de public e takeaway
                          ESCREVE só chamando funções SECURITY DEFINER que cada domínio publica
```

---

## 2. Regras de ouro (valem para qualquer funcionalidade nova)

1. **Cada sistema é dono das suas escritas.** Ninguém escreve no schema de outro por SQL. O Food é dono de `takeaway`, o Alber de `public`, o Admin de `admin`.
2. **Dinheiro só se move no Alber.** Food e Admin pedem; quem executa Pix, cobrança, estorno e saque é o Alber.
3. **Chave do Asaas só existe no Alber.** Nunca no Food, no Admin, no app mobile, no navegador ou no Railway.
4. **Identidade do restaurante só existe no Food.** O Alber conhece o dono apenas por uma referência opaca (`owner_ref`); o Admin só lê, mascarado.
5. **O Admin nunca opera.** Não move dinheiro, não entra como usuário, não lê PIN, resposta de segurança, token nem chave do Asaas, não aprova KYC (quem decide é o Asaas).
6. **Sincronizar é pedir ao dono do dado**, não copiar a tabela. Cópia só existe como espelho de leitura, com a fonte da verdade declarada (§7).
7. **Operação que move dinheiro exige duas provas**: a chave de serviço (quem chama) **e** a autorização assinada da operação (o que foi autorizado, por quem, para qual valor e destino), de validade curta.
8. **Toda operação financeira é idempotente.** Repetir devolve o desfecho original; desfecho desconhecido nunca vira "falhou" nem paga duas vezes.
9. **Valores em centavos inteiros**, exceto onde o contrato diz o contrário (limites de saque do Alber, em reais, §8).
10. **Cada deploy é independente**; nenhuma mudança pode exigir que dois sistemas subam no mesmo segundo sem que isto esteja escrito em §10.

---

## 3. ALBER — o que é e o que não é

### 3.1 É responsável por

| Área | O que faz |
|---|---|
| **Subcontas Asaas** | Abre a subconta PJ da empresa, guarda a chave da subconta **cifrada** (`ALBER_KEYS_ENCRYPTION_KEY`), consulta saldo. |
| **KYC da empresa** | Envia/recebe o cadastro, recebe `webhooks-asaas-kyc`, mantém `kyc_status` e `account_status`. |
| **Vínculo do responsável** | Compara o CPF do responsável com o quadro societário (BrasilAPI) e mantém `owner_link_check`. |
| **Cobrança de pedidos do Food** | `takeaway-payment-create`, `-cancel`, `-refund`: cria a cobrança na **conta pai** com split para a carteira da empresa. |
| **Saque** | `food-company-withdraw`: guarda de saque (vínculo, carência de 48 h da chave aleatória, limites por saque e por dia), saldo, Pix no Asaas, lançamento em `transactions`. |
| **Chave Pix de saque** | Guarda a chave (uma vez só), verifica a titularidade da chave aleatória no Asaas (fail-closed), mantém a espera de 48 h. |
| **Limites de saque** | Padrão, aprovado pela equipe e pedidos de aumento (`company_limit_requests`). |
| **Webhooks do Asaas** | Recebe `webhooks-asaas-kyc`, `webhooks-asaas-pix` (transferências/saques das subcontas) e `webhooks-asaas-food` (cobranças dos pedidos, conta pai); valida token e repassa ao Food só o que é do Food. |
| **Verificação das autorizações assinadas** | `_shared/food-op.ts` e `_shared/food-release.ts`: assinatura, validade, amarração, nonce e idempotência (`food_ops`). |
| **Funções administrativas** | Publica as funções `SECURITY DEFINER` que o Admin chama (§8.3). |
| **App mobile (pessoa física)** | Carteira em Albers, Split, Lounge, etc. **Fora de uso nesta fase**; nada novo é desenvolvido nele por causa do Food. |

### 3.2 NÃO é responsável por (no contexto do Food)

- Login, PIN, pergunta de segurança, papéis e telas do dono ou da equipe do restaurante.
- Cardápio, pedidos, estados do pedido, QR code, menu público, impressão de comanda, avisos ao cliente.
- E-mails ao dono (código de verificação, avisos de saque). O Alber **não tem usuário** para avisar.
- Taxas do restaurante (a taxa Alber Food vive no Food; o Alber só executa o split que o Food mandar).
- Decidir quem é o dono. Ele confia em `owner_ref` + chave de serviço + autorização assinada.

### 3.3 Fronteiras de segurança

- Empresas abertas pelo Food têm `owner_id = NULL`, `owner_ref` preenchido e `origin = 'food'`. As funções do app (`financial-*`, `company-*` com JWT) **não conseguem operar** essas empresas.
- Saque, troca de chave Pix e troca de titular **não passam só com a chave de serviço**: exigem `op` assinado (§6.2).

---

## 4. ALBER FOOD — o que é e o que não é

### 4.1 É responsável por

| Área | O que faz |
|---|---|
| **Identidade do dono** | Conta em `takeaway.accounts`: e-mail, CPF (hash + cifrado), PIN (HMAC com pepper, teclado embaralhado), 4 perguntas de segurança, celular. Login "e-mail + PIN + pergunta". |
| **Equipe do restaurante** | Gerente e equipe entram com e-mail + senha. **Nunca têm autoridade financeira.** Convites, papéis e permissões (`manage_orders`, `refund`, ...). |
| **Verificações extras ("step-up")** | Código de 6 dígitos por e-mail (Resend) preso à operação (`op_digest`) antes de sacar, trocar chave Pix ou trocar titular. |
| **Restaurante** | Dados do negócio, status (`draft/active/suspended`), horário, aceitando pedidos, taxas por restaurante (override). |
| **Cardápio** | Manual e por plugins (Cardápio Web, Open Delivery, iFood), sincronização, disponibilidade. |
| **Pedidos** | Menu público `/m/{slug}`, sacola, preço recalculado no servidor, estados do pedido, fila do restaurante, aviso ao cliente, painel de senhas. |
| **Taxa Alber Food** | Cálculo e congelamento (`fee_breakdown`) na criação do pagamento; padrão global em `takeaway.platform_settings`. |
| **Livro-razão do restaurante** | `ledger_entries` (append-only): vendas, taxas, estornos. É a base do financeiro e do extrato mostrados ao dono. |
| **Telas e regras de saque** | Módulo Financeiro (`/app/financeiro/saque`, só o dono): saldo, extrato, cadastro da chave Pix, pedido de saque, histórico, limites. Registra `takeaway.payout_requests` **antes** de chamar o Alber. |
| **Atestado de liberação** | Assina `company_release` ("a equipe conferiu este responsável contra este CNPJ") para o Alber abrir a empresa já aprovada. |
| **Autorização assinada** | Assina `withdraw`, `set_pix_key` e `owner_transfer` depois de sessão + PIN + pergunta + código por e-mail. |
| **Integração com o sistema do restaurante** | Outbox, webhook assinado de pedidos, API `/api/v1/*`. |
| **Cliente HTTP do Alber** | Único ponto de contato com o Alber: `supabase/functions/_shared/lib/alber/` (`AlberClient`, com falso em memória para dev e teste). |

### 4.2 NÃO é responsável por

- Guardar chave do Asaas, abrir subconta no Asaas, falar direto com o Asaas para dinheiro (tudo via Alber).
- Aplicar a guarda de saque, limites ou a carência da chave: **quem decide é o Alber**. O Food pode pré-checar para a tela, mas a recusa final é a do Alber.
- Ler ou escrever em `public` por SQL, usar `service_role` (exceto o armazenamento de imagens), importar código do repositório `alber`.
- Aprovar KYC, bloquear empresa ou alterar taxas globais por conta própria: isso é decisão da equipe, via Admin.
- Mostrar-se como banco ou instituição de pagamento. O **selo Asaas** é obrigatório nas telas de criação de conta e de pagamento.

### 4.3 Regras que não mudam

- O site (Railway) é um BFF fino: **sem banco, sem chaves do Alber, sem e-mail, sem criptografia**. Tudo passa pela Edge Function `food-api`.
- `git push` no `main` publica **só o site**. A função `food-api` e as migrations (`takeaway`) são publicadas à parte, de propósito.

---

## 5. ALBER ADMIN — o que é e o que não é

### 5.1 É responsável por

| Área | O que faz |
|---|---|
| **Acesso da equipe** | Só `@usealber.com`, só por convite, 2FA obrigatório. Papéis: owner, admin, suporte, financeiro, auditor. Permissão conferida **no backend** a cada chamada. |
| **Leitura dos dois mundos** | Views mascaradas (`admin_v.*` / `admin.v_alber_*`): usuários, empresas, subcontas, pedidos, estornos pendentes, saques do Food, operações assinadas, eventos. Revelar dado pessoal exige permissão + 2FA recente + motivo, e fica na auditoria. |
| **Casos de suporte** | `support_cases` com linha do tempo imutável. |
| **Taxas** | Propor/aplicar (dupla confirmação, motivo, 2FA) chamando `takeaway.admin_set_fees` e `public.admin_set_rates`. |
| **Destravamentos de baixo risco** | Desbloquear login, revogar sessões, revogar convite, zerar tentativas de código. |
| **Contenção reversível** | Suspender/reativar restaurante; bloquear/desbloquear usuário do app e **empresa** (empresa bloqueada não saca). Exige caso aberto. |
| **Decisões da equipe** | Vínculo do responsável com a empresa, pedidos de aumento de limite, revisão do dono, **encerrar operação de saque presa** (`not_sent`/`sent`, após conferir no Asaas). |
| **Auditoria** | `admin.audit_log` imutável, gravada na **mesma transação** da ação. Nunca guarda segredo, CPF, CNPJ, código ou senha. |

### 5.2 NÃO é responsável por

- Movimentar dinheiro (transferir, sacar, cobrar, estornar, ajustar saldo).
- Criar sessão de usuário final ou "entrar como" alguém.
- Ler PIN, respostas de segurança, tokens ou chaves do Asaas.
- Aprovar KYC.
- Escrever em `public` ou `takeaway` por SQL.
- Ter regra de negócio dos produtos. Ele só chama a função que o produto publicou; a regra mora no produto.

---

## 6. Como os sistemas conversam (canais permitidos)

Qualquer comunicação **fora** desta tabela é proibida. Precisa de um canal novo? Registre-o aqui primeiro.

| # | De → Para | Canal | Autenticação | Para quê |
|---|---|---|---|---|
| C1 | Food → Alber | Edge Functions `food-company-*` (POST, JSON, servidor) | `x-alber-food-key` (`ALBER_FOOD_SERVICE_KEY`) + `apikey`/`Authorization` anon do projeto | Abrir empresa, status, saldo, chave Pix, saque, status do saque, limites, troca de titular, abandono, conferir o @ da empresa (`food-company-handle-check`). |
| C2 | Food → Alber | Edge Functions `takeaway-payment-create/cancel/refund`, `takeaway-company-statement` | `x-alber-food-key` | Cobrança, cancelamento, estorno e extrato dos pedidos. |
| C3 | Asaas → Alber | `webhooks-asaas-kyc`, `webhooks-asaas-pix`, `webhooks-asaas-food` | token do Asaas (tempo constante) | KYC, transferências, cobranças. |
| C4 | Alber → Food | `POST /api/internal/asaas-event` do site do Food | HMAC-SHA256 de `timestamp.corpo`, janela de 5 min | Repassar só eventos de cobrança com referência `food_<id>`. Idempotente no Food (`webhook_events`). |
| C5 | Admin → Alber | Funções SQL `public.admin_*` (`SECURITY DEFINER`) | papel `admin_app` | Taxas, destravar/bloquear, decidir limite e vínculo, encerrar operação presa. |
| C6 | Admin → Food | Funções SQL `takeaway.admin_*` (`SECURITY DEFINER`) | papel `admin_app` | Taxas, destravar conta, revogar sessão/convite, suspender restaurante, revisar vínculo do dono. |
| C7 | Admin ← Alber / Food | Views somente leitura (`admin_v.*`, `admin.v_alber_*`) | papel `admin_app` | Leitura mascarada. Gatilho `INSTEAD OF` recusa escrita. |
| C8 | Food → sistema do restaurante | Webhook assinado (HMAC-SHA256) / API `/api/v1/*` | assinatura / API key | Exportar pedidos, receber integrações. |
| C9 | Admin → Alber | Edge Function `admin-parent-balance` (POST, servidor) | `x-alber-admin-key` (`ALBER_ADMIN_KEY`) | **Só leitura** do saldo e extrato da conta pai (tela Plataforma). A chave do Asaas fica no Alber; cada consulta vai para o `audit_logs` do Alber com quem pediu. Único canal HTTP do Admin. |
| ~~C10~~ | ~~Food → Alber~~ | ~~`auth-check-handle`, `auth-reserve-handle`, `auth-check-email`~~ | | **REMOVIDO no P1 (07/11/2026).** A conferência do @ passou para C1 (`food-company-handle-check`); o Food não reserva mais @ no Alber. As funções `auth-reserve-handle` e `auth-check-email` saíram do código do Alber (saem do projeto no corte, depois que o Food novo estiver no ar). |

> Alber e Food **não** se enxergam por SQL. Admin enxerga os dois **por view** (leitura) e por funções `admin_*` (escrita), mais o canal C9 (leitura).

### 6.1 Referências opacas

| Referência | Quem gera | Quem entende | Uso |
|---|---|---|---|
| `owner_ref` | Food (`takeaway.accounts.id`) | Food; o Alber só compara igualdade | Identifica o dono nas chamadas ao Alber. |
| `company_id` | Alber (`public.companies.id`) | Alber; o Food guarda em `restaurants.alber_company_id` (**sem FK**) | Identifica a subconta/empresa. |
| `externalReference = food_<id do pagamento>` | Food/Alber | Food, Alber, Asaas | Liga cobrança do Asaas ao pagamento do Food. |
| `actor_ref` | Alber (= `owner_ref`) | Alber, Admin | Autor de um saque do Food em `transactions` (que não tem usuário). |
| `idempotency_key` | Food (ex.: `challenge_id` do saque) | Alber | Repetir devolve o desfecho original. |

### 6.2 Autorização assinada (operações que movem dinheiro ou mudam o controle)

Detalhe completo, formato e **vetor de teste**: `06_modules/food_company_service.md` §3.

| Operação | Quem assina | Amarra |
|---|---|---|
| `withdraw` | Food, depois de sessão + PIN + pergunta + código por e-mail | empresa, dono, **valor**, **digest da chave Pix que o Alber guarda** |
| `set_pix_key` | Food (mesmos controles) | empresa, dono, digest da chave confirmada |
| `owner_transfer` | Food | empresa, dono antigo, dono novo |
| `company_release` (atestado) | Food, após conferência da equipe | dono, hash do CNPJ, hash do CPF |

Regras fixas: HMAC-SHA256 com a chave **decodificada** (hex ≥ 64 caracteres ou base64, ≥ 32 bytes) de `FOOD_OP_SIGNING_KEY` (mesmo valor nos dois lados); vida máxima de 120 s; nonce de uso único; qualquer falha devolve o mesmo `403 INVALID_AUTHORIZATION` (o motivo só vai para a auditoria do Alber).

---

## 7. O que é sincronizado: dono do dado, cópia e como atualiza

**Leitura:** "Fonte" é onde o dado nasce e é corrigido. "Espelho" é o que os outros podem guardar (sempre derivado, nunca editado).

| Dado | Fonte da verdade | Quem pode guardar espelho | Como sincroniza |
|---|---|---|---|
| Identidade do dono (CPF, PIN, perguntas, e-mail) | **Food** | ninguém | Não sincroniza. O Alber recebe `owner_ref`; o CPF viaja só para conferir o vínculo e **não é guardado**. |
| Equipe, papéis e permissões do restaurante | **Food** | Admin (leitura) | Admin lê por view. |
| Restaurante, cardápio, pedidos, livro-razão do restaurante | **Food** | Admin (leitura) | Admin lê por view. |
| Subconta Asaas, chave da subconta | **Alber** | ninguém | Nunca sai do Alber. |
| `kyc_status`, `account_status`, `owner_link_check` da empresa | **Alber** | Food (espelho de exibição) | Food consulta `food-company-status` ao abrir a tela (e pode guardar o último valor). Nunca edita. A aprovação do KYC que ativa o restaurante `draft → active` é decidida pelo status vindo do Alber. |
| Chave Pix de saque | **Alber** (em claro) | Food: só máscara e `digest` | Food lê de `food-company-status`. Cadastro e troca só por `food-company-set-pix-key` / `owner-transfer`. |
| Limites de saque (padrão e aprovado) | **Alber** | Food (exibição) | `food-company-status.limits`. Pedido de aumento: Food → `food-company-limit-request`; decisão: Admin → `admin_decide_limit_request`. Limites em **reais**. |
| Saldo da subconta | **Asaas, via Alber** | Food (exibição, sem guardar como verdade) | `food-company-balance` a cada abertura da tela. |
| Saque (pedido do dono) | **Food** guarda o *pedido* (`payout_requests`); **Alber** guarda o *lançamento* (`transactions`) | Admin (leitura) | Food grava antes, chama o Alber com `idempotency_key`; o fim do Pix o Alber **não avisa**: o Food consulta `food-company-withdraw-status` (ao abrir a tela e a cada 20 s enquanto há saque a caminho) e então fecha o pedido e avisa o dono. |
| Cobrança do pedido | **Alber/Asaas** | Food (`payments`) | Food cria via C2; o Asaas confirma via C3 → C4; o Food lança no livro-razão ao confirmar. |
| Estorno | **Food** inicia (permissão `refund`) | Admin (fila de pendentes, leitura) | Executado pelo Alber (C2). Resultado desconhecido fica `pending` e **bloqueia novos estornos** até conferir no Asaas. |
| Taxa Alber Food (global) | **Food** (`takeaway.platform_settings`) | Admin (histórico `admin.fee_changes`) | Admin altera chamando `takeaway.admin_set_fees`; pedidos já criados **mantêm** a taxa congelada. |
| Taxas do app Alber (`public.rates`) | **Alber** | Admin (histórico) | `public.admin_set_rates`. |
| Taxa por restaurante (override) | **Food** | — | Não é editada pelo Admin hoje. Sobrepõe a global. |
| Status do restaurante (`active/suspended`) | **Food** | Admin (leitura) | Contenção: Admin → `takeaway.admin_set_restaurant_status`. |
| Status da empresa (`active/blocked`) | **Alber** | Food (leitura de `withdraw.allowed`) | Contenção: Admin → `public.admin_set_company_status`. Empresa bloqueada não saca. |
| Operação de saque presa (`food_ops`) | **Alber** | Admin (view `v_alber_food_ops`) | Equipe confere no Asaas e encerra com `public.admin_resolve_food_op`; o Food, ao reenviar com a mesma chave, recebe o desfecho. |
| Casos de suporte, equipe, auditoria do Admin | **Admin** | ninguém | Vínculo com restaurante/usuário/empresa guarda só tipo + id. |

### 7.1 Regras de sincronização

1. **Direção única por dado.** Se dois sistemas "precisam" editar o mesmo campo, está errado: o dono edita, o outro pede.
2. **Espelho nunca vira fonte.** Se o espelho divergir, vale o dono; reconsulte em vez de "consertar" a cópia.
3. **Sem tempo real obrigatório.** Hoje não há push do Alber para o Food além do evento de cobrança (C4). Tela que precisa do estado atual consulta ao abrir (com cache curto, ex.: 30 s) ou faz polling, como o saque.
4. **Evento recebido é idempotente.** Chave única por evento; valor conferido com o cobrado; divergência não confirma e vai para a auditoria.
5. **Falha de rede ≠ falha da operação.** Ao não saber o desfecho, marque "em verificação", reenvie com a **mesma** `idempotency_key` e nunca recomece com chave nova.
6. **Sem chave estrangeira entre schemas.** Referências são ids opacos; integridade é por contrato.

---

## 8. Banco de dados compartilhado

Um único projeto Supabase, três "donos":

| Schema | Dono | Quem escreve | Quem lê |
|---|---|---|---|
| `public` | Alber | Funções do Alber (e funções `admin_*` chamadas pelo Admin) | Alber; Admin por view |
| `takeaway` | Alber Food | `food-api` (papel `takeaway_app`, menor privilégio, sujeito a RLS) | Food; Admin por view |
| `admin` | Alber Admin | `admin-api` (papel `admin_app`) | Admin |

### 8.1 Migrations

- **Cada repositório tem o seu histórico**, com tabela própria (`takeaway.schema_migrations`, `admin.schema_migrations`, histórico do Supabase CLI para o Alber). Migration aplicada nunca é editada; crie outra.
- **Proposta de mudança em outro domínio** (ex.: o Admin precisa de uma função no Alber): o Admin guarda a proposta em `db/product-migrations/<produto>/`; ela **só vale depois de portada e aplicada no repositório do produto**. O Admin nunca aplica migration em `public` ou `takeaway`.
- Migrations devem ser **compatíveis com a versão anterior do código** (permite rollback de deploy).

### 8.2 Funções que o Admin chama (contrato)

Padrão obrigatório: `SECURITY DEFINER`, `search_path` fixo, checagem do chamador `admin_app`, `REVOKE` de PUBLIC e `GRANT EXECUTE` só ao `admin_app`, alvo existente, idempotente, retorno `{changed, previous, new}` resumido, estado esperado (`expected`) conferido sob lock.

| Produto | Funções |
|---|---|
| Alber (`public`) | `admin_set_rates`, `admin_unlock_login`, `admin_set_user_status`, `admin_set_company_status`, `admin_decide_limit_request`, `admin_review_company_link`, `admin_reset_company_limits`, `admin_resolve_food_op` |
| Alber Food (`takeaway`) | `admin_set_fees`, `admin_unlock_account`, `admin_revoke_sessions`, `admin_revoke_invite`, `admin_reset_onboarding_code`, `admin_set_restaurant_status`, `admin_review_owner_link`, `admin_decide_receiving_request`, `admin_set_owner_transfer`, `admin_save_space`, `admin_save_space_owner`, `admin_set_space_status`, `admin_set_restaurant_space`, `admin_set_restaurant_location` |

Notas sobre as funções do Food que não são óbvias:

- `admin_decide_receiving_request`: a equipe decide o pedido de conta de recebimento (`release` / `fix` / `reject`). É a conferência manual que dá origem ao atestado `company_release` (§6.2).
- `admin_set_owner_transfer`: a equipe só **congela, descongela ou cancela** uma troca de titular. **Nunca conclui nem aceita**; quem conclui é o novo dono, no Food, e a execução financeira é do Alber (`food-company-owner-transfer`).
- Funções de **Spaces** (`admin_save_space*`, `admin_set_space_status`, `admin_set_restaurant_space`, `admin_set_restaurant_location`): Spaces (praça de alimentação, shopping) são dado do domínio do Food, cadastrado pela equipe no Admin. O Admin lê por views e grava só por estas funções.

**Verificação automática:** o Admin tem um teste (`tests/product-contract.test.ts`) que confere que toda função `public.admin_*` / `takeaway.admin_*` chamada pelo código existe nas migrations reais do Alber e do Food. Ao incluir uma função nesta tabela, o teste a cobra.

---

## 9. Segredos: quem tem o quê

| Segredo | Alber | Food | Admin | Observação |
|---|---|---|---|---|
| Chaves do Asaas (conta pai e subcontas) | ✅ | ❌ | ❌ | Nunca fora do Alber. |
| `ASAAS_API_KEY` / `ALBER_KEYS_ENCRYPTION_KEY` (cifra das subcontas) | ✅ | ❌ | ❌ | Não trocar o valor sem a rotação (`_PREV`); linhas v2 ficam ilegíveis. |
| `ALBER_FOOD_SERVICE_KEY` (= `x-alber-food-key`) | ✅ (confere) | ✅ (envia) | ❌ | ≥ 32 caracteres. |
| `FOOD_OP_SIGNING_KEY` | ✅ (verifica) | ✅ (assina) | ❌ | Mesmo valor; usar os **bytes decodificados**. |
| `FOOD_ASAAS_WEBHOOK_TOKEN` | ✅ | ❌ | ❌ | Token da conta pai; separado do das subcontas. |
| Segredo do evento Alber → Food (HMAC `timestamp.corpo`) | ✅ | ✅ | ❌ | Janela de 5 min. |
| `FOOD_BFF_SECRET` (site ↔ `food-api`) | ❌ | ✅ | ❌ | Só site e função do Food. |
| `APP_PIN_PEPPER`, `APP_ENCRYPTION_KEY` | ❌ | ✅ | ❌ | A `APP_ENCRYPTION_KEY` precisa de backup: sem ela não se decifra o CNPJ. |
| `ALBER_CREDENTIAL_PEPPER` (≥ 32 caracteres) | ✅ | ❌ | ❌ | **Nunca trocar nem perder sem refazer os hashes**: é o pepper de PIN, resposta de segurança, CPF e senha de sessão do app Alber. Falha fechada se ausente. |
| `ALBER_ADMIN_KEY` (= `x-alber-admin-key`) | ✅ (confere) | ❌ | ✅ (envia) | Canal C9, ≥ 32 caracteres. |
| `ADMIN_BFF_SECRET`, `ADMIN_ENCRYPTION_KEY`, segredo Google | ❌ | ❌ | ✅ | Só site e função do Admin. |

### 9.1 Mesmo segredo, nomes diferentes (cuidado ao configurar)

O mesmo valor tem nome diferente em cada lado. Configurar o nome errado deixa a função em `503 SERVICE_NOT_CONFIGURED` ou recusa tudo com `401`.

| Valor | Nome no Alber | Nome no Alber Food | Nome no Alber Admin |
|---|---|---|---|
| Chave de serviço Food → Alber (`x-alber-food-key`) | `ALBER_FOOD_SERVICE_KEY` | `ALBER_SERVICE_KEY` | — |
| Chave de assinatura das autorizações | `FOOD_OP_SIGNING_KEY` | `FOOD_OP_SIGNING_KEY` | — |
| Segredo HMAC do evento de pagamento Alber → Food | `FOOD_WEBHOOK_SECRET` (e `FOOD_WEBHOOK_URL`) | `ALBER_WEBHOOK_SECRET` | — |
| Token do webhook da conta pai (Asaas → Alber) | `FOOD_ASAAS_WEBHOOK_TOKEN` | — | — |
| Chave do canal C9 (`x-alber-admin-key`) | `ALBER_ADMIN_KEY` | — | `ALBER_ADMIN_KEY` |
| URL das funções do Alber | — | `ALBER_FUNCTIONS_URL` (padrão: URL do projeto) | `ALBER_FUNCTIONS_URL` |

---

## 10. Deploy e ordem de publicação

Os três publicam separado. O que precisa de ordem:

1. **Alber**: migrations (058 → 059 → 060 …) e funções `food-company-*` **antes** de qualquer coisa que as use.
2. **Admin**: suas migrations que leem colunas novas do Alber (ex.: 0017 depende da 058; as ações de contenção dependem de `admin_set_company_status` e `admin_resolve_food_op`) **depois** do Alber. Sem a função, a ação do Admin responde `CONTAIN_APPLY_FAILED`.
3. **Food**: a migration destrutiva de identidade (0031) e o `main` do site só vão no **corte** (publica o site no Railway); o site novo depende das funções `food-company-*` já publicadas.
4. Mudança de **contrato** entre Food e Alber (campos, códigos de erro) sobe **junta**: documente em `food_company_service.md` e rode os vetores de contrato dos dois lados.
5. Push no `main` do Alber dispara só o build de prévia (EAS); não publica função nem migration. Função e migration sempre por deploy explícito.

---

## 11. Onde implemento isto? (guia de decisão)

| Eu preciso de... | Onde | Observação |
|---|---|---|
| Nova tela, campo ou fluxo do dono/gerente | **Food** | Se tocar em dinheiro, a regra final é do Alber. |
| Mudar cardápio, pedido, fila, menu público, QR | **Food** | |
| Mudar login, PIN, perguntas, papéis, e-mail ao dono | **Food** | O Alber não tem usuário para isto. |
| Novo limite, carência, guarda ou validação de saque | **Alber** | O Food só exibe e pré-checa. |
| Nova forma de movimentar dinheiro (outro tipo de Pix, transferência) | **Alber** + contrato novo com `op` assinado | Antes: decidir em §12. |
| Nova chamada do Food ao Asaas | **Alber** (função nova) | Food nunca fala direto com o Asaas. |
| Novo webhook do Asaas | **Alber** (recebe), repassa ao Food só o que couber | |
| Nova taxa configurável | **Dono do dado** guarda; **Admin** edita via função `admin_set_*` | Dupla confirmação, motivo, 2FA, histórico. |
| Nova ação da equipe (destravar, bloquear, encerrar) | **Admin** (tela + serviço) + **função no produto dono** | Nunca SQL de escrita direto. |
| Nova tela de leitura para a equipe | **Admin** + **view** mascarada no produto | Dado pessoal mascarado por padrão. |
| Notificar o dono por e-mail | **Food** | Admin usa o contato do dono do restaurante ligado. |
| Relatório consolidado de receita/plataforma | **Admin** (lê views) | |
| Algo que parece pedir "o Admin editar um dado do Food" | **Food** publica uma função `admin_*`; Admin só a chama | |
| Algo que parece pedir "o Food ler uma tabela do Alber" | **Alber** publica uma função `food-*`; Food só a chama | |

---

## 12. Checklist antes de desenvolver

- [ ] Identifiquei o **dono do dado** (§7) e o **canal** (§6). Se não existe canal, registrei um novo aqui.
- [ ] Nenhuma escrita em schema de outro sistema por SQL; nenhuma FK entre schemas.
- [ ] Dinheiro: só o Alber executa; há `idempotency_key`; o desfecho desconhecido não vira "falhou".
- [ ] Operação que muda dinheiro, chave Pix ou titular: exige `op` assinado e os controles do Food (sessão, PIN, pergunta, código).
- [ ] Nenhum segredo novo em lugar que não o tem (§9); nada de chave do Asaas fora do Alber.
- [ ] Ação do Admin: permissão no backend, 2FA recente, motivo, auditoria na mesma transação, função `SECURITY DEFINER` no produto.
- [ ] Dado pessoal mascarado na leitura e fora de log, auditoria e caso de suporte.
- [ ] Texto de UI via i18n; selo Asaas nas telas financeiras e de criação de conta; nunca "banco" ou "instituição de pagamento".
- [ ] Ordem de deploy (§10) escrita no PR quando há mais de um sistema.
- [ ] Spec do contrato atualizada (`food_company_service.md` ou `rules.md` do repositório) no mesmo PR.

---

## 13. Pontos em aberto e transição

1. **Ligação entre o modelo "de hoje" e o "do corte".** Parte de `alber-food/rules.md` §2.1/§2.1.1 (token do Alber do dono, `alber_user_id`) descreve o que está no ar **antes** do corte. Este documento descreve o **alvo** (§2.1.2). Em caso de dúvida durante a transição, vale o alvo para código novo.
2. **Taxa de saque do Food:** desligada (`FOOD_WITHDRAW_FEE_ENABLED = false` no Alber). Se ligar, é decisão do produto e muda o Alber (lançamento `fee` e repasse à conta pai).
3. **Aviso do fim do Pix de saque:** o Alber não avisa o Food; o Food consulta. Se um dia houver evento Alber → Food para saques, será um canal novo (§6) com HMAC e idempotência.
4. **Verificação da chave Pix aleatória (EVP) em produção** depende da resposta do Asaas (documento mascarado ou completo). Se vier mascarado, só a chave do CNPJ funciona (comportamento seguro por desenho).
5. **Vínculo CPF × KYC do Asaas PJ** não tem garantia técnica por nome; por isso existe a conferência pelo quadro societário e a revisão manual da equipe.
6. **Unificação futura Alber + Food:** hoje as fronteiras (identidade no Food, dinheiro no Alber) foram desenhadas para permitir a unificação sem refazer o dinheiro. Nenhuma funcionalidade nova deve criar acoplamento que a impeça (ex.: FK entre schemas, dono do restaurante como usuário PF do Alber).
7. **Painel Admin no spec do Alber** (`08_admin_panel.md`) está desatualizado (é o rascunho de 28/04/2026). A fonte de verdade do Admin é o `rules.md` do repositório `alber-admin`; este documento prevalece nas fronteiras.

---

### 13.2 Estado do corte (09/11/2026)

Verificado em produção por consulta só de leitura e por listagem de funções:

- **Alber:** migrations até a `061` aplicadas; funções `food-company-*` (inclusive `food-company-handle-check`) e `takeaway-*` publicadas; `auth-reserve-handle`, `auth-check-email` e as três funções de execução única apagadas do projeto.
- **Alber Food:** migrations até a `0039` aplicadas (inclui a `0031` de identidade do dono); `food-api` v74 e site publicados com o código do P1.
- **Alber Admin:** migrations até a `0023` aplicadas; `admin-api` v38 e site publicados.
- **Dados:** `public.users` = 0 (nenhuma conta pessoa física). Restam dados de teste já no modelo novo (2 empresas, 2 contas do Food, 2 restaurantes, 4 pedidos, 1 operação de saque); **não foram zerados** por serem posteriores ao corte de identidade e estarem ligados a subcontas do Asaas.
- **Segredos:** todos os que o código novo exige existem no projeto (`FOOD_OP_SIGNING_KEY`, `APP_PIN_PEPPER`, `ALBER_SERVICE_KEY`, `ALBER_FOOD_SERVICE_KEY`, `ALBER_WEBHOOK_SECRET`, `FOOD_WEBHOOK_SECRET`, `ALBER_ADMIN_KEY`, entre outros). Os valores não são legíveis; a igualdade entre `ALBER_SERVICE_KEY` (Food) e `ALBER_FOOD_SERVICE_KEY` (Alber) foi inferida dos pedidos já criados em produção.
- **Não verificado de ponta a ponta:** o cadastro novo de restaurante (abertura de empresa, KYC e saque reais no Asaas) não foi exercitado depois do corte; a fumaça cobriu saúde dos sites, início do cadastro e conferência de @.

### 13.3 Auditoria de segurança (09/11/2026)

Escopo: segredos, RLS e privilégios do banco, funções, cabeçalhos, SSRF, logs e dependências, nos três repositórios e no banco de produção. Análise por leitura de código e consultas só de leitura; poucas chamadas de prova.

| # | Achado | Estado |
|---|---|---|
| A1 | Colunas sensíveis (CPF, chave cifrada do Asaas, carteira, chave Pix, código SMS) legíveis por `anon`/`authenticated` via REST; o RLS é por linha e as políticas de pares entregavam a linha inteira | **Corrigido e aplicado** (migration 062: acesso por coluna; link de KYC por `get_my_onboarding_url()` / `get_my_company_onboarding_url()`) |
| A2 | PIN em SHA-256 puro em `app_metadata` (vai no JWT), senha do Supabase Auth = SHA-256 do PIN; resposta de segurança com SHA-256 puro **e texto em claro** (`answer_normalized`) | **Corrigido e publicado** (migration 063, `user_credentials` com HMAC + pepper, senha de sessão derivada no servidor, resposta só cifrada). A resposta cifrada continua decifrável pelo servidor: é inerente a mostrar as opções mascaradas no login |
| M1 | CPF com SHA-256 puro (`users.cpf`) | **Corrigido** (HMAC com pepper, `cpfHash`). **Não alterado:** CNPJ (dado público de registro) e o `cpf_hash`/`cnpj_hash` do Alber Food, que fazem parte do contrato assinado do atestado com o Alber (`food-release`); trocar exige mudar os dois lados juntos |
| M2 | `get_user_space_ids` / `get_user_split_ids` executáveis por `anon` com `uid` arbitrário | **Corrigido** (só respondem para o próprio usuário; `anon` sem acesso) |
| M3 | Recursão infinita nas políticas de `companies`/`company_operators` (`42P17`) | **Corrigido** (funções `SECURITY DEFINER` sem argumento). O harness mostrou que o banco reconstruído só das migrations também tinha recursão em splits/lounges: as políticas de produção (ajustadas à mão) entraram na migration 062 |
| M4 | Todas as funções do Alber usam `service_role` (o RLS não as protege) | **Aceito, arquitetural**: a autorização é do código de cada função |
| M5 | CPF cru no log do `auth-login`; `apiKey` da subconta gravável em `error_logs.asaas_response` | **Corrigido** |
| W | Escrita direta pela API para `anon`/`authenticated` em todas as tabelas | **Corrigido** (revogada, exceto `push_tokens`; privilégios padrão futuros também) |
| — | `hmacVerify` comparava com `===` | **Corrigido** (tempo constante) |
| — | Deriva de esquema: funções e políticas existentes só em produção | **Fechada** pela migration 062 (o resto do esquema não foi comparado) |
| — | `supabase-js@2` flutuante em 86 funções | **Fixado** em `@2.119.0` (a versão que já resolvia) |
| — | `.claude/settings.local.json` versionado | **Removido do git** |

**Aberto / sem alteração:** CORS `*` nas funções do Alber; CSP com `unsafe-inline` em script (Food e Admin, documentado); SSRF sem checagem de DNS rebinding nos conectores do Food (documentado e mitigado); 33 vulnerabilidades de ferramentas de build no app Expo (`npm audit`); código SMS (`sms_codes.code`) em texto puro e comparado sem tempo constante (curta duração); `alber-admin/owner-setup-link.txt` (arquivo local, fora do git: apagar após o uso); isolamento entre restaurantes do Alber Food e a lógica de saque/step-up **não foram revisados a fundo**.

**Verificado sem problema:** nenhum segredo real no código nem no histórico; `takeaway` e `admin` fora da API REST; nenhuma função de `takeaway`/`admin` executável por `anon`; todas as `SECURITY DEFINER` com `search_path` fixo; o `x-forwarded-for` forjado não é aceito (IP gravado é o real); cookies `httpOnly`/`secure`/`lax`, CSRF por `Origin`, HSTS e CSP nos sites; `npm audit` de produção limpo no Food e no Admin.

Teste de RLS: `node scripts/verify-rls.mjs` (Postgres em memória com as migrations reais + stubs do Supabase, 42 verificações; usa o PGlite do `alber-food`).

### 13.1 Desvios conhecidos (auditoria de 07/11/2026)

Código que ainda não está de acordo com este documento. Cada item tem dono e plano; não é desculpa para novo código seguir o mesmo caminho.

| # | Desvio | Regra violada | Plano |
|---|---|---|---|
| 1 | ~~O Food chamava `auth-check-handle` / `auth-reserve-handle`, reservando @ em `public.handle_reservations`.~~ | Regra 4 e §3.2 | **RESOLVIDO e PUBLICADO (09/11/2026):** `food-company-handle-check` no ar, reserva removida do Food, `auth-reserve-handle` apagada do projeto e tabela `handle_reservations` apagada (migration 061). |
| 2 | ~~`auth-check-email` aceitava a chave do Food, sem ser chamado.~~ | Superfície sem uso | **RESOLVIDO (09/11/2026):** função apagada do código e do projeto. |
| 3 | ~~`takeaway-payment-create` não tinha teto para `fee_total_cents`.~~ | Regra 2 (o cofre protege o dinheiro) | **P2a FEITO no código (09/11/2026):** teto `FEE_ABOVE_CAP` (422) = 60% do valor + R$ 10 + 2 centavos, que cobre o máximo que o Admin consegue configurar (30% + 30% + R$ 10); ajustável por `FOOD_MAX_FEE_BPS` / `FOOD_MAX_FEE_FIXED_CENTS`. **Se os limites de `takeaway.admin_set_fees` subirem, suba o teto junto.** **Publicado em 09/11/2026.** |
| 4 | Funções de execução única `admin-backfill-deposit-key`, `admin-diag-carregar`, `admin-fix-pix-key-encryption` (Alber, `service_role`, segredo próprio); o nome "admin-*" confunde com o Alber Admin. | Regra 3 e §5.2 (clareza de quem é o Admin) | **P2b:** conferido em 09/11/2026: as três estão **publicadas (ACTIVE)**, mas os segredos que as destravam (`BACKFILL_ADMIN_SECRET`, `DIAG_ADMIN_SECRET`, `PIX_FIX_ADMIN_SECRET`) **não existem**, então hoje recusam tudo. **RESOLVIDO em 09/11/2026:** removidas do código e apagadas do projeto (confirmado por `supabase functions list`; o CLI apaga uma função por comando). |
| 5 | ~~`receiving/service.ts` (Food) grava `kyc_status = 'rejected'` localmente.~~ | §7 | **P4 verificado:** só ocorre quando o Alber informa `rejected` ou que a empresa não existe mais (`COMPANY_NOT_FOUND`); é espelho. Sem desvio. |
| 6 | O cliente falso do Food reimplementa a guarda de saque. | Regra 6 (risco de deriva do contrato) | **P4 FEITO:** vetor de contrato com os mesmos literais nos dois repositórios (`contract-vectors.test.ts`: limite de empresa nova, tetos de aumento, espera de 48 h). O falso continua existindo só para testes. |

---

## 14. Fontes

- Alber: `00_architecture.md` §4.1 · `04_api_asaas.md` · `05_security.md` §7.1 · `06_modules/food_company_service.md` · `06_modules/empresa_operadores.md`
- Alber Food: `CLAUDE.md` · `rules.md` §2.1.2, §3, §4, §6 · `docs/plano-separacao-pf-pj.md` · `specs/phases/4_identidade_financeira_e_saque.md`
- Alber Admin: `CLAUDE.md` · `rules.md` §1, §7, §9–§11, §16 · `docs/deploy.md`
