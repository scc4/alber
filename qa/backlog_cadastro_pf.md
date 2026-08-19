# Backlog QA — Cadastro PF (Achados 23–38)

> Origem: rodada de QA sobre o fluxo de cadastro PF. Itens numerados em continuidade
> a uma rodada anterior (itens 1–22, não presente neste repositório — referenciados
> aqui apenas como contexto histórico dos achados que os citam).
>
> Status: todos os itens (23–38) corrigidos em 2026-08-18 (item 28 já estava corrigido). Pendente apenas validação em device/simulador — ver notas em cada item.

## Como usar este arquivo
Cada item mantém a numeração original do relatório de QA para rastreabilidade.
Ao implementar um item, mover para a seção "Concluídos" no rodapé com a data e o
commit/PR correspondente, e atualizar o spec relevante em `/specs/` se a mudança
alterar regra de produto.

---

## M0 — Crítico
_(vazio — ver Concluídos)_

---

## M1 — Alto
_(vazio — ver Concluídos)_

---

## M2 — Médio (linguagem/copy)
_(vazio — ver Concluídos)_

---

## I — Informativo / reconfirmação
_(vazio — ver Concluídos)_

---

## Concluídos

### Item 28 — Sem mensagem de erro inline para CPF inválido — já estava corrigido (verificado 2026-08-18)
- **Onde:** [app/(auth)/cadastro/dados.tsx](../app/(auth)/cadastro/dados.tsx)
- **Verificação:** o campo CPF já exibe `error` inline específico ("CPF inválido") do mesmo jeito que o campo Nome — o achado não reflete mais o estado atual do código. Nenhuma mudança necessária.

### Item 23 — Links de Termos/Privacidade não abrem — 2026-08-18
- **Onde:** [app/(auth)/cadastro/terms.tsx](../app/(auth)/cadastro/terms.tsx)
- **Causa raiz:** o componente `Check` envolvia checkbox + parágrafo inteiro em um único `TouchableOpacity`; o link `<Text onPress>` aninhado tinha seu toque capturado pelo Touchable pai antes de abrir o modal (o protótipo web em `/design/auth.jsx:600` já precisava de `e.stopPropagation()` pelo mesmo motivo — sem equivalente direto em RN).
- **Correção:** checkbox e parágrafo passaram a ter áreas de toque próprias (checkbox em `TouchableOpacity` isolado; parágrafo como `Text` com `onPress`), permitindo que o `Text` aninhado do link receba o toque corretamente. Conteúdo dos modais (`termsOfUseBody`/`privacyPolicyBody`) já estava correto em `pt-BR.json`.
- **Pendente:** validar em device/simulador (não verificado em browser — app nativo, sem preview web configurado).

### Item 36 — Duplicidade de CPF não bloqueada — 2026-08-18
- **Onde:** [app/(auth)/cadastro/dados.tsx](../app/(auth)/cadastro/dados.tsx)
- **Correção:** checagem em tempo real (debounce 500ms) via `authService.checkCpfExists` (reaproveitando a Edge Function `auth-check-cpf`, já usada no fluxo PJ) assim que o CPF passa no dígito verificador. Bloqueia o avanço (`isReady`) e mostra caixa de aviso âmbar (fiel ao `design/auth.jsx` `StepPersonal`, que já desenhava esse cenário) com "Este CPF já possui uma conta. Recuperar acesso?" — tocar nela leva ao login com o CPF pré-preenchido. Mesmo padrão já usado em `terms.tsx` para o erro `CPF_DUPLICATE` do submit final, que continua como rede de segurança contra corrida.
- **Pendente:** validar em device/simulador.

### Item 38 — PIN aceita data de nascimento — 2026-08-18
- **Onde:** [components/financial/PINInput.tsx](../components/financial/PINInput.tsx), [app/(auth)/cadastro/pin.tsx](../app/(auth)/cadastro/pin.tsx)
- **Correção:** novo prop `forbidden` no `PINInput`, verificado junto com o set `OBVIOUS` já existente. `pin.tsx` deriva da data de nascimento salva no draft (Etapa 1) as combinações `DDMMAA`, `MMDDAA` e `AAMMDD` e passa como `forbidden` na fase de criação. Reaproveita a mensagem de erro já existente do item 21.
- **Pendente:** validar em device/simulador.

### Item 24 — Link de Política de Privacidade não clicável (tela Dados pessoais) — 2026-08-18
- **Onde:** [app/(auth)/cadastro/dados.tsx](../app/(auth)/cadastro/dados.tsx), novo componente [components/shared/LegalDocModal.tsx](../components/shared/LegalDocModal.tsx)
- **Correção:** o subtítulo do `OnboardShell` só aceitava string simples (sem link). Passou a ser renderizado manualmente com "Política de Privacidade" como `Text` aninhado clicável (mesmo padrão do fix do item 23), abrindo um modal com o conteúdo já existente (`privacyPolicyBody`). O modal de `terms.tsx` foi extraído para o componente `LegalDocModal`, reaproveitado nas duas telas.
- **Pendente:** validar em device/simulador.

### Item 27 — Confirmação (retype) de e-mail e telefone — 2026-08-18
- **Onde:** [app/(auth)/cadastro/dados.tsx](../app/(auth)/cadastro/dados.tsx)
- **Correção:** dois campos novos ("Confirme seu e-mail", "Confirme seu celular") logo após os campos originais, com validação de igualdade bloqueando o avanço até bater. Campos de confirmação não são gravados no draft — só os valores originais seguem pro `auth-register`.
- **Pendente:** validar em device/simulador.

### Item 31 — Disclaimer de perguntas de segurança não deixa claro o peso da resposta — 2026-08-18
- **Onde:** `locales/pt-BR.json` (`auth.onboarding.seguranca.subtitle`)
- **Correção:** texto trocado por: *"Essas respostas funcionam como um segundo PIN, uma segunda senha, para confirmar suas transações. Escolha respostas sigilosas, evitando informações públicas ou que apareçam nas suas redes sociais, e trate-as com o mesmo cuidado que trataria uma senha."*

### Item 37 — Inconsistência de gênero ("o Alber" vs "a Alber") — 2026-08-18
- **Onde:** `locales/pt-BR.json`
- **Correção:** busca global por "Alber" precedido de o/ao/do/no encontrou 13 ocorrências (além das 4 já fotografadas no achado) — todas padronizadas para o feminino ("à/na/da Alber"). Nenhuma ocorrência remanescente confirmada via grep.

### Item 29 — Tom de "regra de sistema" em textos de apoio — 2026-08-18
- **Onde:** `locales/pt-BR.json` (`auth.onboarding.dados.nameError`, `auth.onboarding.handle.hint`)
- **Correção:** (a) erro do campo Nome → *"Informe nome e sobrenome como no seu RG/CNH."*; (b) apoio do campo @handle → *"Caracteres permitidos: letras, números e underscore."*

### Item 30 — Disclaimer genérico de criação de PIN — 2026-08-18
- **Onde:** `locales/pt-BR.json` (`auth.onboarding.pin.create.subtitle`)
- **Correção:** texto trocado por: *"Esse PIN funcionará como sua senha para confirmar suas transações na Alber. Escolha 6 dígitos que não sigam um padrão óbvio (datas especiais, sequência numérica ou repetição) e que você consiga memorizar."* Combinado com o fix do item 38, o bloqueio de padrão óbvio citado aqui agora cobre data de nascimento de fato.

### Item 34 — Erro factual: "INSTITUIÇÃO DE PAGAMENTOS" (plural) → singular — 2026-08-18
- **Onde:** `locales/pt-BR.json` (`pix.asaasDisclosure`, `pix.asaasModalBody`, `terms.privacyPolicyBody`, `terms.financialTransparencyBody`)
- **Correção:** as 4 ocorrências de "INSTITUIÇÃO DE PAGAMENTOS" (plural) corrigidas para "INSTITUIÇÃO DE PAGAMENTO" (singular), igualando ao site. Confirmado via grep que não sobrou nenhuma ocorrência do plural no arquivo.
- **Nota:** o selo a ser adicionado ao fluxo PJ (item 48) continua fora de escopo — não implementado aqui.

### Item 32 — Disclaimer de endereço ainda não suavizado (reconfirmação do item 7) — 2026-08-18
- **Onde:** `locales/pt-BR.json` (`auth.onboarding.endereco.subtitle`)
- **Correção:** texto trocado por: *"Precisamos desse endereço para confirmar sua identidade e cumprir exigências legais de abertura de sua conta."*
