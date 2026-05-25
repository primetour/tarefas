# Portal de Solicitações — Plano de Testes E2E

**Versão atual**: v4.55.8
**Arquivo testado**: `js/portal/portalWizard.js` (+ `js/portal/portal.js` shell)
**Ambiente**: `https://primetour.github.io/tarefas/solicitar.html`

Este documento lista TODOS os cenários que precisam ser testados pra garantir 100% de paridade vs portal antigo + features adicionais do wizard.

Cada teste tem: **ID**, **descrição**, **passos**, **resultado esperado**, **status atual** (✅ passa / ❌ falha / ⚠️ parcial / 🟡 não testado).

---

## 1. Auth & Shell

| ID | Cenário | Status |
|----|---------|--------|
| AUTH-01 | Login email/senha sucesso → redireciona pro wizard | 🟡 |
| AUTH-02 | Login senha errada → mensagem "Senha incorreta" | 🟡 |
| AUTH-03 | Login email inexistente → "Usuário não encontrado" | 🟡 |
| AUTH-04 | Login email inválido → "E-mail inválido" | 🟡 |
| AUTH-05 | Login muitas tentativas → "Bloqueado temporariamente" | 🟡 |
| AUTH-06 | SSO Microsoft sucesso (auto-provision) | 🟡 |
| AUTH-07 | SSO domínio não autorizado → signOut + mensagem | 🟡 |
| AUTH-08 | SSO popup-closed-by-user → silencia | 🟡 |
| AUTH-09 | Logout → volta pra login screen | 🟡 |
| THEME-01 | Modo claro como padrão (sem localStorage) | ✅ v4.55.7 |
| THEME-02 | Toggle claro→escuro persiste em localStorage | ✅ |
| THEME-03 | Toggle escuro→claro persiste | ✅ |
| NAV-01 | Link "Ir para o sistema" navega pra index.html | 🟡 |

---

## 2. Newsletter Quick-Start Popup

| ID | Cenário | Status |
|----|---------|--------|
| NL-01 | Popup aparece após login se há type 'newsletter' | ✅ |
| NL-02 | Clicar "Sim, é newsletter" → wizard salta pro Step 2 com Marketing+Newsletter | ✅ v4.54.3 |
| NL-03 | Clicar "Não, é outro tipo" → fecha popup, wizard fica no Step 1 | ✅ |
| NL-04 | ESC fecha popup (= não) | 🟡 |
| NL-05 | Popup re-aparece após "Fazer nova solicitação" pós-sucesso | ❌ Gap |
| NL-06 | Click backdrop NÃO fecha (popup é bloqueante) | 🟡 |

---

## 3. Step 1: Setor + Tipo

| ID | Cenário | Status |
|----|---------|--------|
| S1-01 | Click "Próximo" sem setor → bloqueia + erro inline | ⚠️ bloqueia mas erro inline pode não aparecer |
| S1-02 | Selecionar setor → tipo aparece com types do setor | ✅ |
| S1-03 | Selecionar setor com 1 tipo → tipo auto-selecionado (skip auto) | ✅ |
| S1-04 | Selecionar setor com N tipos → manual select | ✅ |
| S1-05 | Setor sem types → fica vazio, "Próximo" bloqueia | 🟡 |
| S1-06 | Types globais (`!t.sector`) aparecem em todos setores | ❌ Gap (wizard só matcheia `t.sector===s OR requestingSectors.includes`) |
| S1-07 | Banner "Suas últimas solicitações" mostra (até 5 pending/em_andamento) | ✅ v4.55.4 |
| S1-08 | Banner vazio se user sem requests | ✅ |
| S1-09 | Click card recente → entra em edit mode | ✅ |
| S1-10 | Edit mode pré-popula sector + type + outros campos | ✅ |
| S1-11 | "Cancelar edição" → volta pro modo create | ✅ |
| S1-12 | Pill "📦 Lote pendente: N" aparece em TODOS os steps | ✅ v4.55.6 |
| S1-13 | Badge completo de lote (lista + remover) só no Step 1 | ✅ |
| S1-14 | Remove item do lote (×) → atualiza badge + progress | ✅ |

---

## 4. Step 2: Quando (Calendário + Data + Squad + OOC)

| ID | Cenário | Status |
|----|---------|--------|
| S2-01 | Calendário mês corrente renderiza com slots do tipo | ✅ v4.55.0 |
| S2-02 | Nav prev/next mês funciona | ✅ |
| S2-03 | Dias com slot mostram título do slot colorido | ✅ |
| S2-04 | Badge "+N" quando dia tem múltiplos slots | ✅ v4.55.2 |
| S2-05 | Tooltip mostra todos os slots do dia (separados por ·) | ✅ |
| S2-06 | Dia passado: opacidade reduzida + cursor not-allowed | ✅ |
| S2-07 | Dia hoje: border dashed + cor gold | ✅ |
| S2-08 | Dia selecionado: border gold + bg suave | ✅ |
| S2-09 | Click cell vazio futuro → desiredDate setada + OOC=true | ✅ |
| S2-10 | Click cell com slot → desiredDate setada + OOC=false + pre-fill requestingArea | ✅ |
| S2-11 | Slot título NÃO vaza pra coluna vizinha (overflow:hidden) | ✅ v4.55.7 |
| S2-12 | Click cell passado → não faz nada (handler não atrelado) | ✅ |
| S2-13 | Date input manual aceita data futura | ✅ |
| S2-14 | Date input bloqueia data passada (min=hoje) | ✅ |
| S2-15 | Date input passada → erro inline + (gap: alert nativo) | ⚠️ |
| S2-16 | Squad select carrega "Carregando squads…" → após async troca | ✅ |
| S2-17 | Squad sem squads no setor → "— Sem squad específico —" | ✅ |
| S2-18 | OOC checkbox manual toggle ativa/desativa | ✅ |
| S2-19 | "Próximo" sem data preenchida → erro inline | ✅ |
| S2-20 | Render de TASKS reais no calendário (cor por status) | ❌ Gap |
| S2-21 | Render de OUTRAS REQUESTS do user (pending/converted/rejected colors) | ❌ Gap |
| S2-22 | Render do BATCH local no calendar ("✦ N a enviar") | ❌ Gap |
| S2-23 | Click em slot já ocupado → abre PREVIEW CARD | ❌ Gap |
| S2-24 | Granularidade WEEK | ❌ Gap |
| S2-25 | Granularidade DAY | ❌ Gap |
| S2-26 | Botão FULLSCREEN no calendário | ❌ Gap |
| S2-27 | Type selector dentro do calendário | ❌ Gap |
| S2-28 | Botão "Hoje" no nav | ❌ Gap |

---

## 5. Step 3: Detalhes (Variação + Título + Descrição + Link)

| ID | Cenário | Status |
|----|---------|--------|
| S3-01 | Variação dropdown filtrado pelo tipo escolhido | ✅ |
| S3-02 | 1 variação → auto-selecionada | ✅ |
| S3-03 | SLA hint mostra "⏱ SLA de produção: N dias" | ✅ (com fix v4.54.5 do slaDays) |
| S3-04 | Mudar variação → re-checa auto urgência | ✅ |
| S3-05 | Mudar variação → AUTO-FILL due date pelo SLA | ❌ Gap |
| S3-06 | Título vazio → erro inline | ✅ |
| S3-07 | Descrição vazia → erro inline | ✅ |
| S3-08 | ContentLink vazio → OK (opcional) | ✅ |
| S3-09 | ContentLink sem http/https → alert nativo (gap: deveria ser inline) | ⚠️ |
| S3-10 | ContentLink válido → passa | ✅ |
| S3-11 | Tipo SEM variações → variação field hidden | ✅ |

---

## 6. Step 4: Sinalizações + Revisão

| ID | Cenário | Status |
|----|---------|--------|
| S4-01 | Toggle urgência manual ON → border vermelho | ✅ |
| S4-02 | Urgência auto-locked se prazo < 24h → disabled + badge "🔒 automático" | ✅ v4.54.4 |
| S4-03 | Urgência auto-locked se bizDays < SLA → disabled + reason | ✅ |
| S4-04 | Tentar destogglar lock → permanece true (defesa) | ✅ |
| S4-05 | Toggle parceria → state persiste | ✅ |
| S4-06 | Summary card mostra todos campos preenchidos | ✅ |
| S4-07 | Summary pula campos vazios (Squad, Link, OOC se false) | ✅ |
| S4-08 | Banner educativo URGENCY (texto longo "Atenção...") | ❌ Gap (só descrição curta) |
| S4-09 | Banner educativo OOC (texto longo spam/server) | ❌ Gap |

---

## 7. Submit

| ID | Cenário | Status |
|----|---------|--------|
| SUB-01 | Submit single → addDoc + clearDraft + success view | ✅ |
| SUB-02 | Submit com batchQueue > 0 → loop addDoc, success com contador "N solicitações enviadas" | ✅ v4.55.5 |
| SUB-03 | Submit em edit mode → updateDoc, status preservado, flags requesterEdit | ✅ v4.55.3 |
| SUB-04 | Double-click no Enviar → 2º bloqueado por _state.submitting | ✅ |
| SUB-05 | Erro Firestore no submit → alert + libera flag + footer re-render | ✅ |
| SUB-06 | Submit com autoAccept=true → CRIA TASK + status='converted' + taskId | ✅ v4.55.8 |
| SUB-07 | Submit → notifyAdmins (in-app pros admins) | ✅ v4.55.8 |
| SUB-08 | Submit → notifyTeam (email Cloud Function) | ✅ v4.54.4 |
| SUB-09 | Submit em edit + request tem taskId → SYNC task linked com retry | ✅ v4.55.8 |
| SUB-10 | Sync task falha após 3 retries → toast vermelho de erro | ✅ v4.55.8 |
| SUB-11 | Botão "Enviar + Outra similar" → mantém setor+tipo, vai pro Step 2 | ✅ |
| SUB-12 | Botão "+ Adicionar ao lote" → enfileira, reinicia Step 2 com setor+tipo | ✅ |
| SUB-13 | Botão "Salvar alterações" (edit mode) ao invés de "Enviar" | ✅ |
| SUB-14 | notifyTeam consolidado pra batch (1 email "N em conjunto") | ❌ Gap (envia N emails) |
| SUB-15 | batchId/batchIndex/batchTotal nos docs do batch | ❌ Gap |
| SUB-16 | Item do batch falha → catch + log + continua outros | ✅ |

---

## 8. Edit Mode

| ID | Cenário | Status |
|----|---------|--------|
| EDIT-01 | Click recent → entra edit, todos campos pré-populados | ✅ |
| EDIT-02 | Cancel edit → reseta data + sai do edit mode | ✅ |
| EDIT-03 | Salvar edit → updateDoc com requesterEditFlag/requesterEditedAt | ✅ |
| EDIT-04 | Edit de request com taskId → sync task linked | ✅ v4.55.8 |
| EDIT-05 | Urgência monotônica: era urgent → não pode desmarcar | ❌ Gap |
| EDIT-06 | Mudar data viola SLA em edit → auto-força urgência | ❌ Gap |
| EDIT-07 | Edit history append (campos alterados) | ❌ Gap (só seta flag) |
| EDIT-08 | Toast sucesso/erro pós-edit | ⚠️ só erro em sync, sucesso usa screen genérica |

---

## 9. Calendário (Funcionalidades Avançadas)

| ID | Cenário | Status |
|----|---------|--------|
| CAL-01 | Render slots não-preenchidos: `◌ Title` dashed border | ❌ Gap (mostra sólido) |
| CAL-02 | Render slots preenchidos: `✓ Title` solid border verde | ❌ Gap |
| CAL-03 | Render tasks soltos quando dia sem slots: `●` dourado | ❌ Gap |
| CAL-04 | Slot fill priorização: request > batch > task | ❌ Gap |
| CAL-05 | Click slot vazio → pre-fill RICO (título + área + var + núcleo) | ❌ Gap (só date + OOC + area) |
| CAL-06 | Click slot preenchido → preview card | ❌ Gap |
| CAL-07 | Click task pill → preview card | ❌ Gap |
| CAL-08 | Click request pill → preview card + botão "Editar" | ❌ Gap |
| CAL-09 | Tooltips ricos: sector, typeName, requestingArea, ✓/◌ | ❌ Gap (só title) |

---

## 10. Preview Card (Modal)

| ID | Cenário | Status |
|----|---------|--------|
| PV-01 | Modal centralizado abre ao clicar slot/task/request | ❌ Gap (não existe) |
| PV-02 | Status badge: pending/converted/rejected/done... (8 estados) | ❌ Gap |
| PV-03 | Badges adicionais: 🔴 Urgente, ⚠ Fora do calendário | ❌ Gap |
| PV-04 | Detail grid: data, tipo, área, solicitante | ❌ Gap |
| PV-05 | Description scroll box (max 300 chars + …) | ❌ Gap |
| PV-06 | Edit history block (últimos 3 edits) | ❌ Gap |
| PV-07 | Botão "✏ Editar" só se isOwnRequest && status pending|converted | ❌ Gap |
| PV-08 | Close: X / Fechar / backdrop / ESC | ❌ Gap |

---

## 11. Modal Fullscreen Form (Slot Click)

| ID | Cenário | Status |
|----|---------|--------|
| FS-01 | Abre modal quando user clica slot no calendário fullscreen | ❌ Gap (calendário fullscreen nem existe) |
| FS-02 | Pré-fills mostradas como cards read-only | ❌ Gap |
| FS-03 | Editáveis: título, descrição, variação (com SLA dynamic), urgência | ❌ Gap |
| FS-04 | Banner "📝 Aceite automático" se autoAccept | ❌ Gap |
| FS-05 | Botões "Enviar" + "+ Várias" (add ao batch) | ❌ Gap |
| FS-06 | Variation change re-checa urgência (lock/unlock) | ❌ Gap |
| FS-07 | Close: X / backdrop / ESC | ❌ Gap |
| FS-08 | Focus auto no título | ❌ Gap |

---

## 12. Auto-save & Restore

| ID | Cenário | Status |
|----|---------|--------|
| AS-01 | Digitar em campo → draft escrito (localStorage) | ✅ |
| AS-02 | Recarregar página → restore se < 7d | ✅ |
| AS-03 | > 7d → draft removido, começa do zero | ✅ |
| AS-04 | Clear draft após submit sucesso | ✅ |
| AS-05 | "Salvar e sair" → alert confirma | ✅ |
| AS-06 | Draft preserva editMode/batchQueue/calDate? | 🟡 testar |

---

## 13. Atalhos

| ID | Cenário | Status |
|----|---------|--------|
| KEY-01 | Enter em input → avança step | ✅ |
| KEY-02 | Enter em textarea NÃO avança | ✅ |
| KEY-03 | Esc volta step (Step 2-4) | ✅ |
| KEY-04 | Esc no Step 1 → não faz nada | ✅ |
| KEY-05 | Atalhos removidos no destroy (sem leak) | ✅ |
| KEY-06 | Enter no Step 4 → submete | ✅ |

---

## 14. Validação Inline

| ID | Cenário | Status |
|----|---------|--------|
| VAL-01 | Erros aparecem inline em campo específico | ⚠️ alguns só silenciam |
| VAL-02 | Scroll automático pro primeiro erro | ❌ Gap |
| VAL-03 | Classe `.has-error` no campo | ❌ Gap (usa só err-* divs) |
| VAL-04 | Url do contentLink: validação alert nativo | ⚠️ deveria ser inline |
| VAL-05 | Data passada: validação alert nativo | ❌ Gap |
| VAL-06 | Validação por step bloqueia avanço se inválido | ✅ |

---

## 15. Cenários Adversários

| ID | Cenário | Status |
|----|---------|--------|
| ADV-01 | Submit com rede offline → catch + alert | ✅ |
| ADV-02 | Type deletado entre seleção e submit → erro | 🟡 |
| ADV-03 | Variação deletada → erro | 🟡 |
| ADV-04 | BatchQueue com tipo agora inexistente → submit falha por item | 🟡 |
| ADV-05 | Modal preview history XSS → escape feito | ❌ Gap (modal nem existe) |
| ADV-06 | typeColor injection (`style`) → sanitização regex | ❌ Gap |
| ADV-07 | Anonymous (sem login) → wizard nem inicializa | ✅ |
| ADV-08 | Submit sem permissão de Firestore → catch + erro | 🟡 |
| ADV-09 | newsletterPrompt depois de logout/login → re-aparece | 🟡 |

---

## 16. Mobile (≤ 680px)

| ID | Cenário | Status |
|----|---------|--------|
| MOB-01 | Progress bar 4 dots cabe sem quebra | 🟡 |
| MOB-02 | Botões footer não vazam | 🟡 |
| MOB-03 | Calendário grid 7-col não corta | 🟡 |
| MOB-04 | Modais responsivos | 🟡 (sem modais ainda) |
| MOB-05 | Textarea altura adequada | 🟡 |

---

## RESUMO POR STATUS

| Status | Quantidade |
|--------|------------|
| ✅ Passa (testado/implementado) | ~80 |
| ⚠️ Parcial | ~12 |
| ❌ Gap (precisa implementar) | ~40 |
| 🟡 Não testado | ~28 |
| **TOTAL** | **~160 cenários** |

**Cobertura atual estimada: 65-70%**. Pra 100% precisa:
- Implementar todos os ❌ (mapeados na auditoria do agent)
- Executar todos 🟡 (rodar bateria E2E completa)

---

## Próximos passos pra 100%

### Releases pendentes

| Release | Conteúdo |
|---------|----------|
| **v4.56.0** | Render tasks/requests/batch no calendar + preview card + modal fullscreen + pre-fill rico ao clicar slot |
| **v4.56.1** | Edit completo (urgência monotônica + auto-recheck por data + edit history) |
| **v4.57.0** | Granularidades calendário (week/day/fullscreen toggle/type selector/botão Hoje) |
| **v4.57.1** | Banners educativos + tooltips + info-tips + validação inline rica + sanitização typeColor + auto-fill due date |
| **v4.57.2** | notifyTeam consolidado batch + batchId nos docs + edit history append |
| **v4.58.0** | Bateria E2E automatizada (script JS que roda todos cenários acima) |

### Execução da bateria E2E (v4.58.0)

Vai ser um script `tests/portal-wizard-e2e.js` que:
1. Logga via SSO test account
2. Limpa estado (localStorage + drafts)
3. Itera cada cenário acima
4. Reporta pass/fail em console + tabela markdown
5. Limpa docs de teste do Firestore no final

---

**Última atualização**: v4.55.8 — 2026-05-24
