// Loga dev_hours das fases B (4.62.40), C (4.62.41) e D (4.62.42).
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.62.40',
    releaseSlug: '20260528-areas-templates-fase-b-toggle-name-banco-area',
    title: 'Templates Areas: Fase B (UI useExternalName + Banco aceita area)',
    summary: 'Fase B do plano de Templates Areas. B.1: toggle brand.useExternalName na tab Marca de ' +
             'portalAreas (default ligado = mostra "BTG Partners" na capa; desligado = "PRIMETOUR" ' +
             'guarda-chuva). Persiste via saveArea (setDoc merge:true). B.2: Banco de Roteiros aceita ' +
             'area no export. Adicionado modal de selecao (Sem area / lista de areas com logo + ' +
             'categoria + cor) antes de gerar PDF. roteiroBankGenerator.generateRoteiroBankPDF agora ' +
             'aceita arg area. Cache 60s do fetchAreas. Cancelar fecha sem gerar.',
    bucket: 'small', multiplierIds: [], profile: 'feature',
    hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.9, testes: 0.2, documentacao: 0.2, implantacao: 0.1 },
    module: 'portal', modules: ['portal', 'roteiros'],
  },
  {
    releaseVersion: '4.62.41',
    releaseSlug: '20260528-areas-templates-fase-c-fontes-docx-pptx',
    title: 'Templates Areas: Fase C (fontes dinamicas DOCX+PPTX)',
    summary: 'Fase C do plano. Resolve metade do D2 (PDF fica pra C2 — requer hostear TTFs no R2). ' +
             'DOCX: _DOCX_FONT derivado de area.fonts.body em portalGenerator (28 ocorrencias ' +
             'replaced) + roteiroGenerator (TextRun helper). PPTX: const FONT dinamico em ' +
             'portalGenerator + pptx.theme.{bodyFontFace,headFontFace} em roteiroGenerator. Word/PPT ' +
             'respeitam tipografia da BU; fallback gracioso se SO sem a fonte (substituicao auto pelo ' +
             'aplicativo). Sem mudanca de comportamento se area nao configurada (Poppins default).',
    bucket: 'small', multiplierIds: ['pure_refactor'], profile: 'feature',
    hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.8, testes: 0.2, documentacao: 0.2, implantacao: 0.1 },
    module: 'portal', modules: ['portal', 'roteiros'],
  },
  {
    releaseVersion: '4.62.42',
    releaseSlug: '20260528-areas-templates-fase-d-voice-ia',
    title: 'Templates Areas: Fase D (editorial.voice em prompts IA)',
    summary: 'Fase D do plano. Resolve D3 (voice era zumbi). Implementacao client-side (sem mexer na ' +
             'CF processRoteiroQueue) — antes de montar userMessage, fetcha area do roteiro e le ' +
             'area.editorial.voice. Se formal ou editorial-luxo, injeta instrucao explicita no ' +
             'prompt: formal = "Tom formal, terceira pessoa, sem coloquialismos"; editorial-luxo = ' +
             '"Tom de revista de luxo (Conde Nast/Robb Report), frases evocativas, vocabulario ' +
             'sofisticado". Default caloroso nao injeta (agente ja eh caloroso por padrao). ' +
             'try/catch envolve fetch+inject — falha silenciosa fallback pro userMessage sem voice.',
    bucket: 'trivial', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.4, testes: 0.1, documentacao: 0.2, implantacao: 0.1 },
    module: 'roteiros', modules: ['roteiros'],
  },
];

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({ investigation: .3, migration: .2, pdf: .15, integration: .2, security: .25, pure_refactor: -.2 }[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  for (const ENTRY of ENTRIES) {
    const ex = await db.collection('dev_hours').where('releaseVersion', '==', ENTRY.releaseVersion).limit(1).get();
    if (!ex.empty) { console.log(`= skip ${ENTRY.releaseVersion}`); continue; }
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
    console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  }
  process.exit(0);
})();
