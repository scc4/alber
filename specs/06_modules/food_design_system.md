# Alber Food — design system

Decisão local (extrapola os specs; o módulo Food ainda não tem spec de produto próprio).

Fonte visual: design system publicado "Alber Food" (derivado de usealber.com e de `tokens/colors.ts`).
Implementação: `tokens/food.ts` e `components/food/`.

## Regras

- Monocromático. O único acento é o inverso do fundo (`accent`/`onAccent`). Sem matiz de marca.
- Cor de estado (`success`, `warning`, `error`) só em status de pedido e pagamento, sempre com palavra.
- Bordas finas (`line`, 0.5px), sem sombra e sem gradiente.
- Temas `dark` (padrão, igual ao app) e `light`. `FoodThemeProvider` força um; sem ele segue o sistema.
- Valores em Albers: `formatAlbers` (duas casas, vírgula, sem símbolo de moeda). Nunca "R$".
- Textos via i18next, chaves em `food.*` de `locales/pt-BR.json`.

## Componentes

`FoodButton`, `FoodInput`, `FoodChip`, `FoodBadge`, `FoodSkeleton`, `FoodEmptyState`, `MenuItem`,
`OrderLine`, `BillTotal`, `SplitRow`, `PaymentSheet`. Importar de `components/food`.

Estados: `MenuItem` (default/loading/unavailable), `BillTotal` (default/loading/error),
`FoodButton` (default/loading/disabled). Vazio e erro de lista usam `FoodEmptyState`.

## Pendências

- Fonte Geist (a do site) não está instalada; os componentes usam Inter até adicionar `expo-font` + Geist.
- `PaymentSheet` não faz a autenticação por PIN: quem chama deve passar por `PINInput` antes de `onConfirm`.
- O selo Asaas é branco; no `PaymentSheet` ele fica sobre um bloco escuro, também no tema claro.
- Sem telas do módulo Food ainda; nenhuma tela existente foi alterada.
