# Alber — Spec Módulo Perfil
**Versão:** 1.0  
**Data:** 28/04/2026  
**Depende de:** 03_backend.md, 05_security.md

---

## 1. Visão geral

Centraliza dados do usuário, configurações de segurança, chave Pix,
notificações e status do KYC.

---

## 2. Tela principal

```
[avatar]  {Nome completo}
          @{handle}
          Membro desde {mês/ano}

CONTA
  Dados cadastrais          >
  @handle                   >
  PIN                       >
  Chave Pix                 >
  Perguntas de segurança    >

VERIFICAÇÃO
  KYC: {status}             >

PREFERÊNCIAS
  Notificações              >

SESSÃO
  [Sair da conta]
```

---

## 3. Dados cadastrais (somente leitura)

Todos os campos exibidos mascarados conforme 05_security.md seção 6.3:
- Nome, CPF (`***.***.*XX-XX`), Data nascimento, Email, Telefone, Endereço

---

## 4. Trocar @handle

- Handle atual exibido
- Campo para novo handle com verificação em tempo real (debounce 500ms)
- Aviso: troca permitida uma vez a cada 30 dias
- Se em cooldown: exibe data disponível + botão desabilitado

**Fluxo:**
```
Digitar novo handle → verificar disponibilidade
→ PIN (scrambled) → confirmação de segurança
→ Handle trocado → antigo em quarentena 30 dias → log de auditoria
```

---

## 5. Trocar PIN

**Fluxo:**
```
1. Digitar PIN atual → validar no BFF
2. Digitar novo PIN (teclado scrambled)
3. Confirmar novo PIN (deve coincidir)
4. Confirmação de segurança (pergunta sorteada)
5. Código SMS ou email (usuário escolhe)
6. PIN atualizado → todas as outras sessões invalidadas → log
```

**Regras do novo PIN:**
- 6 dígitos, não pode ser igual ao atual
- Não aceita sequências óbvias

---

## 6. Chave Pix

- Exibe chave atual mascarada
- [Trocar chave Pix] → exige PIN + confirmação de segurança → log de auditoria
- Mesma interface de cadastro do onboarding etapa 6

---

## 7. Perguntas de segurança

- Exibe "Pergunta 1: ✓ Cadastrada" × 4 (respostas nunca exibidas)
- [Atualizar perguntas] → exige PIN + código SMS/email
- Redefine todas as 4 — fluxo idêntico ao onboarding etapa 5

---

## 8. Status KYC

| Status | Exibição |
|---|---|
| `pending` | "Pendente" + [Verificar agora] |
| `submitted` | "Em análise ⏳ — até 24h" |
| `approved` | "Verificado ✓" |
| `rejected` | "Reprovado ✗" + motivo + [Reenviar documentos] |

---

## 9. Notificações

**Configuráveis:**
- Transações: Recebimentos, Envios, Carregamentos, Saques
- Splits: Novo participante, Link expirado, Split fechado
- Spaces: Mensagens, Eventos, Solicitações (dono)
- Conta: KYC

**Não desabilitáveis:** notificações de segurança (login novo device,
troca de PIN, tentativas bloqueadas)

---

## 10. Logout

```
[Sair da conta] → confirmação → BFF invalida token
→ SecureStore limpo → tela de boas-vindas
```

---

## 10.1 Conta e Privacidade — Excluir minha conta

Exigido pelas políticas da Google Play/App Store: todo app que permite criar
conta precisa permitir iniciar a exclusão dentro do próprio app.

**Modelo: soft delete.** A linha em `users` é preservada — dados financeiros
(`transactions`, `splits`, etc.) são retidos por obrigação legal e não têm
`ON DELETE CASCADE` na maioria das tabelas relacionadas. Ao excluir:
`name`/`handle`/`email` são sobrescritos com um placeholder anônimo e
`deleted_at` é marcado. `cpf` (já armazenado como hash) e dados financeiros
não são tocados. `auth-login` passa a rejeitar login dessa conta
(`ACCOUNT_DELETED`). O usuário tem a impressão de exclusão completa (perde
acesso, some da busca/extrato/lounge/split de terceiros), mas nada é
fisicamente apagado.

**Pré-condições (bloqueiam a exclusão se não satisfeitas):**
- Saldo na subconta Asaas deve estar zerado (senão: CTA para Descarregar).
- Não pode ser dono de Split aberto (`status = 'open'`).
- Não pode ser dono de Lounge ativo (`status = 'active'`).
- Não pode ter saldo bloqueado (`blocked_amount > 0`) em Split ainda aberto.

**Fluxo:** Perfil → Conta e Privacidade → Excluir minha conta →
aviso explicativo → PIN → pergunta de segurança → código SMS → confirmação
final (digitar "EXCLUIR") → sucesso → logout automático → tela de boas-vindas.
Mesmo padrão de autenticação forte usado em troca de PIN (§5).

**Backend:** `conta-excluir` — `POST {action:'status'}` (só JWT, retorna
elegibilidade para a tela decidir se mostra o bloqueio antes do usuário
passar por PIN/segurança/SMS à toa) e `POST {action:'confirm', pin_hash,
security_answer_hash, sms_code}` (revalida as mesmas pré-condições no
servidor antes de efetivar).

**Fora de escopo desta versão:** encerramento da subconta Asaas (não há
endpoint disponível) e reabertura/reativação de conta excluída — usuário
precisa contatar o suporte para recadastrar com o mesmo CPF.

---

## 11. Analytics obrigatórios

`perfil_viewed`, `perfil_handle_change_started`, `perfil_handle_changed`,
`perfil_pin_change_started`, `perfil_pin_changed`, `perfil_pix_key_changed`,
`perfil_kyc_started`, `perfil_notifications_changed`, `perfil_logout`,
`perfil_account_delete_started`, `perfil_account_deleted`

---

## 12. Critérios de aceitação

| ID | Critério |
|---|---|
| PR-01 | Dados cadastrais mascarados e somente leitura |
| PR-02 | Troca de @handle exige PIN + segurança + cooldown |
| PR-03 | Handle antigo em quarentena 30 dias |
| PR-04 | Troca de PIN invalida todas as outras sessões |
| PR-05 | Perguntas de segurança não exibem respostas |
| PR-06 | Atualização de perguntas exige PIN + código |
| PR-07 | Status KYC com ações contextuais |
| PR-08 | Notificações de segurança não desabilitáveis |
| PR-09 | Logout limpa SecureStore e invalida token |
| PR-10 | Chave Pix exige autenticação dupla para trocar |
| PR-11 | Excluir conta exige PIN + segurança + SMS + confirmação explícita |
| PR-12 | Exclusão é bloqueada com saldo positivo ou splits/lounges ativos |
| PR-13 | Conta excluída não consegue fazer login novamente |
| PR-14 | Dados financeiros são retidos após a exclusão (soft delete) |
