# Alber — Roteiro da virada do Alber Food para o projeto Supabase próprio
**Versão:** 1.0 (11/11/2026)
**Faz parte de:** `10_separacao_projeto_food.md` (fases 5, 6 e 7)
**Estado de partida:** projeto novo `alber-food` (`gdcdnpkuoqlzkqghfsxu`, São Paulo) com banco migrado (43 migrations), segredos novos gravados só nele, `food-api` e `food-admin` publicadas, bucket `menu-images` criado. O projeto do Alber (`cxknwpvnabfetcsaengv`) ainda atende o Food em uso.

Regra deste roteiro: **cada passo que muda produção só roda depois do "sim" do usuário**. Nenhum valor de segredo passa por chat; o assistente usa `supabase secrets set` lendo do arquivo local do usuário (ver passo 3) ou o usuário cola no próprio terminal.

---

## 0. Antes do dia (sem risco)

- [ ] **Segredos guardados.** Os 6 valores novos que se repetem estão no gerenciador de senhas como entradas **separadas** das antigas, com rótulos: `… (projeto novo)` e `… (projeto antigo, até o corte)`. Valores: `FOOD_BFF_SECRET`, `FOOD_OP_SIGNING_KEY`, `ALBER_FOOD_SERVICE_KEY` (no Food: `ALBER_SERVICE_KEY`), `FOOD_WEBHOOK_SECRET` (no Food: `ALBER_WEBHOOK_SECRET`), `FOOD_ADMIN_KEY`, `FOOD_ADMIN_SIGNING_KEY`.
- [ ] **Os valores antigos estão guardados** (são o caminho de volta). Sem eles não há rollback das chaves.
- [ ] **Acessos à mão:** Railway (projeto do site), GitHub do `alber-food` (Settings → Variables), painel do Supabase, e o terminal com `supabase login` feito.
- [ ] **Resend:** a chave nova está no projeto novo (`RESEND_API_KEY`). A chave antiga **não** é revogada antes do passo 9.
- [ ] **Deploys do Food atualizados:** `git push` do `alber-food` (commits locais: script e workflow que publica a `food-admin`) e do Alber (spec 10/10a), com OK do usuário.
- [ ] **Inventário do Alber (somente leitura)** do que será zerado (ver passo 2): hoje as 2 empresas do Alber são ambas de origem `food`.
- [ ] **Escolher a janela** (dia e hora; 30 a 60 minutos; sem usuários reais).

## 1. Estado de teste antes de começar (2 min)

Confirmar que a base está como o roteiro supõe:
```
curl -s https://gdcdnpkuoqlzkqghfsxu.supabase.co/functions/v1/food-admin/health      # {"status":"ok"}
curl -s -o /dev/null -w "%{http_code}" -X POST https://gdcdnpkuoqlzkqghfsxu.supabase.co/functions/v1/food-api/   # 401
curl -s https://food.usealber.com.br/api/health   # site atual ok (aponta ao projeto antigo)
```

## 2. Zerar o teste no Alber (fase 6, passo 2) — pede OK explícito

O banco do Food novo nasceu vazio (D1). O Alber guarda duas empresas de teste de origem `food` e as operações associadas; ficariam órfãs.

1. Inventário (leitura): empresas `origin='food'` e linhas por tabela em `food_ops`, `company_operators`, `company_invites`, `company_limit_requests`, `transactions` (as tabelas que referenciam `public.companies`).
2. Mostrar ao usuário **o que será apagado** e que as subcontas correspondentes ficam órfãs no Asaas (sandbox, sem custo).
3. Só com o "sim": apagar nessa ordem (filhos antes, depois `companies`), numa transação.
4. Confirmar contagens zeradas.

## 3. Alber: gravar os valores novos (fase 5) — pede OK explícito

> A partir daqui o Food **antigo** deixa de conseguir falar com o Alber e com o Admin (as chaves mudam). É o início da janela.

No projeto do Alber (`cxknwpvnabfetcsaengv`), gravar, lendo de `%USERPROFILE%\alber-food-novo\segredos-novos.env` (ou colando no terminal):

| No Alber | Vem de (no Food novo) |
|---|---|
| `ALBER_FOOD_SERVICE_KEY` | `ALBER_SERVICE_KEY` |
| `FOOD_WEBHOOK_SECRET` | `ALBER_WEBHOOK_SECRET` |
| `FOOD_OP_SIGNING_KEY` | `FOOD_OP_SIGNING_KEY` |
| `FOOD_ADMIN_KEY` | `FOOD_ADMIN_KEY` |
| `FOOD_ADMIN_SIGNING_KEY` | `FOOD_ADMIN_SIGNING_KEY` |
| `FOOD_ADMIN_URL` | `https://gdcdnpkuoqlzkqghfsxu.supabase.co/functions/v1/food-admin` (não é segredo) |

`FOOD_WEBHOOK_URL` **não muda** (continua `https://food.usealber.com.br/api/internal/asaas-event`; o site é o mesmo).

Conferir pelo digest (`supabase secrets list`) que os 5 valores do Alber batem com os do projeto novo (mesmo SHA-256). Depois **republicar `admin-api`** para o Admin pegar as chaves e a URL novas.

## 4. Site (Railway): apontar para o projeto novo (fase 6, passo 3) — pede OK

1. Railway → variáveis do site: `FOOD_API_URL` = `https://gdcdnpkuoqlzkqghfsxu.supabase.co/functions/v1/food-api` e `FOOD_BFF_SECRET` = valor **novo**. Publicar.
2. O CSP de imagens segue sozinho: o site deriva a origem do storage de `FOOD_API_URL`.
3. GitHub (`alber-food` → Settings → Variables): `SUPABASE_PROJECT_REF` = `gdcdnpkuoqlzkqghfsxu`. O workflow "Deploy backend" passa a publicar `food-api` e `food-admin` no projeto novo e a aplicar migrations lá.

## 5. Fumaça (fase 6, passo 4)

Sem usuários: use dados seus/de teste.

- [ ] `https://food.usealber.com.br/api/health` → `{"status":"ok","backend":"up","db":"up"}`
- [ ] `food-api/health` do projeto novo **sem** segredo → 401; com segredo → `posture` com `role: takeaway_app`, `tls: true`, `bypassRls: false`
- [ ] Cadastro de restaurante completo (chega o e-mail do Resend?), login e logout
- [ ] Abertura de empresa (sandbox Asaas): cria a empresa no Alber (origem `food`)
- [ ] Pedido pago de teste → o evento do Asaas chega ao Alber e ao Food (confirma o pedido)
- [ ] Saque de R$ 10 (valida `FOOD_OP_SIGNING_KEY`, destino único, carência)
- [ ] Admin → Food: abrir Restaurantes e Hoje; ajustar uma taxa e devolver; revelar um telefone
- [ ] Admin → imagem do cardápio carrega (bucket novo) após subir uma foto

## 6. Voltar atrás (se algo falhar nos passos 3 a 5)

O projeto antigo (banco e funções) fica intacto durante toda a observação.

1. **Railway:** devolver `FOOD_API_URL` (projeto antigo) e `FOOD_BFF_SECRET` (valor antigo, do gerenciador). Publicar.
2. **Alber:** regravar os 5 valores antigos e `FOOD_ADMIN_URL` antigo (`https://cxknwpvnabfetcsaengv.supabase.co/functions/v1/food-admin`); republicar `admin-api`.
3. **GitHub:** `SUPABASE_PROJECT_REF` de volta ao projeto antigo.
4. Dados criados no projeto novo durante a janela são descartados (era para ser só teste).

## 7. Observação (alguns dias)

Sem mudar nada: acompanhar e-mails, webhooks, pedido de teste diário, Admin. O projeto antigo continua disponível para o rollback.

## 8. Limpeza (fase 7) — só depois de estável, cada item pede OK

**Projeto do Alber (`cxknwpvnabfetcsaengv`):**
1. `supabase functions delete food-api` e `food-admin`.
2. Apagar o schema `takeaway`, a role `takeaway_app`, `food_admin_api`, e as concessões da `admin_app` ao Food (já revogadas pela 0043). Antes, uma última cópia do banco (backup) se quiser guardar o histórico.
3. Remover os **segredos que eram só do Food** (confirmados por busca no código do Alber e do Admin: nenhum uso): `FOOD_BFF_SECRET`, `FOOD_DATABASE_URL`, `APP_PASSWORD_PEPPER`, `APP_PIN_PEPPER`, `IFOOD_CLIENT_ID`, `IFOOD_CLIENT_SECRET`, `WEB_PUSH_VAPID_PUBLIC`, `WEB_PUSH_VAPID_PRIVATE`, `WEB_PUSH_SUBJECT`, `TEAM_NOTIFY_EMAIL`, `CNPJ_LOOKUP`, `ALBER_SERVICE_KEY`, `ALBER_WEBHOOK_SECRET`.
   - **Conferir antes de remover:** `FOOD_ASAAS_WEBHOOK_TOKEN` (confirmar no código quem usa).
   - **Não remover (o Admin usa):** `APP_BASE_URL`, `ALBER_FUNCTIONS_URL`, `EMAIL_FROM`, `RESEND_API_KEY`, `ADMIN_*` e, até o Admin deixar de ler, `APP_ENCRYPTION_KEY` e `APP_ENCRYPTION_KEY_V` (o Admin usa `ADMIN_ENCRYPTION_KEY` com `APP_ENCRYPTION_KEY` como alternativa; confirmar que o Admin não depende da alternativa antes de remover).
4. Revogar a chave antiga do Resend (`alber-food`) e o token de deploy antigo, se houver um por projeto.
5. Atualizar `09_responsabilidades_sistemas.md` (canal C11, §8 banco, §9 segredos, §10 deploy), os `CLAUDE.md` dos três repositórios e a nota de memória.
6. Apagar `%USERPROFILE%\alber-food-novo` (tudo já está no gerenciador de senhas).

## 9. Itens fora deste roteiro, a decidir depois

- Admin sair do projeto do Alber (D4: depois).
- `CARDAPIOWEB_PARTNER_KEY` e `EMAIL_FROM` no projeto novo (hoje ausentes/padrão).
