# Alber — Spec Módulo Empresa / Operadores (PJ)
**Versão:** 1.0
**Data:** 15/08/2026
**Depende de:** 00_architecture.md, 03_backend.md, 04_api_asaas.md, 05_security.md
**Status:** Spec retroativa — módulo já implementado (Plano CNPJ, codinome interno
"velvet-puzzling-sedgewick"), documentado aqui pela primeira vez.

---

## 1. Visão geral

Conta empresa (PJ) é uma subconta Asaas paralela às contas pessoais, com CNPJ
próprio, `@handle` próprio e saldo próprio — não é uma "carteira compartilhada"
dentro de uma conta pessoal. Toda empresa tem exatamente um **master**
(`companies.owner_id`) e zero ou mais **operadores** (`company_operators`).

- **Master:** sempre acesso total e implícito a todas as funcionalidades da
  empresa. Nunca passa pela matriz de permissões.
- **Operador:** pessoa física com conta pessoal própria no Alber, convidada
  pelo master para operar a empresa. Só pode usar o que estiver explicitamente
  liberado na sua matriz de `permissions` — **não é um papel fixo** (tipo
  "gerente"/"financeiro"), é uma seleção livre de funcionalidades por pessoa,
  igual a um conjunto de toggles.

Uma mesma pessoa pode ser master de uma empresa, operador de outra, e ainda
manter sua conta pessoal — troca de contexto é local ao app (§8).

---

## 2. Matriz de permissões

Chaves centralizadas em `supabase/functions/_shared/company-permissions.ts`
(`COMPANY_PERMISSION_KEYS`) e espelhadas em `store/company.store.ts` e
`locales/pt-BR.json` (`empresas.permissoes`). **Fail-closed**: chave ausente ou
`false` = negado. Qualquer tela/funcionalidade nova de empresa que precisar de
controle de acesso próprio deve adicionar sua chave nessa lista central.

| Chave | Libera | Endpoint(s) que checam |
|---|---|---|
| `ver_saldo` | Ver saldo disponível/bloqueado da empresa | `financial-balance` |
| `ver_extrato` | Ver extrato de transações da empresa | `financial-atividade` |
| `carregar` | Gerar QR Code Pix para carregar Albers na empresa | `financial-carregar` |
| `descarregar` | Sacar Albers da empresa para a chave Pix de saque | `financial-descarregar` |
| `transferir` | Enviar Albers da empresa para outro usuário/empresa | `financial-transferir` |
| `receber` | Receber Albers de outro usuário/empresa (fluxo Receber) | `financial-receber` |
| `pagar` | Reservada — sem funcionalidade associada nesta versão (ver §11) | — |
| `gerenciar_operadores` | Convidar, listar e alterar permissões de outros operadores | `company-operator-invite`, `company-invite-link-create`, `company-operators-list`, `company-operator-set-permissions` |

A validação central é `requireCompanyPermission(userId, companyId, chave)`:
master sempre `ok: true`; operador precisa de linha `status = 'active'` em
`company_operators` com `permissions[chave] === true`. As Edge Functions
financeiras usam `resolveWalletContext`, que decide entre carteira pessoal
(sem `company_id` no request) ou carteira da empresa (com `company_id`,
validando a permissão correspondente) — `user_id` gravado na transação é
sempre quem executou a ação; `company_id` só identifica de qual carteira saiu
o dinheiro.

---

## 3. Criação da empresa

Empresa **não é criada dentro do app por um operador** — só existe por
decisão de produto:

1. **No cadastro** (`app/(auth)/cadastro/dados-empresa.tsx`, quando
   `accountType === 'business'`): a pessoa preenche CNPJ, razão social, nome
   fantasia (opcional), tipo (`MEI` | `LIMITED` | `INDIVIDUAL` | `ASSOCIATION`),
   endereço da empresa, faturamento mensal e escolhe um `@handle` próprio da
   empresa (mesma validação de formato do handle pessoal). Handle da empresa
   não pode colidir com handle de pessoa física nem de outra empresa
   (checagem cruzada em `_shared/company.ts`, não é constraint de banco).
2. **Melhoria 1** — dono que já tem conta pessoal: `POST company-create`
   permite abrir a empresa sem repetir dados pessoais, autenticado com o JWT
   da conta pessoal existente. Rate limit de 5 tentativas / 15 min por IP
   (mesma proteção do `auth-register`, cada chamada bem-sucedida cria uma
   subconta real na Asaas).

Quem cria a empresa é automaticamente o master (`owner_id`). Não existe fluxo
de "transferir a posição de master" nesta versão.

---

## 4. Convidar operador (só master ou operador com `gerenciar_operadores`)

Tela: `app/(app)/empresas/[id]/operadores.tsx`. Dois caminhos:

### 4.1 Por @handle (quem já tem conta Alber)
`POST company-operator-invite { company_id, handle, permissions? }` —
cria/atualiza a linha em `company_operators` com `status: 'invited'` e a
matriz de permissões inicial (chaves desconhecidas são ignoradas
silenciosamente). Push notification para o convidado. Erros: não pode
convidar a si mesmo (`CANNOT_INVITE_SELF`), não pode convidar o próprio
master (`IS_MASTER`), não pode reconvidar quem já é operador ativo
(`ALREADY_OPERATOR`).

### 4.2 Por link (quem nunca usou o Alber)
`POST company-invite-link-create { company_id, permissions? }` gera um token
opaco com validade de 7 dias, guardado em `company_invites` (não pode viver
em `company_operators` porque essa tabela exige `user_id NOT NULL`, e a
pessoa convidada ainda não existe). O link (`alber://convite-operador/{token}`)
é compartilhado via `Share.share`. `GET company-invite-preview?token=...` é
público (chamado com ANON key) e só expõe nome/nome fantasia da empresa e
validade — usado pela tela `app/(auth)/convite-operador/[token].tsx` antes do
cadastro. Ao final do cadastro enxuto, `auth-register` consome o token e cria
a linha em `company_operators` já com `status: 'invited'` e as permissões do
convite.

### 4.3 Aceite
`POST company-operator-join { company_id }` — o convidado promove sua própria
linha de `invited` para `active` (`joined_at` preenchido). Não existe fluxo de
"pedir para entrar" como no Alber Lounge — só o master (ou operador com
`gerenciar_operadores`) inicia o convite.

---

## 5. Ver e alterar permissões (master, a qualquer momento)

`GET company-operators-list?company_id=...` lista todos os operadores da
empresa (nome, handle, status, matriz de permissões completa, `joined_at`) —
requer `gerenciar_operadores`.

Na mesma tela de operadores, cada card é expansível e mostra um `Switch` por
chave de permissão (`store/company.store.ts#setOperatorPermissions` →
`POST company-operator-set-permissions { company_id, operator_user_id,
permissions }`). **Isso não é exclusivo do momento do convite** — o master
pode reabrir o card de um operador já `active` e ligar/desligar qualquer
combinação de permissões quando quiser. O backend faz **merge parcial**: só as
chaves enviadas no request são alteradas, o resto da matriz permanece como
estava. Toda alteração grava `audit_logs` (`company_operator_permissions_updated`,
com `company_id`, `operator_user_id` e as chaves alteradas).

Não existe tela separada de "editar operador" — é a mesma UI usada para
configurar as permissões iniciais no convite por @handle (o formulário de
convite não expõe os toggles; ver §11) e para editar depois.

### 5.1 Remover operador (revogar acesso)

`POST company-operator-remove { company_id, operator_user_id }` — master (ou
operador com `gerenciar_operadores`) revoga o acesso de um operador `active`
ou ainda `invited`. Não é possível remover a si mesmo
(`CANNOT_REMOVE_SELF`). Marca `status: 'banned'` e zera a matriz de
`permissions` (defesa em profundidade — `requireCompanyPermission` já exige
`status = 'active'`, então a matriz zerada não muda o comportamento, só evita
deixar permissões "penduradas" numa linha inativa). A linha não é apagada —
histórico retido para auditoria (`audit_logs: company_operator_removed`).

**Reversível:** um novo convite (por @handle ou por link) para a mesma pessoa
sobrescreve a linha de volta para `invited` — `company-operator-invite` só
bloqueia reconvite quando o status atual já é `active`, não quando é
`banned`. Ou seja, "remover" aqui tem semântica de revogação de acesso, não
de banimento permanente.

Na tela de operadores, o botão "Remover operador" aparece dentro do card
expandido de qualquer operador que não esteja já `banned`, com confirmação
antes de executar.

---

## 6. Troca de contexto (pessoal ↔ empresa)

`store/active-context.store.ts` guarda qual carteira está ativa no app —
pessoal ou uma empresa específica (`{ type: 'company', companyId,
companyName }`), persistido em `SecureStore` só por conveniência de UX (o app
reabre onde a pessoa deixou). A troca em si é **100% client-side**: nenhuma
chamada de rede valida a troca no momento em que ela acontece — cada Edge
Function financeira revalida a permissão a cada request via
`resolveWalletContext`, então mesmo que o app mostre uma empresa em que o
usuário não tem mais permissão, a operação é bloqueada no servidor
(`403 FORBIDDEN`).

`GET company-list` retorna todas as empresas onde o usuário é master ou
operador `active`, usado para popular o seletor de conta (Header) e a tela
`app/(app)/empresas/index.tsx`.

---

## 7. Chave Pix de saque da empresa

Configuração separada de `pix_key` pessoal — `companies.pix_key` começa nula
e `financial-descarregar` retorna `COMPANY_PIX_KEY_NOT_CONFIGURED` enquanto
isso. Tela `app/(app)/empresas/[id]/pix.tsx` (dentro do app, pós-cadastro) e
`app/(auth)/cadastro/empresa-pix.tsx` (durante o cadastro). **Só o master
configura** — não delegável nem a um operador com a permissão `descarregar`
(decisão explícita: mais sensível que operação do dia a dia). Dois tipos:

- `cnpj`: reconfirma que o CNPJ digitado bate com o hash já cadastrado da
  empresa (sem chamada à Asaas).
- `random` (EVP): gera e registra uma chave nova na subconta da empresa via
  Asaas.

Só pode ser configurada uma vez (`409 PIX_KEY_EXISTS` numa segunda tentativa)
— não existe fluxo de troca depois de definida.

---

## 8. Ciclo de vida do KYC da empresa

- `kyc_status`: `pending` → `submitted` → `approved` | `rejected`.
- `account_status`: `evaluation` | `active` | `blocked`.
- `webhooks-asaas-kyc` processa a resposta da Asaas e, na aprovação, cria a
  chave Pix de recebimento (EVP) da empresa automaticamente (mesmo padrão da
  conta pessoal).
- **Rejeição automática:** quando a Asaas rejeita o KYC da empresa, o webhook
  marca `companies.deleted_at`, liberando CNPJ e `@handle` na hora (índices
  únicos parciais `WHERE deleted_at IS NULL`, migration 044) — diferente da
  exclusão de conta pessoal (que sobrescreve os dados), aqui a linha e o
  CNPJ/handle originais são retidos para detectar squatting repetido.
- **Abandono manual:** `POST company-abandon { company_id }` — só o master,
  só antes do KYC ser `approved`. Mesmo efeito de `deleted_at`. A empresa
  continua aparecendo em `company-list` para o master (marcada como
  cancelada/reprovada), só some da checagem de CNPJ/handle disponível para
  novo cadastro.
- Empresa com KYC já `approved` não pode ser abandonada por este endpoint.

---

## 9. Regras obrigatórias específicas deste módulo

- Master nunca aparece em `company_operators` — acesso implícito, nunca uma
  linha com permissões.
- Toda checagem de permissão de operador é fail-closed: adicionar uma chave
  nova em `COMPANY_PERMISSION_KEYS` sem marcá-la `true` em nenhum operador
  não libera nada por padrão.
- RLS: operador só enxerga a própria linha em `company_operators`; master
  enxerga todas as da própria empresa. `INSERT`/`UPDATE`/`DELETE` nas tabelas
  `companies`, `company_operators` e `company_invites` são exclusivos ao
  service role — nenhuma escrita direta via client/PostgREST.
- `transactions.company_id` identifica a carteira; `transactions.user_id`
  continua sendo sempre quem executou a ação (master ou operador).

---

## 10. Analytics obrigatórios

**Nenhum evento de analytics está instrumentado neste módulo hoje** —
violação da regra "SEMPRE registrar eventos de analytics nos pontos críticos"
(00_architecture.md §8). Eventos mínimos a adicionar antes de considerar o
módulo fechado:

`empresa_list_viewed`, `empresa_create_started`, `empresa_created`,
`empresa_operator_invite_started`, `empresa_operator_invited`,
`empresa_operator_invite_link_created`, `empresa_operator_joined`,
`empresa_operator_permissions_changed`, `empresa_operator_removed`,
`empresa_pix_key_configured`, `empresa_abandoned`, `empresa_context_switched`.

---

## 11. Lacunas conhecidas / fora de escopo desta versão

- **Permissão `pagar` sem funcionalidade associada:** a chave existe na
  matriz e na UI, mas nenhum endpoint a checa — reservada para quando o
  módulo Consumir (parceiros, hoje fora do MVP, ver 07_open_decisions.md
  §1.2) existir também no contexto empresa.
- **Handle e razão social da empresa não são editáveis** depois do cadastro
  (mesma regra informal do handle pessoal, mas aqui nem cooldown existe —
  é definitivo nesta versão).
- **Sem transferência de titularidade (master):** não há como trocar quem é
  o master de uma empresa sem passar pelo suporte.
- **Fila de convites pendentes sem expiração/cancelamento pelo master:**
  diferente do convite por link (expira em 7 dias), o convite por @handle
  (`status: 'invited'`) não tem prazo nem botão de cancelar — só existe
  aceitar (`company-operator-join`).

---

## 12. Critérios de aceitação

| ID | Critério |
|---|---|
| EMP-01 | Master tem acesso total e implícito, nunca passa pela matriz de permissões |
| EMP-02 | Operador só executa uma ação se a chave correspondente estiver `true` na sua matriz — ausência ou `false` bloqueia (fail-closed) |
| EMP-03 | Master pode convidar operador por @handle (quem já tem conta) ou por link (quem nunca usou o Alber) |
| EMP-04 | Convite por link expira em 7 dias |
| EMP-05 | Operador só passa a `active` quando ele mesmo aceita — master não pode forçar a adesão |
| EMP-06 | Master (ou operador com `gerenciar_operadores`) pode ver a matriz de permissões de todos os operadores da empresa |
| EMP-07 | Master (ou operador com `gerenciar_operadores`) pode alterar a matriz de permissões de um operador já `active`, a qualquer momento, não só no convite |
| EMP-08 | Alteração de permissões faz merge parcial — chaves não enviadas permanecem como estavam |
| EMP-09 | Toda alteração de permissões gera registro em `audit_logs` |
| EMP-10 | Chave Pix de saque da empresa só pode ser configurada pelo master, uma única vez |
| EMP-11 | Troca de contexto (pessoal ↔ empresa) no app não substitui a validação de permissão no backend a cada request |
| EMP-12 | KYC de empresa rejeitado pela Asaas libera CNPJ/handle automaticamente para novo cadastro |
| EMP-13 | Master pode abandonar o cadastro da própria empresa antes do KYC ser aprovado; depois de aprovado, não |
| EMP-14 | Master (ou operador com `gerenciar_operadores`) pode remover o acesso de um operador `active` ou `invited`; não pode remover a si mesmo |
| EMP-15 | Remoção marca `status: 'banned'` e zera a matriz de permissões, sem apagar a linha (histórico retido) |
| EMP-16 | Operador removido pode ser reconvidado normalmente — remoção não é banimento permanente |
