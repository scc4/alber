# Alber — Spec Módulo Achar
**Versão:** 1.0  
**Data:** 28/04/2026  
**Depende de:** 03_backend.md

---

## 1. Visão geral

Busca simples de usuários Alber por @handle. Escopo MVP restrito a pessoas.
Busca de Spaces e parceiros registrada em 07_open_decisions.md.

---

## 2. Tela principal

- Campo de busca "Buscar por @handle..."
- Seção RECENTES: últimas 10 buscas com resultado
- [Limpar histórico]

---

## 3. Busca ativa

- Debounce 300ms, mínimo 2 caracteres
- Busca por @handle parcial ou completo (sem o @), case-insensitive
- Resultado: avatar + @handle + nome completo

---

## 4. Estados vazios

**Sem resultado:** "Nenhum usuário encontrado com '@xyz'. Verifique o @handle."  
**Sem histórico:** "Busque por @handle para encontrar pessoas no Alber."

---

## 5. Perfil básico do usuário

Ao tocar no resultado:
- Avatar, nome, @handle, membro desde (mês/ano)
- Dados privados nunca exibidos (saldo, transações, Spaces)
- [Compartilhar @handle]

---

## 6. Histórico

- Últimas 10 buscas com resultado
- Armazenadas em SecureStore
- "Limpar histórico" remove tudo imediatamente
- Não sincronizado entre devices

---

## 7. Analytics obrigatórios

`achar_viewed`, `achar_search_typed`, `achar_result_tapped`,
`achar_no_results`, `achar_history_cleared`

---

## 8. Critérios de aceitação

| ID | Critério |
|---|---|
| AC-01 | Busca por @handle parcial ou completo |
| AC-02 | Autocomplete com debounce 300ms |
| AC-03 | Estado vazio contextual |
| AC-04 | Histórico das últimas 10 buscas |
| AC-05 | Perfil básico com apenas dados públicos |
| AC-06 | Limpar histórico funciona imediatamente |
