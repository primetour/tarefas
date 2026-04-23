/**
 * PRIMETOUR — testes do helper metaLinks
 * Rodar: node tests/metaLinks.test.mjs
 */
import {
  normalizeMetaLinks,
  migrateLegacyToMetaLinks,
  syncLegacyFields,
  tasksLinkedToGoal,
  tasksLinkedToMeta,
  metaLinksForUser,
  expandPilarToLinks,
  groupLinksByUser,
} from '../js/services/metaLinks.js';

let pass = 0;
let fail = 0;
const failures = [];

function eq(label, got, expected) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) { pass++; return; }
  fail++;
  failures.push(`✗ ${label}\n   esperado: ${b}\n   obtido:   ${a}`);
}

function truthy(label, val) {
  if (val) { pass++; return; }
  fail++;
  failures.push(`✗ ${label} → recebeu valor falso`);
}

/* ─── normalizeMetaLinks ─────────────────────────────────── */

eq('normalize: array vazio', normalizeMetaLinks([]), []);
eq('normalize: undefined', normalizeMetaLinks(undefined), []);
eq('normalize: null', normalizeMetaLinks(null), []);
eq('normalize: não-array', normalizeMetaLinks('xyz'), []);

eq(
  'normalize: 1 link válido',
  normalizeMetaLinks([{ userId: 'u1', goalId: 'g1', metaRef: '0:1' }]),
  [{ userId: 'u1', goalId: 'g1', metaRef: '0:1' }]
);

eq(
  'normalize: descarta metaRef inválido',
  normalizeMetaLinks([
    { userId: 'u1', goalId: 'g1', metaRef: '0:1' },
    { userId: 'u1', goalId: 'g1', metaRef: 'abc' },
    { userId: 'u1', goalId: 'g1', metaRef: '' },
  ]),
  [{ userId: 'u1', goalId: 'g1', metaRef: '0:1' }]
);

eq(
  'normalize: descarta sem userId/goalId',
  normalizeMetaLinks([
    { userId: '', goalId: 'g1', metaRef: '0:0' },
    { userId: 'u1', goalId: '', metaRef: '0:0' },
    { userId: 'u1', goalId: 'g1', metaRef: '0:0' },
  ]),
  [{ userId: 'u1', goalId: 'g1', metaRef: '0:0' }]
);

eq(
  'normalize: dedup (userId, goalId, metaRef)',
  normalizeMetaLinks([
    { userId: 'u1', goalId: 'g1', metaRef: '0:1' },
    { userId: 'u1', goalId: 'g1', metaRef: '0:1' },
    { userId: 'u2', goalId: 'g1', metaRef: '0:1' },
  ]),
  [
    { userId: 'u1', goalId: 'g1', metaRef: '0:1' },
    { userId: 'u2', goalId: 'g1', metaRef: '0:1' },
  ]
);

eq(
  'normalize: trim de strings',
  normalizeMetaLinks([{ userId: ' u1 ', goalId: ' g1 ', metaRef: ' 0:1 ' }]),
  [{ userId: 'u1', goalId: 'g1', metaRef: '0:1' }]
);

/* ─── migrateLegacyToMetaLinks ───────────────────────────── */

eq(
  'migrate: task sem nada',
  migrateLegacyToMetaLinks({ assignees: ['u1'] }),
  []
);

eq(
  'migrate: legado sem assignees → []',
  migrateLegacyToMetaLinks({ goalId: 'g1', goalMetaRef: '0:1', assignees: [] }),
  []
);

eq(
  'migrate: legado com 1 assignee',
  migrateLegacyToMetaLinks({ goalId: 'g1', goalMetaRef: '0:1', assignees: ['u1'] }),
  [{ userId: 'u1', goalId: 'g1', metaRef: '0:1' }]
);

eq(
  'migrate: legado com 3 assignees → 3 links iguais (um por user)',
  migrateLegacyToMetaLinks({ goalId: 'g1', goalMetaRef: '0:1', assignees: ['u1','u2','u3'] }),
  [
    { userId: 'u1', goalId: 'g1', metaRef: '0:1' },
    { userId: 'u2', goalId: 'g1', metaRef: '0:1' },
    { userId: 'u3', goalId: 'g1', metaRef: '0:1' },
  ]
);

eq(
  'migrate: já tem metaLinks → ignora legado',
  migrateLegacyToMetaLinks({
    goalId: 'gOLD', goalMetaRef: '9:9', assignees: ['u1','u2'],
    metaLinks: [{ userId: 'u1', goalId: 'gNEW', metaRef: '0:0' }],
  }),
  [{ userId: 'u1', goalId: 'gNEW', metaRef: '0:0' }]
);

/* ─── syncLegacyFields ───────────────────────────────────── */

eq(
  'sync: sem links → limpa legado',
  syncLegacyFields({ metaLinks: [], goalId: 'gX', goalMetaRef: '9:9' }),
  { metaLinks: [], goalId: null, goalMetaRef: null }
);

eq(
  'sync: 2 links → primeiro vira o legado',
  syncLegacyFields({ metaLinks: [
    { userId: 'u1', goalId: 'gA', metaRef: '0:0' },
    { userId: 'u2', goalId: 'gB', metaRef: '1:1' },
  ]}),
  {
    metaLinks: [
      { userId: 'u1', goalId: 'gA', metaRef: '0:0' },
      { userId: 'u2', goalId: 'gB', metaRef: '1:1' },
    ],
    goalId: 'gA',
    goalMetaRef: '0:0',
  }
);

/* ─── tasksLinkedToGoal / tasksLinkedToMeta ──────────────── */

const sampleTasks = [
  // legado puro
  { id: 't1', goalId: 'g1', goalMetaRef: '0:0' },
  // novo modelo
  { id: 't2', metaLinks: [{ userId: 'u1', goalId: 'g1', metaRef: '0:1' }] },
  // novo modelo, dois goals
  { id: 't3', metaLinks: [
    { userId: 'u1', goalId: 'g1', metaRef: '1:0' },
    { userId: 'u2', goalId: 'g2', metaRef: '0:0' },
  ]},
  // sem meta
  { id: 't4' },
];

eq(
  'linkedToGoal: g1 acha t1, t2, t3',
  tasksLinkedToGoal(sampleTasks, 'g1').map(t => t.id),
  ['t1','t2','t3']
);

eq(
  'linkedToGoal: g2 acha só t3',
  tasksLinkedToGoal(sampleTasks, 'g2').map(t => t.id),
  ['t3']
);

eq(
  'linkedToMeta: g1/0:0 → só t1',
  tasksLinkedToMeta(sampleTasks, 'g1', '0:0').map(t => t.id),
  ['t1']
);

eq(
  'linkedToMeta: g1/0:1 → só t2',
  tasksLinkedToMeta(sampleTasks, 'g1', '0:1').map(t => t.id),
  ['t2']
);

eq(
  'linkedToMeta: g1/9:9 → vazio',
  tasksLinkedToMeta(sampleTasks, 'g1', '9:9').map(t => t.id),
  []
);

/* ─── metaLinksForUser ───────────────────────────────────── */

const t = {
  metaLinks: [
    { userId: 'u1', goalId: 'g1', metaRef: '0:0' },
    { userId: 'u1', goalId: 'g2', metaRef: '0:1' },
    { userId: 'u2', goalId: 'g1', metaRef: '0:0' },
  ],
};

eq(
  'metaLinksForUser: u1 (2 links)',
  metaLinksForUser(t, 'u1'),
  [
    { userId: 'u1', goalId: 'g1', metaRef: '0:0' },
    { userId: 'u1', goalId: 'g2', metaRef: '0:1' },
  ]
);

eq(
  'metaLinksForUser: u3 (vazio)',
  metaLinksForUser(t, 'u3'),
  []
);

/* ─── expandPilarToLinks ─────────────────────────────────── */

const pilar = {
  nome: 'Crescimento',
  metas: [
    { nome: 'Meta A' },
    { nome: 'Meta B' },
    { nome: 'Meta C' },
  ],
};

eq(
  'expandPilar: 3 metas → 3 links',
  expandPilarToLinks({ goalId: 'gX', pilar, pilarIdx: 2, userId: 'u1' }),
  [
    { userId: 'u1', goalId: 'gX', metaRef: '2:0' },
    { userId: 'u1', goalId: 'gX', metaRef: '2:1' },
    { userId: 'u1', goalId: 'gX', metaRef: '2:2' },
  ]
);

eq(
  'expandPilar: pilar sem metas',
  expandPilarToLinks({ goalId: 'gX', pilar: { metas: [] }, pilarIdx: 0, userId: 'u1' }),
  []
);

/* ─── groupLinksByUser ───────────────────────────────────── */

const grouped = groupLinksByUser([
  { userId: 'u1', goalId: 'g1', metaRef: '0:0' },
  { userId: 'u2', goalId: 'g1', metaRef: '0:0' },
  { userId: 'u1', goalId: 'g2', metaRef: '1:1' },
]);

truthy('groupByUser: tem u1', grouped.get('u1')?.length === 2);
truthy('groupByUser: tem u2', grouped.get('u2')?.length === 1);

/* ─── relatório ──────────────────────────────────────────── */

console.log(`\n${pass} OK · ${fail} FALHA${fail === 1 ? '' : 'S'}`);
if (fail) {
  console.log('\n' + failures.join('\n\n'));
  process.exit(1);
}
