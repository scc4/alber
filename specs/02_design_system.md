# Alber — Spec Design System
**Versão:** 1.0  
**Data:** 28/04/2026  
**Depende de:** 00_architecture.md, 01_frontend.md  
**Âncora visual:** Home VF 27 Abril

---

## 1. Princípios

- **Minimalismo funcional:** menos elementos, maior intenção visual
- **Black/white premium:** preto e branco como linguagem dominante
- **Shell fixa + skin variável:** estrutura permanente, atmosfera customizável
- **Componentização obrigatória:** nenhuma tela nasce como arte isolada
- **Customização máxima com proteção da UX:** Spaces customizam atmosfera, nunca quebram função

---

## 2. Tokens de cor

```typescript
// tokens/colors.ts

export const colors = {
  black: {
    100: '#000000',   // base dark principal
    90:  '#1A1A1A',   // bordas dark
    80:  '#333333',
    70:  '#444444',
  },
  white: {
    100: '#FFFFFF',   // contraste primário
    95:  '#F8F8F8',   // superfícies claras
    90:  '#F5F5F5',   // placeholders e apoios
  },
  gray: {
    500: '#666666',   // texto secundário
    400: '#999999',   // metadata e ajuda
  },
  warning: {
    500: '#F59E0B',   // warnings e alertas
    600: '#FF9500',   // variante de alerta
  },
  state: {
    error:   '#EF4444',
    success: '#22C55E',
    blocked: '#666666',
  }
} as const
```

**Regras de uso:**
- Acentos coloridos apenas em estado funcional (warning, error, success)
- Cores de Alber Spaces nunca sobrescrevem tokens de estado
- Contraste mínimo WCAG AA obrigatório em toda superfície

---

## 3. Tokens de tipografia

```typescript
// tokens/typography.ts

export const typography = {
  fontFamily: {
    primary: 'Inter',
    display: 'Inter',
  },
  size: {
    balance:   { fontSize: 48, lineHeight: 56 },
    h1:        { fontSize: 22, lineHeight: 28 },
    h2:        { fontSize: 18, lineHeight: 24 },
    body:      { fontSize: 16, lineHeight: 22 },
    bodySmall: { fontSize: 15, lineHeight: 20 },
    label:     { fontSize: 14, lineHeight: 18 },
    caption:   { fontSize: 13, lineHeight: 16 },
    micro:     { fontSize: 11, lineHeight: 14 },
  },
  weight: {
    regular: '400',
    medium:  '500',
    bold:    '700',
  }
} as const
```

---

## 4. Tokens de espaçamento e layout

```typescript
// tokens/spacing.ts

export const spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 40,

  screenHorizontal: 32,
  sectionGap:       40,
  itemGap:          24,
  cardPadding:      20,

  buttonHeight:     50,
  rowHeight:        72,
  inputHeight:      52,
  bottomNavHeight:  84,
  headerHeight:     56,

  radius: {
    sm:   6,
    md:   12,
    lg:   16,
    xl:   20,
    full: 9999,
  }
} as const

export const layout = {
  referenceWidth:  390,
  referenceHeight: 844,
  gridColumns:     2,
  gridGap:         12,
} as const
```

---

## 5. Shell fixa + skin variável

### 5.1 O que é fixo — NUNCA customizável por Space

| Elemento | Motivo |
|---|---|
| Header estrutural | Navegação e identidade |
| Bloco de saldo | Informação crítica |
| Comandos principais (Receber, Carregar, Split) | Operação core |
| Bottom nav | Navegação persistente |
| Estados de erro e alerta | Segurança e feedback |
| Contraste mínimo WCAG AA | Acessibilidade |
| Tipografia funcional | Legibilidade |

### 5.2 O que é variável — customizável por Space

| Elemento | Opções |
|---|---|
| Arte de fundo da Home | Imagem ou gradiente definido pelo Space |
| Hero visual | Imagem ou marca do Space |
| Cor de acento do Space | Dentro de range seguro de contraste |
| Atmosfera geral | Dark / light / branded |

### 5.3 Regra de override automático

Quando a skin de um Space comprometer contraste ou legibilidade, o sistema
aplica overlay automático sobre o conteúdo fixo. O app decide — não o dono do Space.

---

## 6. Biblioteca de componentes

### 6.1 Header

| Variante | Uso |
|---|---|
| `home` | Logo Alber + saudação + saldo |
| `title` | Título da tela + back opcional |
| `search` | Campo de busca integrado |
| `actionable` | Título + ação direita (ex: filtro) |

**Estados:** default, scrolled (comprimido), club-themed (skin do Space)

---

### 6.2 BalanceBlock

Exibe saldo do usuário na Home.

```
"Você tem"
[120] Albers
+ Carregar mais
```

**Estados:**
- `default` — saldo visível
- `loading` — skeleton animado
- `error` — "Não foi possível carregar" + retry
- `zero` — saldo zerado com CTA de carregar
- `policy-blocked` — saldo bloqueado por política
- `hidden` — "•••• Albers"

---

### 6.3 PINInput

Componente crítico de segurança.

**Especificação:**
- 6 posições numéricas
- Teclado scrambled par-a-par: cada tecla exibe dois dígitos possíveis
- Pares fixos: `0|2`, `4|6`, `5|7`, `8|9`, `1|3`
- Posição dos pares **randomizada a cada render**
- Tecla de backspace sempre presente
- Screenshot bloqueada enquanto componente ativo
- Valor nunca armazenado em estado legível — apenas hash progressivo

**Estados:** default, active, error, complete, blocked

---

### 6.4 SecurityConfirmation

**Especificação:**
- Sistema sorteia 1 das 4 perguntas cadastradas
- Exibe 4 opções: 1 resposta real mascarada + 3 falsas geradas
- Máximo 3 tentativas → bloqueio temporário de 15 minutos
- Posição da resposta correta randomizada a cada render

**Estados:** default, selected, error, blocked

---

### 6.5 ActionRow

Row de ação na Home: Receber, Carregar, Split.

**Estados:** default, pressed, disabled, blocked-by-policy

---

### 6.6 PrimaryButton

```typescript
interface PrimaryButtonProps {
  label: string
  onPress: () => void
  variant: 'primary' | 'destructive' | 'confirm'
  state: 'default' | 'loading' | 'disabled' | 'success'
}
```

- Altura: 50px
- Radius: 12px
- Loading: spinner inline substitui label
- Success: checkmark animado antes de navegar

---

### 6.7 AlertCard

| Variante | Cor de acento | Uso |
|---|---|---|
| `warning` | #F59E0B | Atenção não crítica |
| `error` | #EF4444 | Erro ou bloqueio |
| `info` | #999999 | Informação contextual |

---

### 6.8 QRCodeDisplay

**Especificação:**
- Exibe valor, countdown 30 minutos e QR code
- Countdown visual em tempo real
- Expirado → estado de expiração com botão "Gerar novo"
- Botão de compartilhar código Pix como texto alternativo

---

### 6.9 SplitCard

| Variante | Uso |
|---|---|
| `active-fixed` | Split fixo ativo |
| `active-variable` | Split variável ativo com valor bloqueado |
| `expired` | Split encerrado |
| `pending` | Aguardando participantes |

---

### 6.10 ParticipantRow

**Estados:** pending, accepted, declined, insufficient-balance, excluded

---

### 6.11 SpaceCard

**Variantes:** public, private, member, owner

---

### 6.12 EventCard

**Exibe:** imagem, nome, data, tipo (gratuito/pago), valor em R$ + Albers, status

---

### 6.13 EmptyState

```typescript
interface EmptyStateProps {
  context: 'search' | 'splits' | 'spaces' | 'atividade' | 'notifications'
  cta?: { label: string; onPress: () => void }
}
```

---

### 6.14 UserChip

```
[avatar]  Nome  @handle
```

**Estados:** default, selected, removed, unavailable

---

## 7. Padrões de iconografia

- Traço fino (stroke), sem preenchimento
- Grid consistente: 24×24px
- Semanticamente legível em 1 segundo

**Ícones obrigatórios no MVP:**
Receber, Carregar, Split, Perfil, Achar, Spaces, Atividade, Alerta,
Segurança, @handle, Voltar, Fechar, Editar, Copiar, Compartilhar, QR code,
Check, Erro, Loading

---

## 8. Estados de loading

| Padrão | Quando usar |
|---|---|
| Skeleton | Blocos de conteúdo (cards, listas, saldo) |
| Spinner inline | Botões em ação |
| Overlay + spinner | Operações de tela inteira |

---

## 9. Acessibilidade mínima

- Área de toque mínima: 44×44px
- Contraste mínimo texto/fundo: 4.5:1 (WCAG AA)
- Labels de acessibilidade em todos os ícones
- Suporte a Dynamic Type (iOS) e font scaling (Android)

---

## 10. Animações e feedback

- Transições de tela: slide horizontal padrão Expo Router
- Feedback de toque: opacidade 0.7 em 100ms
- Loading de botão: spinner substitui label com fade 150ms
- Success: checkmark com scale 0→1 em 200ms
- Erros: shake horizontal 3× em 300ms
- Skeleton: pulse de opacidade 0.4→0.8 em loop 1s

---

## 11. Content design — glossário oficial

| Termo | Uso correto | Nunca usar |
|---|---|---|
| Albers | Moeda do sistema (plural) | "coins", "créditos", "pontos" |
| Alber | App e marca | "carteira", "banco" |
| Carregar | Adicionar saldo | "depositar", "recarregar" |
| Descarregar | Sacar saldo | "sacar", "retirar" |
| Receber | Receber Albers de outro usuário | "receber pagamento" |
| Split | Divisão de despesas em grupo | "racha", "dividir" |
| Alber Space | Comunidade/clube | "clube", "grupo", "comunidade" |
| Atividade | Histórico de transações | "extrato", "histórico" |
| @handle | Identificador único do usuário | "username", "apelido" |

---

## 12. Regras para IA builders e devs

- MUST converter todos os tokens em constantes TypeScript antes de criar telas
- MUST usar `spacing.screenHorizontal` como margem lateral — nunca hardcode
- MUST implementar os 5 estados em todo componente de dados
- MUST usar `PINInput` e `SecurityConfirmation` como componentes — nunca recriar inline
- MUST NOT usar cores fora dos tokens definidos
- MUST NOT permitir customização de Space sobre elementos da shell fixa
- SHOULD usar skeleton no formato e tamanho do conteúdo real
