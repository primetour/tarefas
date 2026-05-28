const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.5',
  releaseSlug: '20260528-templates-upload-modal-refined',
  title: 'Modal upload refinado drag-drop + preview placeholders + spec (sprint 6/11)',
  summary: 'Refator _openUploadModal em templatesLibrary.js. Features novas: drag-drop zone visual com ' +
           'border dashed + hover azul + dropzone full visual (nao so input file); auto-detect ' +
           'formato pela extensao do arquivo (extension -> select correspondente); card de arquivo ' +
           'mostra nome, tamanho, mime + botao Trocar arquivo; preview de placeholders pre-submit ' +
           '(HTML le client-side via FileReader.text + regex Handlebars; DOCX/PPTX mostra info ' +
           'extracao no servidor pois sao ZIPs); sidebar PLACEHOLDERS_SPEC 280px direita com lista ' +
           'de variaveis disponiveis por modulo, re-render automatico ao mudar modulo; badges de ' +
           'match nos placeholders detectados (verde reconhecido na spec / amarelo nao reconhecido ' +
           'com warning); contador 0/120 nome com cor vermelha > 90% limite; Esc fecha modal ' +
           '(handler global removido via MutationObserver); X no canto + clique fora + Cancel ' +
           '(3 caminhos pra fechar); hint na barra de submit mostra Validando + enviando pro R2.',
  bucket: 'small', multiplierIds: ['integration'], profile: 'feature',
  hoursByCategory: { refinamento: 0.4, desenvolvimento: 1.8, testes: 0.3, documentacao: 0.3, implantacao: 0.1 },
  module: 'portal', modules: ['portal', 'roteiros', 'banco-roteiros'],
};

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({ investigation: .3, migration: .2, pdf: .15, integration: .2, security: .25, pure_refactor: -.2 }[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  const ex = await db.collection('dev_hours').where('releaseVersion', '==', ENTRY.releaseVersion).limit(1).get();
  if (!ex.empty) { console.log('= skip'); process.exit(0); }
  const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
  const now = FV.serverTimestamp();
  const doc = {
    entryType: 'release', ...ENTRY,
    aiAssistanceMultiplier: AI_ASSIST,
    hourlyRate: HOURLY_RATE,
    totalHours: Math.round(h * 100) / 100,
    totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
    status: 'approved',
    completedAt: now, createdAt: now,
    createdBy: RENE_UID, updatedAt: now,
  };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  process.exit(0);
})();
