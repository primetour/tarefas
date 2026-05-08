# Componentes UI Compartilhados

Documento técnico dos componentes reusáveis que sustentam a unidade visual do app. Inclui o `optionPicker` (substituto universal de `<select>`) introduzido em **3.0.0** e padrões de modal/filtro relacionados.

> Para o histórico completo da unificação visual, ver [`CHANGELOG.md`](../CHANGELOG.md) → `[3.0.0+20260505-pickers]`.

---

## Visão geral

| Componente | Arquivo | Onde é usado | O que substitui |
|---|---|---|---|
| **`optionPicker`** | `js/components/optionPicker.js` | ~96 selects em 23 módulos | `<select>` nativo |
| **`filterBar`** | `js/components/filterBar.js` | Calendar / Kanban / Timeline | Set de selects soltos |
| **`taskModal`** | `js/components/taskModal.js` | Criação/edição de tarefas | Modal customizado por página |
| **`modal`** | `js/components/modal.js` | Toda app | `alert()` / `prompt()` / `confirm()` |
| **`toast`** | `js/components/toast.js` | Toda app | `alert()` |
| **`uiKit`** | `js/components/uiKit.js` | Headers de página | Repetição de split-button + overflow menu |
| **`cardPrefsModal`** | `js/components/cardPrefsModal.js` | Tasks / Calendar / Kanban / Timeline | Configuração de campos visíveis |
| **`insightsPanel`** | `js/components/insightsPanel.js` | Todos dashboards (produtividade, ga, meta, nl, portal, roteiro) | — (introduzido em 3.x) |
| **`insightDraftsDock`** | `js/components/insightDraftsDock.js` | Todos dashboards | Drawer estilo Outlook (4.33.0+) |

---

## 1. `optionPicker` — dropdown visual padronizado

Substitui `<select>` nativo por um popover rico, mantendo o select escondido como **fonte de verdade** (compatível com `change` events e formulários existentes).

### Por que existe?

`<select>` nativo:
- Não renderiza ícones/cores
- Estiliza diferente em cada OS (Mac/Win/Linux)
- Sem busca interna (chave a chave em listas longas)
- Sem agrupamento visual

A unificação em **3.0.0** trocou cada um deles por um botão que abre um popover consistente.

### Anatomia visual

```
┌──────────────────────────────────────────┐
│ ●  📷  Instagram          ▾              │  ← Botão (ancora do popover)
└──────────────────────────────────────────┘
   │   │      │              │
   │   │      │              └── chevron (indica dropdown)
   │   │      └── label
   │   └── ícone (emoji ou glifo unicode)
   └── bolinha colorida (cor estável por hash do id)
```

Popover aberto:

```
┌──────────────────────────────────────────┐
│ 🔍 Buscar plataforma…                    │  ← Search interna
├──────────────────────────────────────────┤
│ ● — Sem plataforma —                  ✓  │  ← Empty option (opcional)
│ 🎨 Comunicação                         3 │  ← Group header (acordeão)
│   ● 📷 Instagram                         │
│   ● ◈ Facebook                           │
│ 🎨 Web/UX                              2 │
│   ● ▤ LinkedIn                           │
└──────────────────────────────────────────┘
```

### API pública

#### `renderPickerButton({ btnId, selected, emptyLabel })`

Retorna o HTML do botão. Use no template do componente que possui o picker.

```js
import { renderPickerButton } from './components/optionPicker.js';

// No template HTML:
return `
  <select id="my-field" style="display:none;">
    <option value="">Sem opção</option>
    <option value="A">Alpha</option>
  </select>
  ${renderPickerButton({
    btnId: 'my-field-btn',
    selected: { id: 'A', label: 'Alpha', icon: '◈', color: '#6366F1' },
    emptyLabel: '— Selecionar —',
  })}
`;
```

`selected` aceita `null` (mostra `emptyLabel`) ou um objeto:
- `id` (string) — valor que vai no select escondido
- `label` (string) — texto principal
- `icon` (string|'') — emoji/glifo. Se `''`, suprime e mostra só a bolinha-cor (status)
- `color` (string) — cor da bolinha (`#hex` ou CSS var)
- `sublabel` (string, opcional) — texto secundário em fonte menor

#### `bindOptionPicker({ btnId, selectId, buildConfig, findSelected, emptyLabel, onChange })`

Faz o wiring. Click no botão → abre popover. Selecionar item → atualiza `<select>` + dispara `change` + atualiza visual do botão.

```js
bindOptionPicker({
  btnId:    'my-field-btn',
  selectId: 'my-field',
  buildConfig: () => ({
    options: [
      { id: 'A', label: 'Alpha', icon: '◈', color: '#6366F1' },
      { id: 'B', label: 'Beta',  icon: '◆', color: '#22C55E' },
    ],
    empty: { id: '', label: '— Selecionar —' },
    searchPlaceholder: 'Buscar…',
  }),
  findSelected: (id) => /* lookup pra refletir no botão */ null,
  emptyLabel: '— Selecionar —',
});
```

Para listas agrupadas, use `groups` em vez de `options`:

```js
buildConfig: () => ({
  groups: [
    { id: 'mkt', label: 'Marketing', icon: '📣', color: '#EC4899', items: [
      { id: 'newsletter', label: 'Newsletter', icon: '📧', color: '#D4A843' },
    ]},
    { id: 'design', label: 'Design', icon: '🎨', color: '#8B5CF6', items: [...] },
  ],
  empty: { id: '', label: '— Sem tipo —' },
});
```

#### `refreshPickerButton(btnId, { selected, emptyLabel })`

Atualiza o conteúdo do botão sem re-criar o elemento (preserva listeners). Útil quando o estado muda externamente.

#### Events

- **`change`** (no `<select>` escondido) — disparado quando o user seleciona algo via popover. Compatível com listeners pré-existentes.
- **`picker-refresh`** (custom event) — atualiza só o visual do botão sem disparar cascade. Use quando você popula o `<select>` programaticamente:

```js
const sel = document.getElementById('p-type');
sel.innerHTML = '<option value="">…</option>' + newOptions;
sel.dispatchEvent(new Event('picker-refresh'));  // sincroniza botão
```

#### Debug

Os pickers expõem-se via `data-id` no popover. Inspecionar via DevTools:

```js
document.querySelector('.option-picker-popover')           // popover ativo
document.querySelectorAll('.option-picker-item')           // items
document.getElementById('cc-f-platform')                   // select escondido
document.getElementById('cc-f-platform-btn')               // botão visível
```

---

## 2. Padrões de uso comuns

### 2.1. Cor estável via hash determinístico

Para campos com lista grande (áreas, usuários, núcleos), gerar cor estável a partir do id evita ter que mapear manualmente:

```js
const HASH_PALETTE = ['#6366F1','#8B5CF6','#EC4899','#F59E0B','#22C55E','#0EA5E9','#D4A843','#64748B','#10B981'];
const hashColor = (s) => {
  const str = String(s || '');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return HASH_PALETTE[Math.abs(h) % HASH_PALETTE.length];
};
```

Mesmo input → mesma cor sempre. User "João Silva" sempre aparece em verde, área "BTG" sempre em azul. Visualmente ajuda no scan.

### 2.2. Avatar por inicial

Usuários (assignee, gestor, colaborador) usam a primeira letra do nome como ícone:

```js
const userOpts = (users) => users.map(u => ({
  id: u.id,
  label: u.name || u.email || 'Usuário',
  icon: (u.name || u.email || '?').trim().charAt(0).toUpperCase(),
  color: hashColor(u.id),
}));
```

Resultado: **R Renê Castro** (R em quadrado verde), **G Gabrielle** (G em rosa), etc.

### 2.3. Status sem ícone redundante

Campos de status onde a cor já identifica (não-iniciado/em-andamento/concluído/...) usam `icon: ''` para suprimir o glifo redundante:

```js
const STATUS_OPTS = STATUSES.map(s => ({
  id: s.value,
  label: s.label,
  icon: '',          // ← bolinha-cor já basta
  color: s.color,
}));
```

Resultado visual: só **● Em Andamento** (sem o quadrado de ícone vazio).

### 2.4. Lendo opções de um `<select>` populado dinamicamente

Quando o `<select>` é populado em runtime (cascata setor→tipo, fetch async), o `buildConfig` lê dele:

```js
const optsFromSelect = (selectId, defaultIcon = '◈') => {
  const sel = document.getElementById(selectId);
  if (!sel) return [];
  return [...sel.options].filter(o => o.value).map(o => ({
    id: o.value,
    label: o.textContent.trim(),
    icon: defaultIcon,
    color: hashColor(o.value),
  }));
};

bindOptionPicker({
  btnId: 'p-type-btn',
  selectId: 'p-type',
  buildConfig: () => ({
    options: optsFromSelect('p-type', '📋'),
    empty: { id: '', label: '— Selecione o tipo —' },
  }),
  ...
});
```

E quando o select é repopulado, dispare `picker-refresh` pra sincronizar.

### 2.5. Cascata `picker-refresh`

Cenário típico: setor muda → tipos disponíveis mudam → variação reseta.

```js
document.getElementById('p-setor').addEventListener('change', async (e) => {
  const types = await loadTypesForSector(e.target.value);
  const typeSel = document.getElementById('p-type');
  typeSel.innerHTML = '<option value="">…</option>' + types.map(...);
  typeSel.dispatchEvent(new Event('picker-refresh'));   // visual sync
});
```

`picker-refresh` é importante porque `change` dispararia listener da cascata em loop.

### 2.6. `splitEmoji()` — extrair emoji do label

Quando os dados já vêm com emoji no início do nome (ex: `📧 Newsletter`), separa para usar como ícone do picker em vez de duplicar:

```js
const splitEmoji = (text) => {
  const t = (text || '').trim();
  const fc = t[0];
  const isEmoji = fc && fc.codePointAt(0) > 127;
  if (!isEmoji) return { icon: null, label: t };
  const parts = t.split(/\s+/);
  return { icon: parts[0], label: parts.slice(1).join(' ').trim() || t };
};
```

Antes: `📋 📧 Newsletter ▾` (ícone duplicado). Depois: `📧 Newsletter ▾`.

---

## 3. `filterBar` — filtros padronizados em views de lista

Componente compartilhado por **Calendar / Kanban / Timeline** com 7 filtros configuráveis (`sector`, `type`, `project`, `area`, `assignee`, `status`, `meta`). Internamente usa `optionPicker` para todos.

### API

```js
import { renderFilterBar, bindFilterBar, buildFilterFn } from './components/filterBar.js';

// 1. Render HTML
wrap.innerHTML = renderFilterBar({
  show: ['sector','type','project','area','assignee','meta'],   // quais filtros mostrar
  state: kbFilterState,                                          // estado inicial
  taskTypes: allTaskTypes,
  projects: allProjects,
  users: store.get('users') || [],
});

// 2. Wire events + pickers
bindFilterBar(wrap, kbFilterState, (newState) => {
  // Callback chamado a cada mudança
  renderCards(applyFilters(allTasks, newState));
}, { taskTypes: allTaskTypes, projects: allProjects, users: store.get('users') || [] });

// 3. Build filter function pra aplicar nas listas
const filterFn = buildFilterFn(kbFilterState);
const filtered = allTasks.filter(filterFn);
```

### Cascade interna

Quando o filtro `sector` muda, o filtro `type` é resetado automaticamente (tipos disponíveis mudam). O componente cuida disso e dispara `picker-refresh` no select de tipo.

---

## 4. `taskModal` — modal de criação/edição de tarefas

Modal central da app, contém **5 pickers** integrados:

| Campo | Source | Ícone padrão |
|---|---|---|
| Tipo de Tarefa | task_types (Firestore, agrupado por squad) | `t.icon` |
| Variação do Material | `task.variations[]` (cascateado por tipo) | `🎯` |
| Squad | `userWorkspaces` (store) | `w.icon` |
| Área Solicitante | `REQUESTING_AREAS` (constante) | `◈` |
| Projeto | `projects` (Firestore) | `p.icon` |

**Cascata**: Tipo muda → Variação reseta + SLA recalcula. Squad muda → Núcleo opcional aparece.

Detalhes em [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) → seção "Modal de Tarefa" (em construção).

---

## 5. Como adicionar um picker novo

Receita rápida pra qualquer `<select>` da app:

1. **No HTML**: adicione `style="display:none;"` no `<select>`. Logo depois, adicione `${renderPickerButton({ btnId: 'meu-field-btn', ... })}`.

2. **No bind events**: adicione `bindOptionPicker(...)` apontando pro `btnId` e `selectId`.

3. **Listener `change`**: continua funcionando. O `<select>` é a fonte de verdade.

4. **Programmatic update**: depois de `sel.value = X` ou `sel.innerHTML = …`, dispare `sel.dispatchEvent(new Event('picker-refresh'))`.

5. **Cor & ícone**: prefira hash determinístico para listas grandes. Para enums fixos (status, priority), defina cor manualmente.

Exemplos completos:
- `js/pages/tasks.js` (toolbar, 5 pickers)
- `js/pages/feedbacks.js` (toolbar 4 + modal 4 + schedule 2)
- `js/pages/aiHub.js` (modal de agente, 9 pickers em sub-tabs)
- `js/components/filterBar.js` (componente compartilhado, 7 pickers)

---

## 6. Acessibilidade

- Botão tem `type="button"` (evita submit acidental em forms).
- Popover fecha em **Esc** (keyboard handler global).
- Click fora fecha (capture phase listener).
- Search input tem foco automático ao abrir.
- Posicionamento clamped na viewport (abre acima se não couber abaixo).

**Pendente**: navegação por setas no popover ainda usa search keyboard nativo. Roadmap inclui handling com ↑↓Enter explícito.

---

## 7. Performance

- Renderização do popover é lazy (só monta no DOM quando abre).
- `buildConfig` é chamado a cada abertura — caso a lista seja cara, memoize externamente.
- Search filtra via `style.display='none'` (não re-renderiza DOM).
- Nada de virtual scroll: lista típica < 100 items. Se ultrapassar 500, considerar paginação no popover.

---

## 8. Versionamento

Mudanças em `optionPicker` que quebrem a API exigem **MAJOR** bump (afeta ~96 call sites).

Histórico:
- **3.0.0** — introdução, adoção em 23 módulos
- Próximas mudanças sob roadmap em [`CHANGELOG.md`](../CHANGELOG.md)

---

## 9. `insightsPanel` & `insightDraftsDock` — análises por dashboard

Bloco unificado de **insights & observações** disponível em todos os dashboards. Cada widget ganha um botão `💡 + insights` no header; cada dashboard ganha um painel "Análise Geral" no rodapé. Insights são persistidos em `dashboard_insights` (Firestore).

### Wiring

Dashboards usam o helper `setupDashboardInsights({ dashboard, widgets, metrics, ... })` em `js/services/insightWidgets.js`. Esse helper:
1. Monta popover de insights em cada widget (`attachWidgetInsights`)
2. Monta painel "Análise Geral" no rodapé (`attachGeneralPanel`)
3. **4.33.0+** Monta drawer de rascunhos no rodapé (`mountInsightDraftsDock`)

### Anatomia de um insight

```
{
  dashboard:      'produtividade',
  indexKey:       'velocity'  // ou 'general' se não-ancorado
  title, observation, recommendation,
  type:           'positive' | 'negative' | 'neutral' | 'warning' | 'opportunity',
  impact:         'low' | 'medium' | 'high',
  periodFrom, periodTo,
  filters,        // snapshot dos filtros do dash
  source:         'manual' | 'ai-generated' | 'ai-edited',
  dataSnapshot,   // foto dos números — IMUTÁVEL
  chartImage,     // PNG base64 do canvas (PDF export)
  createdBy, createdAt, updatedAt,
}
```

### Bloco "O que você estava analisando" (4.33.1+)

Renderização amigável do `dataSnapshot`:
- **Antes**: monospace + chaves técnicas (`weeklyVelocity[0].weekStart: 2026-04-15`)
- **Depois**: cards com tipografia padrão + labels em pt-BR (`📈 Tarefas por semana → Semana de 15/04: 12 criadas · 9 concluídas`)

Implementado via `formatDataSnapshotFriendly()` em `js/services/insights.js`:
- Registry `FRIENDLY_TOPLEVEL_LABELS` mapeia ~25 chaves técnicas pra ícone+label
- Registry `FRIENDLY_FIELD_LABELS` mapeia campos comuns (`avg`, `responseRate`, `avgDays`, etc)
- Valores formatados em locale BR (vírgula decimal, datas dd/mm/aa, %)
- Output: `[{ label: '★ CSAT geral', items: [{ name, value }, ...] }]`

A função antiga `formatDataSnapshot()` (string compacta de uma linha) foi preservada para PDF/XLSX export onde o formato compacto é desejável.

### Rascunhos com auto-save (4.33.0+)

`insightDraftsDock` é um drawer fixo no rodapé que aparece quando o usuário tem rascunhos não-publicados. Inspirado no Outlook drafts panel.

**Auto-save:**
- Cada keystroke → debounce 500ms → save em `localStorage` (`primetour-insight-drafts`)
- Critério mínimo (`shouldDraft`): ≥1 char no título OU ≥10 chars na observação (evita criar rascunho de typo acidental)
- Indicador no rodapé do form: `📝 Rascunho salvo automaticamente` → `💾 Rascunho salvo às HH:MM`
- Salvar oficialmente o insight → deleta o draft

**Persistência:**
- Local: `localStorage` (sync entre abas via `storage` event)
- Cap: 20 drafts (FIFO)
- Auto-purge: drafts > 30 dias

**Cross-dashboard:**
- Cards do dashboard atual aparecem com destaque (borda dourada)
- Click em card de outro dashboard → navega + abre form lá (pendência via `sessionStorage`, expira em 30s)

### API exposta no dashboard

Dashboards não interagem diretamente com `insightsPanel.js`. Apenas declaram seus widgets:

```js
const WIDGETS = [
  {
    widgetId: 'sla-chart',
    indexKey: 'sla',
    label:    '📊 SLA',
    snapshot: (m) => ({ sla: getSlaData(m) }),  // dados pra IA + bloco "O que você estava analisando"
  },
  ...
];

await setupDashboardInsights({
  dashboard: 'produtividade',
  widgets: WIDGETS,
  metrics,
  periodFrom, periodTo, periodLabel, filters,
  generalPanelContainerId: 'dash-insights-section',
  buildGeneralSnapshot: () => buildDashboardSnapshot(metrics, period),
});
```

### Histórico

- **3.x** — Introdução do módulo (manual + AI-generated insights)
- **4.32.0** — F4 CSAT: bloco "Médias por pergunta" no `/csat`
- **4.33.0** — Rascunhos com auto-save + drawer no rodapé
- **4.33.1** — Bloco "Dados observados" reformulado (sem monospace, labels pt-BR)
- **4.33.2** — Cache-bust de imports antigos pra propagar 4.33.1
