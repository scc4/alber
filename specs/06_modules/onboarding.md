# Alber — Spec Módulo Onboarding
**Versão:** 1.0  
**Data:** 28/04/2026  
**Depende de:** 03_backend.md, 04_api_asaas.md, 05_security.md

---

## 1. Visão geral

O onboarding é o único ponto de entrada no Alber. Ao final do fluxo o usuário
tem conta ativa, subconta Asaas criada em background e está pronto para operar
— com exceção de Carregar e Descarregar (bloqueados até KYC aprovado).

**Regra central:** o usuário nunca vê a marca Asaas.

---

## 2. Fluxo completo

```
Splash → Boas-vindas → Etapa 1 (Dados pessoais) → Etapa 2 (Endereço)
→ Etapa 3 (@handle) → Etapa 4 (PIN) → Etapa 5 (Perguntas de segurança)
→ Etapa 6 (Chave Pix) → Aceite de termos → Criação de conta → Home
```

---

## 3. Telas

### 3.1 Splash
- Logo Alber centralizado em fundo preto
- Verifica sessão: válida → Home | sem sessão → Boas-vindas

### 3.2 Boas-vindas
- Logo + "USE ALBER"
- CTAs: "Fazer login" e "Cadastrar-se"

### 3.3 Etapa 1 — Dados pessoais
**Campos:** Nome completo, CPF (máscara + validação dígitos), Data nascimento
(mín 18 anos), Email, Telefone celular

**Validações em tempo real:**
- CPF duplicado → "Este CPF já possui conta. Recuperar acesso?"
- Nome mínimo 2 palavras
- Idade mínima 18 anos

### 3.4 Etapa 2 — Endereço
**Campos:** CEP (auto-preenche via ViaCEP), Endereço, Número, Complemento
(opcional), Bairro, Cidade, Estado

### 3.5 Etapa 3 — @handle
- Alfanumérico + underscore, mín 3, máx 20, sempre lowercase
- Verificação de disponibilidade em tempo real (debounce 500ms)
- Sugestões automáticas se handle indisponível
- Não pode começar/terminar com _ nem ter __ consecutivo

### 3.6 Etapa 4 — Criação de PIN
- Teclado scrambled par-a-par
- 6 dígitos obrigatórios
- Não aceita sequências óbvias (111111, 123456, 654321, 000000)
- Confirmação: digitar novamente — deve coincidir
- Screenshot bloqueada durante toda a etapa

### 3.7 Etapa 5 — Perguntas de segurança
- 4 perguntas obrigatórias, não puláveis
- Dropdown com lista pré-definida + campo de resposta livre
- Sem repetição de perguntas
- Respostas hasheadas com bcrypt localmente antes de enviar
- Campo de resposta visível (não oculto)

### 3.8 Etapa 6 — Chave Pix
**Tipos:** CPF (auto-preenchido, read-only) | Telefone | Email | Chave aleatória
- Explicar que esta é a conta para saques — deve ser no CPF do usuário

### 3.9 Aceite de termos
- [ ] Termos de Uso
- [ ] Política de Privacidade
- [ ] Declaração de maioridade e veracidade
- Links abrem em modal interno

### 3.10 Criação de conta — loading
```
"Criando sua conta..." → "Verificando seus dados..." → "Quase pronto..." → "Bem-vindo!"
```

**Background:**
1. Valida CPF na Receita Federal via Asaas
2. Cria subconta Asaas
3. Cria usuário no Supabase
4. Armazena hashes e chave Pix criptografada
5. Retorna JWT → armazena em SecureStore → Home

**Erros:** CPF inválido, duplicado, falha Asaas (retry 1x), timeout (>15s)

---

## 4. KYC pós-cadastro

### 4.1 Estado sem KYC
- Pode usar: Receber, Split, Spaces, Achar, Perfil, Atividade ✅
- Bloqueado: Carregar, Descarregar ❌
- Banner: "Complete sua verificação para carregar Albers"

### 4.2 Fluxo KYC — primeira tentativa de carregar
```
Tela explicativa → Escolha documento (RG/CNH)
→ Captura frente → Verso → Selfie
→ Revisão → Enviar
→ "Análise em até 24h — você será notificado"
```

### 4.3 Status KYC

| Status | Carregar/Descarregar |
|---|---|
| `pending` | ❌ CTA para verificar |
| `submitted` | ❌ "Em análise" |
| `approved` | ✅ Liberado |
| `rejected` | ❌ CTA reenviar |

### 4.4 Período de avaliação (60 dias)
- Banner: "Conta em período de avaliação — limite R$ 2.000"
- Exibe R$ utilizado vs limite
- Após aprovação: banner removido automaticamente

---

## 5. Login de retorno

```
Sessão válida + background < 5min → Home direto
Sessão válida + background > 5min → Tela de PIN
Sessão expirada → Login completo (CPF/@handle + PIN + segurança)
```

---

## 6. Critérios de aceitação

| ID | Critério |
|---|---|
| ON-01 | Subconta Asaas criada em background sem expor marca |
| ON-02 | CPF duplicado bloqueia e sugere recuperação |
| ON-03 | @handle verificado em tempo real com sugestões |
| ON-04 | PIN não aceita sequências óbvias, exige confirmação |
| ON-05 | 4 perguntas de segurança obrigatórias |
| ON-06 | Chave Pix cadastrada no onboarding |
| ON-07 | Home acessível imediatamente após cadastro |
| ON-08 | Carregar/Descarregar bloqueados até KYC |
| ON-09 | KYC disparado na primeira tentativa de carregar |
| ON-10 | Push ao aprovar ou reprovar KYC |
| ON-11 | Banner de avaliação durante 60 dias |
| ON-12 | Login de retorno exige PIN após 5min background |

---

## 7. Etapa opcional — Redes sociais (v1.1)

Inserida após Etapa 6 (Chave Pix), antes do Aceite de termos.

**Tela:**
```
┌─────────────────────────────────┐
│  Conecte suas redes sociais     │
│  (opcional)                     │
├─────────────────────────────────┤
│                                 │
│  Vincule suas redes e ganhe o   │
│  badge ✓ Perfil verificado      │
│  no seu @handle.                │
│                                 │
│  [𝕀] Instagram     [Conectar]   │
│  [T] TikTok        [Conectar]   │
│  [in] LinkedIn     [Conectar]   │
│  [𝕏] Twitter/X    [Conectar]   │
│                                 │
│  [Pular por agora]              │
│                                 │
└─────────────────────────────────┘
```

**Comportamento:**
- Cada rede abre fluxo OAuth nativo da plataforma
- Após conectar: botão muda para "Conectado ✓"
- Não é obrigatório conectar nenhuma
- "Pular por agora" avança sem vincular nenhuma rede
- Redes podem ser conectadas/desconectadas depois no Perfil

**Badge "Perfil verificado":**
- Concedido ao vincular pelo menos 1 rede social
- Exibido ao lado do @handle em todas as telas
- Badge removido se todas as redes forem desconectadas

**Dados armazenados:**
- Username da rede social (não senha, não token de acesso permanente)
- Exibido no perfil público do usuário
- OAuth token armazenado criptografado para refresh

---

## 8. Multi-idiomas (v1.1)

**MVP:** Português do Brasil apenas.

**Arquitetura preparada para Espanhol:**
- Todas as strings externalizadas em arquivos de tradução desde o início
- Nunca texto hardcoded no código
- Estrutura: `locales/pt-BR.json` e `locales/es.json` (vazio no MVP)
- Biblioteca: i18next + react-i18next
- Idioma segue o dispositivo automaticamente quando Espanhol for lançado

**Próxima versão:** Espanhol (es) — cobertura completa de todos os módulos.
