# Ambiente de Staging — `gestor-btg-lp-builder-lab`

> Doc destinada à equipe técnica de TI/Dev.
> Criada: 2026-05-07 · Status: ativo · Owner: Tiago Prado

## Resumo executivo

Em **2026-05-06** foi criado um **ambiente de staging privado** do Gestor PRIMETOUR no GitHub, sob o repositório `primetour/gestor-btg-lp-builder-lab`. É a primeira vez que o sistema tem um ambiente isolado de **lab/POC** — antes, qualquer mudança ia direto pra produção via `primetour/tarefas`.

O lab foi criado pelo **Tiago Prado** (`tiago.prado@primetour.com.br`) como base higienizada do gestor para validar duas iniciativas:

1. **Migração do projeto BTG Pactual** pro ecossistema do Gestor PRIMETOUR
2. **Evolução do gerador de Landing Pages em blocos** (LP Builder)

---

## Identificação do repo

| Campo | Valor |
|---|---|
| **Nome** | `primetour/gestor-btg-lp-builder-lab` |
| **URL** | https://github.com/primetour/gestor-btg-lp-builder-lab |
| **Visibilidade** | 🔒 Privado |
| **Default branch** | `main` |
| **Criado em** | 2026-05-06 20:25 UTC |
| **Owner técnico** | Tiago Prado |
| **Único commit** (até agora) | `be06110` — `chore: create sanitized lab baseline` |
| **Total de arquivos** | 266 (cópia higienizada do gestor) |
| **GitHub Pages** | ❌ Desabilitado (não vai a público) |
| **Issues** | ✅ Habilitado |
| **Merge strategy** | só squash (sem merge commit) |

---

## Guardrails (regras formais do `LAB_SETUP.md`)

> ⚠ Estas regras são **obrigatórias**. Quebrar qualquer uma delas derruba o isolamento e arrisca a produção.

1. **NÃO usar credenciais de produção** neste repositório
2. **NÃO habilitar workflows agendados** até existir Firebase/R2/Cloudflare de staging dedicado
3. **NÃO gravar em coleções de produção** durante a prova de conceito
4. **Manter o projeto BTG original e o Gestor original sem alterações** durante a fase de laboratório

---

## Diferenças críticas vs produção

| Item | `primetour/tarefas` (PROD) | `gestor-btg-lp-builder-lab` (LAB) |
|---|---|---|
| Visibilidade | Público | **Privado** |
| `.firebaserc` (default project) | `gestor-de-tarefas-primetour` | **`STAGING_PROJECT`** (placeholder — substituir antes de qualquer deploy) |
| Workflows ativos | 8 (archive-tasks, ga-sync, mc-sync, meta-sync, portal-seed, etc) | **0** (todos movidos pra `.github/workflows.disabled/`, só fica um README explicativo) |
| GitHub Pages | Habilitado em `https://primetour.github.io/tarefas/` | Desabilitado |
| Tokens R2 / secrets inline | Alguns ainda presentes | **Removidos** dos serviços client-side |
| `.env*` files | Ignorados via `.gitignore` | Ignorados via `.gitignore` |

### Workflows desabilitados (8)
Movidos pra `.github/workflows.disabled/`:
- `archive-tasks.yml`
- `ga-cleanup.yml`
- `ga-sync.yml`
- `mc-sync.yml`
- `meta-sync.yml`
- `portal-seed.yml`
- `root-ga-sync.yml`
- `seed-ai-setting.yml`

A pasta `.github/workflows/` contém apenas um `README.md` explicando que **nenhum workflow ativo deve rodar** até existir staging Firebase/R2/Cloudflare separado.

---

## Escopo da POC (próximos 4 entregáveis)

Do `LAB_SETUP.md`:

1. **Criar módulo interno de LP Builder BTG** (gerador de landing pages em blocos)
2. **Salvar páginas em blocos em uma collection de staging** (não escrever em coleções de produção)
3. **Renderizar preview interno** com blocos JSON
4. **Validar schema de ofertas BTG** antes de conectar WordPress ou dados reais

---

## Como a equipe acessa

Por ser privado, o acesso ao repo é controlado por convite explícito do owner da org (`primetour`).

**Acesso atual:**
- `primetour` (owner-level admin)
- Tiago Prado (owner técnico via account `primetour`)

Pra adicionar mais devs:
1. Tiago Prado (ou owner) abre `Settings → Collaborators and teams → Add people`
2. Convidado precisa aceitar o invite via email
3. Recomendado dar permissão `Write` (não `Admin`) pra outros colaboradores

---

## Onde mora cada coisa hoje (matriz de ambientes)

| Componente | PROD | LAB | Status |
|---|---|---|---|
| Código JS/HTML/CSS | `primetour/tarefas` (público) | `primetour/gestor-btg-lp-builder-lab` (privado) | LAB sincroniza manualmente; sem auto-merge |
| Firebase project | `gestor-de-tarefas-primetour` | **`STAGING_PROJECT`** (placeholder — pendente criar) | ⚠ Lab ainda **não tem projeto Firebase dedicado** |
| R2 / Cloudflare | conta produção | sem conta staging | ⚠ Lab **não tem CDN/storage dedicado** |
| Cloud Functions | deployadas no projeto prod | não deployadas (workflows disabled) | OK |
| GitHub Pages | https://primetour.github.io/tarefas/ | desabilitado | OK |
| Coleções Firestore | `users`, `tasks`, etc | **deveriam ser coleções `staging_*`** quando o projeto Firebase do lab existir | ⚠ Pendente decisão |

### Pendências pra LAB virar staging "completo"
1. Criar projeto Firebase **dedicado** para staging (ex: `gestor-primetour-staging`)
2. Atualizar `.firebaserc` substituindo `STAGING_PROJECT` pelo project ID real
3. Criar conta R2 staging (ou bucket separado em conta existente)
4. Habilitar workflows-disabled pra rodar contra staging-only
5. Configurar GitHub Pages do lab (opcional, se quiser preview externo)
6. Documentar processo de promoção LAB → PROD (cherry-pick? merge? rebase?)

---

## Workflow recomendado (sugestão técnica)

Enquanto LAB e PROD não estão automaticamente sincronizados:

### Para mudanças experimentais (BTG, LP Builder, etc):
```
1. Dev faz feature no LAB (push direto ou via PR)
2. Valida em ambiente isolado (Firebase staging)
3. Quando aprovado, dev cria PR equivalente em primetour/tarefas
4. Code review na PROD pelo owner
5. Merge na PROD → deploy automático via GitHub Pages
```

### Para hotfixes em PROD:
```
1. Sempre direto em primetour/tarefas (PROD)
2. Após estabilizar, sincronizar mudança no LAB (cherry-pick)
```

---

## Riscos identificados

| Risco | Severidade | Mitigação |
|---|---|---|
| Dev confunde repos e faz commit de feature em PROD ao invés de LAB | Alto | Convenção: branches `lab/*` em PROD são proibidas; LAB tem repo separado |
| Workflows do LAB acidentalmente reabilitados batem em produção | Crítico | Guardrail: `.firebaserc` aponta pra `STAGING_PROJECT` placeholder; CI faria erro 404 antes de bater em PROD |
| LAB e PROD divergem (drift) | Médio | Estabelecer cadência semanal de sync (LAB recebe rebase do PROD) |
| Secret de produção vaza pro LAB privado | Alto | Já tratado: tokens R2 inline removidos; `.env*` ignorados |
| Equipe de TI não sabe que LAB existe | Alto | **Esta doc** + adicionar item no RULES-AND-AUTOMATIONS.md |

---

## Comandos úteis

```bash
# Clonar o LAB (precisa acesso)
git clone git@github.com:primetour/gestor-btg-lp-builder-lab.git

# Listar workflows disabled
ls -la .github/workflows.disabled/

# Verificar projeto Firebase configurado
cat .firebaserc

# Sync manual: trazer mudanças do PROD pro LAB (não automatizado)
git remote add prod https://github.com/primetour/tarefas.git
git fetch prod
git cherry-pick <commit-sha>
```

---

## Histórico

| Data | Evento | Responsável |
|---|---|---|
| 2026-05-06 20:25 | Criação do repo | Tiago Prado |
| 2026-05-06 20:31 | Commit baseline (`be06110`) com 266 arquivos higienizados | Tiago Prado |
| 2026-05-07 | Documento STAGING-LAB.md adicionado ao PROD | Equipe técnica |

---

## Referências cross-repo

No próprio LAB, ver:
- `LAB_SETUP.md` — guardrails e escopo da POC (fonte primária)
- `.github/workflows/README.md` — explicação dos workflows desativados
- `README.md` — onboarding geral do gestor

No PROD (este repo):
- `RULES-AND-AUTOMATIONS.md` § 12 (a adicionar) — referência cruzada
- `docs/ARCHITECTURE.md` — arquitetura geral (única, mesma do LAB)
