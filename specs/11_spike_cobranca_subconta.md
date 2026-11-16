# Spike: cobrança do Food na SUBCONTA do restaurante, taxa Alber como split

Data: 15/11/2026. Só sandbox do Asaas (`sandbox.asaas.com`). Scripts descartáveis: `scripts/spike-asaas-subconta-cobranca*.mjs`
(partes 1 a 3; criam subcontas de teste novas com CNPJ gerado). Nada de produção foi tocado; `takeaway-payment-*` não foi alterado.

## Resposta curta
**Dá para emitir a cobrança na subconta, com a taxa Alber como split para a conta-mãe.** A cobrança sai em nome do restaurante,
e a fatura do cartão diz que a responsabilidade é do restaurante (resolve R1 a R3 no cartão). Duas ressalvas abertas: o QR do
Pix (nome do recebedor) não pôde ser conferido (subconta sem chave Pix no sandbox) e o estorno não foi concluído no teste.

## O que foi testado e o resultado

| # | Teste | Resultado |
|---|---|---|
| 1 | `POST /payments` com a chave da subconta, `billingType: PIX`, `split: [{walletId: <mãe>, fixedValue: 1.99}]` | **Aceito.** `split[0].totalValue = 1.99`, `status: PENDING`, `netValue 19,01` sobre R$ 20,00 |
| 1b | Idem com `percentualValue: 10` | **Aceito.** `totalValue = 1.90` = 10% do **líquido** (19,01), como o split-faq diz |
| 1c | `GET /payments/{id}` com a chave da conta-mãe | **A mãe enxerga e consulta** a cobrança da subconta (e o split). `GET /payments?externalReference=` pela mãe não foi testado |
| 1d | `GET /payments/{id}/pixQrCode` | **Falhou:** `invalid_action: Você não possui uma chave Pix cadastrada para recebimentos de cobranças via Pix.` A subconta precisa de chave Pix. `POST /pix/addressKeys {type:EVP}` devolveu 504 e "excesso de consultas" no sandbox (6 tentativas), então **não vi o payload nem o nome do recebedor** |
| 2 | Cartão: `billingType: CREDIT_CARD`, split fixo, na subconta | **Aceito.** Fatura (`invoiceUrl`) diz: "Esta cobrança é de responsabilidade única e exclusiva de **{nome da subconta}, CNPJ …**. O Asaas não se responsabiliza pelo produto ou serviço prestado." O cabeçalho é "Asaas - {cliente}" e mostra o nome da subconta. Alber não aparece |
| 2b | `callback: {successUrl, autoRedirect}` | **Recusado:** `Não há nenhum domínio configurado em sua conta. Cadastre um site em Minha Conta na aba Informações.` Precisa de domínio (site) cadastrado na subconta. Não achei endpoint para isso (`commercialInfo` não trouxe `website`); é a pergunta nova para o Asaas |
| 3 | Cartão pago por API: `POST /payments/{id}/payWithCreditCard` (cartão de teste) | **Funcionou** (`CONFIRMED`, `netValue 19,12`). Na primeira vez deu `unknow.error`, na repetição passou. Serve para pagar sem fatura |
| 3b | `POST /creditCard/tokenizeCreditCard` na subconta | **Funcionou** (devolve `creditCardToken`). Só cartão de crédito; não existe tokenização de débito |
| 4 | Pix com cliente **sem** CPF/CNPJ | **Recusado:** `Para criar esta cobrança é necessário preencher o CPF ou CNPJ do cliente.` Vale na subconta como na mãe: o C6 não se resolve por aqui. Cartão com `payWithCreditCard` também exige `cpfCnpj` no `creditCardHolderInfo` |
| 5 | Estorno `POST /payments/{id}/refund` | **Não concluído.** Em cobrança `PENDING`: "somente cobranças confirmadas ou recebidas". Logo após `CONFIRMED`: "Não é possível solicitar estorno … tente novamente em alguns instantes". Depois do estorno falho o split seguia `AWAITING_CREDIT`. **Não verifiquei** devolução de taxa nem reversão do split |
| 6 | Webhook | Subconta nova nasce com `GET /webhooks` vazio. O fluxo atual cria os webhooks no `POST /accounts` (`createAsaasAccount`). Não testei entrega de evento |

Taxas observadas no sandbox (valem para a tarifa de teste, não para a negociada em produção): Pix R$ 0,99 (`netValue 19,01`),
cartão R$ 0,88 (`netValue 19,12`). **Quem paga a taxa:** neste desenho ela sai do valor da subconta (o `netValue` já vem descontado
na cobrança do restaurante). O split fixo da Alber é abatido além disso. Ou seja, o restaurante absorve a tarifa do Asaas; a Alber
só recebe o split. Para a Alber ficar com "taxa Alber + tarifa Asaas" nada muda: o restaurante é quem arca com a tarifa, então o
percentual sobre o líquido fica sob o restaurante, não sobre o bruto.

## Exigências da subconta (descobertas)
- Chave de API da subconta (já guardada cifrada em `companies.asaas_api_key_enc`; ver memória sobre o cifra com `ASAAS_API_KEY`).
- **Chave Pix de RECEBIMENTO no Asaas** (obrigatória para o QR Pix; é uma EVP criada na própria subconta por `POST /pix/addressKeys`). É diferente da chave de SAQUE (`companies.pix_key`/`pix_key_type`, normalmente de outro banco). Hoje a de recebimento fica em `companies.asaas_deposit_key` (cifrada; a migration 033 a descreve como chave de RECEBIMENTO, sempre EVP) e é criada em modo "não-crítico" em `_shared/company.ts` (~l. 387), no aprovar do KYC (`webhooks-asaas-kyc`, `_shared/company-kyc.ts`) e sob demanda. Conferência no banco do Alber em 15/11/2026: 1 empresa ativa (aprovada) e ela tem `asaas_deposit_key`. Falta tornar o passo **obrigatório**: ver "Abertura de conta de recebimento".
- **Domínio/site cadastrado** na subconta, só se quisermos `callback.successUrl`.
- `walletId` da conta-mãe: `GET /wallets/` com a chave da mãe (uma carteira); guardar em segredo/config (`ASAAS_PARENT_WALLET_ID`).
- CPF/CNPJ do pagador sempre.
- Conta no sandbox criou cobrança sem KYC aprovado; **em produção depende da aprovação** (o código já exige `kyc_status = approved`).

## Mudanças recomendadas (não aplicadas)

**`takeaway-payment-create`**
1. Decifrar a chave da subconta da empresa (`asaas_api_key_enc`, mesmo helper do resto do Alber) e usá-la no lugar de `ASAAS_API_KEY` em `createTakeawayCustomer`, `createTakeawayPayment`, `findPaymentByReference` e `getPixQrCode`. O cliente (customer) passa a viver na subconta.
2. Trocar o split: hoje `walletId = carteira da empresa` com `fixedValue = valor − taxa`. Passa a ser `walletId = carteira da MÃE` com `fixedValue = fee_total` (ou `percentualValue = 10000 − restaurant_bps` em modo `percent_of_net`, sobre o líquido). A validação de teto (`FEE_ABOVE_CAP`) continua valendo.
3. Pix: exigir chave Pix da subconta; se o Asaas responder `Você não possui uma chave Pix`, devolver erro claro (ex.: `COMPANY_NO_PIX_KEY`, 409).
4. **Não usar `callback.successUrl`** (exige domínio na subconta). Decisão: a baixa é feita pelo Alber, pelo webhook `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`, que avisa o Food; a página do pedido usa o status e a consulta de reserva (`takeaway-payment-status`).
5. Idempotência por `externalReference` precisa consultar a subconta (a mãe enxerga a cobrança, mas a busca por `externalReference` pela mãe não foi testada).

**`takeaway-payment-refund`**
1. Trocar `parentKey` pela chave da subconta em `getPaymentWithRefunds` e `refundPayment` (o estorno é da subconta; a mãe consegue consultar, mas o estorno pela mãe não foi testado).
2. Reaproveitar a espera: tratar `invalid_action ... tente novamente em alguns instantes` como transitório (retentativa) e não como `REFUND_REJECTED`.
3. Antes de ligar em produção, **verificar o estorno com a cobrança CONFIRMED/RECEIVED por alguns minutos**: se a tarifa volta, e se o split da Alber é revertido ou fica negativo na conta-mãe.
4. O webhook de pagamento: a conta que criou o webhook recebe o evento. A cobrança nasce na subconta, então o webhook configurado na mãe pode não receber `PAYMENT_*`; confirmar com o Asaas ou registrar o webhook na subconta (como o `createAsaasAccount` já faz com `pixWebhookUrl`), e apontar para o endpoint do Food.

**Abertura de conta de recebimento (Alber)**
- Tornar obrigatória a criação da chave Pix de recebimento: hoje a falha em `company.ts` só gera `console.warn`. Passa a: (a) empresa não apta ao Food enquanto `asaas_deposit_key` for nulo; (b) no aprovar do KYC, criar com retentativa e, se falhar, deixar pendente e reprocessar (o sandbox respondeu "excesso de consultas"); (c) `takeaway-payment-create` recusa com 409 (`COMPANY_NO_PIX_KEY`) se a empresa não tem a chave.
- Backfill para empresas aprovadas sem `asaas_deposit_key` (hoje nenhuma).

## Pendente / perguntas ao Asaas
1. Nome do recebedor no QR/Pix de cobrança da subconta (esperado: razão social do restaurante). Repetir o teste quando a criação de chave Pix no sandbox responder.
2. Estorno: tarifa devolvida? split revertido? A Alber paga algo se a subconta não tem saldo?
3. (Dispensada) domínio da subconta para `callback.successUrl`: a baixa será por webhook do Alber.
4. Evento `PAYMENT_*` de cobrança da subconta chega ao webhook da mãe ou só ao da subconta?
5. Cobrança sem CPF do pagador: não é possível; o C6 vira requisito de produto (coletar CPF).

## Implementado (15/11/2026, só no código; nada publicado)
- `_shared/food-subaccount.ts` (novo): carrega a empresa, decifra a chave da subconta, **cria a chave Pix de recebimento se faltar** (obrigatória; falha = 409 `COMPANY_NO_PIX_KEY`), resolve a carteira da conta pai (`ASAAS_PARENT_WALLET_ID` ou `GET /wallets/`) e escolhe a chave para consultar/estornar/cancelar.
- `takeaway-payment-create`: cliente, cobrança, QR e busca por referência com a chave da subconta; split vai para a carteira da conta pai (`fee_total` fixo, ou `100% − restaurant_bps` do líquido). Sem `callback`.
- `takeaway-payment-refund`, `-cancel`, `-status`: aceitam `company_id` opcional (a chave da subconta); sem ele usam a chave pai (cobranças antigas). **O Food precisa passar `company_id`** nas cobranças novas.
- `webhooks-asaas-pix` (webhook das subcontas): eventos `PAYMENT_*` com `externalReference` `food_…` são repassados ao Food (`forwardToFood`) antes do restante, sem tocar nas tabelas do app. Pré-requisito: a subconta ter o webhook de pagamentos (criado em `createAsaasAccount`; conferir na subconta existente, p.ex. a do Bar do Zé).
- Testes: create (16), refund/cancel (7), status, webhooks passam; `deno check` ok. Sem teste novo para o repasse no webhook.
- **Antes do deploy:** (1) definir `ASAAS_PARENT_WALLET_ID` (opcional); (2) Food passar a enviar `company_id` em refund/cancel/status; (3) validar estorno e nome no QR no sandbox; (4) cobranças pendentes criadas na conta pai continuam no webhook da mãe (`webhooks-asaas-food`), que segue ativo.

### Atualização (sandbox, 15/11/2026, rodada final)
- **Estorno pela chave da subconta funciona**: com ~45 s após `CONFIRMED`, `POST /payments/{id}/refund` devolveu `REFUNDED` e o **split da Alber foi cancelado** (`status CANCELLED`, `cancellationReason PAYMENT_REFUNDED`). Ou seja, a taxa Alber **não** fica na conta pai no estorno total. Logo depois do `CONFIRMED` o Asaas recusa com "tente novamente em alguns instantes" (o Food deve tratar como transitório e repetir).
- Se a tarifa do Asaas volta no estorno: **não verificado** (o extrato da subconta ainda estava vazio no sandbox, sem liquidação).
- Chave Pix da subconta recém-criada: o sandbox seguiu respondendo "excesso de consultas" (também em contas novas); QR e nome do recebedor continuam sem conferência. Conferir em subconta já aprovada (ex.: Bar do Zé) quando o Asaas liberar.
- `takeaway-payment-refund/-cancel/-status` **não exigem mudança no Food**: sem `company_id`, a empresa é achada pelo registro `takeaway_payment_created` (referência → empresa) que o `create` já grava; sem registro (cobrança antiga) usam a chave pai.

### Webhook: quem recebe o aviso (testado no sandbox, 15/11/2026)
Cobrança de cartão criada e paga na subconta, com split para a conta pai, com um webhook de teste na MÃE e outro na SUBCONTA (mesmos eventos, incluindo `PAYMENT_SPLIT_*`), ambos gravando o que chegava:
- **Subconta recebeu:** `PAYMENT_CREATED`, `PAYMENT_CONFIRMED`, `PAYMENT_REFUNDED`.
- **Mãe recebeu: nada** (nem `PAYMENT_*`, nem evento de split). Ser destinatária do split não gera aviso à mãe.
- Conclusão: o aviso de pagamento do Food **só chega pelo webhook da subconta** (`webhooks-asaas-pix`, já publicado com o repasse ao Food). Toda subconta do Food precisa ter o webhook de pagamentos; o `POST /accounts` aceita `webhooks[]` (como o `createAsaasAccount` já faz) e `GET /webhooks` com a chave da subconta lista. Para subcontas já existentes, é preciso conferir/criar esse webhook. O webhook da mãe (`webhooks-asaas-food`) só serve para cobranças antigas, criadas na mãe. A taxa Alber (split) deve ser conciliada por consulta (`GET /payments/splits/received`), não por webhook.
- Script: `scripts/spike-asaas-webhooks.mjs` (precisa de um receptor; o temporário foi apagado).

## Atualização 16/11/2026 (pós-publicação)

- **Publicado** (OK do Fernando, 16/11 19:59 UTC): `takeaway-payment-create` v41 (`charged_on: 'subaccount'`; `alber_fixed_cents` validado, > 0 recusado com 422 `ALBER_FIXED_UNSUPPORTED` até provar o split misto no sandbox) e `takeaway-payment-refund` v39 (409 `REFUND_RETRY_LATER`, 422 `REFUND_INSUFFICIENT_BALANCE`; classificação pelo texto da mensagem do Asaas; o caso de saldo não foi provado no sandbox).
- **Webhook de cobrança na subconta do Bar do Zé**: conferido com autorização do Fernando; o webhook de pagamentos existe nela.
- **Chave Pix de recebimento**: já é criada na aprovação do KYC (`company-kyc.ts`, `webhooks-asaas-kyc`) e, para empresa antiga sem ela, na primeira cobrança (`loadFoodCompany`: cria EVP na subconta e grava em `asaas_deposit_key`; se o Asaas falhar, 409 `COMPANY_NO_PIX_KEY`). Isso funciona como backfill sob demanda. `food-company-status` passa a devolver `receiving_pix_key: boolean` (distinta de `pix_key`, a chave de saque). **Não feito**: bloquear a abertura de conta se a criação da chave falhar; o criar-na-primeira-cobrança cobre o buraco, ao custo de a 1ª cobrança poder falhar se o Asaas oscilar.
- **Pendente**: provar no sandbox o split misto (fixo + percentual) e o estorno sem saldo; definir `ASAAS_PARENT_WALLET_ID` (hoje resolvido por `GET /wallets/` a cada chamada).
