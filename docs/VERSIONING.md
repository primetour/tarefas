# Versionamento

Como versão é definida, propagada e exibida no Gestor PRIMETOUR.

---

## TL;DR

- **Esquema**: `MAJOR.MINOR.PATCH+BUILD` (SemVer + identificador de build).
- **Fonte de verdade**: [`js/version.js`](../js/version.js) — toda referência de versão no app importa daqui.
- **Exibido**: rodapé da sidebar (`PRIMETOUR · v3.0.0`), tooltip mostra build completa.
- **Bump**: edita `js/version.js`, atualiza `CHANGELOG.md`, sincroniza `?v=...` no `index.html`, commit.

> **Calibragem inicial**: a app rodou ~2 meses (mar–mai 2026, ~1.161 commits) sem versionamento formal. `3.0.0` foi o ponto onde SemVer foi instituído, com `[1.x]` e `[2.x]` consolidados retrospectivamente em `CHANGELOG.md`. Granularidade pré-3.0 segue em `git log`.

---

## Esquema

```
3.0.0+20260505-pickers
└┬┘ ┬ ┬   └──────┬──────┘
 │  │ │          │
 │  │ │          └── BUILD (yyyymmdd-slug, opcional)
 │  │ └── PATCH
 │  └── MINOR
 └── MAJOR
```

### Quando bumpar

| Mudança | Bump |
|---|---|
| Schema de Firestore que exige migração de dados | **MAJOR** |
| Quebra de contrato público (URLs, parâmetros, integrações externas) | **MAJOR** |
| Tela ou módulo novo | **MINOR** |
| Funcionalidade nova compatível com versão anterior | **MINOR** |
| Bugfix sem mudar comportamento esperado | **PATCH** |
| Polish visual / refactor interno | **PATCH** |
| Cada deploy | atualiza **BUILD** mesmo se `MAJOR.MINOR.PATCH` não mudou |

### Regra prática
Se um usuário com a versão antiga abrir o sistema e algo deixar de funcionar como esperava, é **MAJOR**. Se ganha algo novo e o que tinha continua igual, é **MINOR**. Resto é **PATCH**.

---

## Fonte de verdade — `js/version.js`

```js
export const VERSION = {
  major: 3,
  minor: 0,
  patch: 0,
  build: '20260505-pickers',
};

export const SHORT  = `${VERSION.major}.${VERSION.minor}.${VERSION.patch}`;
export const FULL   = `${SHORT}+${VERSION.build}`;
export const LABEL  = `v${SHORT}`;
```

**Não duplicar** o número da versão em outros lugares. Quem precisa, importa daqui:

- `js/config.js` — `APP_CONFIG.version` e `APP_CONFIG.buildId` lêem `SHORT` e `FULL`.
- `js/components/sidebar.js` — rodapé exibe `LABEL` com `FULL` no tooltip.
- `index.html` — atributo `?v=...` no `<script type="module" src="...">` deve casar com `FULL` para invalidar cache do browser/Pages.

---

## Como bumpar

1. **Editar `js/version.js`**
   ```js
   export const VERSION = {
     major: 3,
     minor: 1,           // ← bumpa aqui
     patch: 0,
     build: '20260512-newfeature',
   };
   ```

2. **Atualizar `CHANGELOG.md`** com nova seção `[3.1.0+20260512-newfeature] — YYYY-MM-DD` listando mudanças. Use as categorias `Added`, `Changed`, `Fixed`, `Removed`, `Deprecated`, `Security` (Keep a Changelog).

3. **Sincronizar cache-bust em `index.html`**
   ```html
   <script type="module" src="js/app.js?v=3.1.0+20260512-newfeature"></script>
   ```
   Esse `?v=` precisa bater com `FULL`. Se esquecer, o browser pode servir módulos antigos cacheados (max-age 600s no GitHub Pages) e algumas mudanças não aparecem até refresh forçado.

4. **Commit** com mensagem que reflete o bump:
   ```
   chore(release): 3.1.0+20260512-newfeature

   <copia o resumo do CHANGELOG da seção nova>
   ```

5. **Push** — `main` deploya via GitHub Pages automaticamente.

---

## Por que `+BUILD`?

SemVer puro (`1.2.0`) não distingue dois deploys do mesmo `1.2.0`. O build serve para:

- **Cache invalidation**: quando só polish/hotfix sai sem bumpar PATCH, o BUILD ainda muda e força fetch dos módulos novos.
- **Telemetria/suporte**: usuário reporta bug → tira screenshot do rodapé → time vê `v1.2.0` mas o tooltip dá `+20260512-hotfix2` e identifica exatamente qual deploy estava rodando.
- **Slug humano**: `20260512-newfeature` é mais útil que hash de commit no rodapé.

Convenção do slug: `yyyymmdd-tema` (kebab-case, curto, identifica a feature dominante daquele deploy).

---

## Marcos passados (e exemplos de futuros bumps)

| Versão | Quando bumpou |
|---|---|
| `1.x` (consolidado) | Lançamento (mar/2026) + módulos centrais: Tarefas, Projetos, Goals, Feedbacks, CSAT, Users, Auditoria, Portal de Solicitações, Calendário de Conteúdo, Check-in. SSO Microsoft (1 domínio). |
| `2.x` (consolidado) | Hardening Sprint 1–5 (LOCKDOWN, App Check, dailyBackup, SIEM, PITR, rate limit), IA Hub Fases 1–8, Portal Web Fases A–D, News Monitor, override de urgência por SLA, Realtime Database (presence). |
| `3.0.0+20260505-pickers` | Refactor núcleos→squads (schema MAJOR), unificação visual completa em ~23 módulos via `optionPicker`, página pública do Calendário de Conteúdo com SSO + real-time, esquema de versionamento formalizado. |
| `3.0.1+20260506-hotfix` | (Hipotético) Bugfix de cache não-invalidado em portal-view. |
| `3.1.0+20260520-multi-instance-pickers` | (Hipotético) Migração dos selects multi-instance pendentes (KPI inline goals, scheduleSlots taskTypes) — feature compatível. |
| `4.0.0+20260601-multi-tenant` | (Hipotético) Schema de Firestore reorganizado para multi-tenancy — quebra contrato, exige migração. |

---

## Exibição no rodapé

A versão aparece no rodapé da sidebar, abaixo do user-card:

```
┌─────────────────────────┐
│  [Avatar] João Silva    │
│           Analista      │
│─────────────────────────│
│  PRIMETOUR · v3.0.0     │  ← clica nada, hover mostra tooltip
└─────────────────────────┘
```

Hover (atributo `title`) mostra `Build: 3.0.0+20260505-pickers` para suporte/debug.

Render code: `js/components/sidebar.js`, próximo da linha 348.

---

## Pra debug rápido no console

Toda página injeta a versão em `window.__PRIMETOUR_VERSION__`:

```js
window.__PRIMETOUR_VERSION__
// { major: 3, minor: 0, patch: 0, build: '20260505-pickers',
//   full: '3.0.0+20260505-pickers', label: 'v3.0.0' }
```

Útil pra checar in-browser se a versão deployada bate com a esperada.

---

## Checklist de release

Antes de pushar uma release MINOR ou MAJOR:

- [ ] `js/version.js` atualizado (major/minor/patch/build)
- [ ] `CHANGELOG.md` tem nova seção descrevendo mudanças
- [ ] `index.html` `?v=...` casa com `FULL`
- [ ] Smoke test in-browser: rodapé mostra a versão nova
- [ ] `window.__PRIMETOUR_VERSION__` no console retorna o objeto correto
- [ ] Hard reload (`cmd+shift+r`) confirma que módulos novos chegaram

PATCHes podem ser mais informais, mas pelo menos atualize `version.js` + `CHANGELOG.md` + `?v=`.
