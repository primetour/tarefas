/**
 * Adiciona entradas de dev_hours pras releases 4.40.0 -> 4.40.7.
 * Trabalho concentrado em 2026-05-12.
 * Tema do dia: UX deepening — Content Calendar, Office, Team, Banco de Imagens.
 * Idempotente: upserta por releaseVersion.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const HOURLY_RATE = 150;
const AI_MULT = 0.50;

const RELEASES = [
  {
    releaseVersion: '4.40.0',
    releaseSlug:    '20260512-content-calendar-ux',
    title:          'Calendario de Conteudo: filtros aditivos + "+N" expansivel + clareza dual-view',
    summary:        'Tres melhorias UX pedidas pelo user: (1) Click em card de tipo na home agora ADICIONA ao filtro em vez de sobrescrever — permite combinar multiplos tipos sem voltar a home. Bug em renderTypeCardsHome: visibleTaskTypes = [typeId] virou append. (2) "+N mais/tarefas/previstos" vira botao clicavel (classe cc-day-overflow) que abre openDayDetailsModal — modal com TODOS os items do dia agrupados em 3 secoes (slots de conteudo / tarefas dos projetos / previstos), cada item clicavel abre o editor correspondente. (3) Clareza conceitual: home empty state ganha 2 cards explicando "Por Tipo" (agenda previa/slots) vs "Por Projeto" (tarefas reais) + nota de combinacao. Subtitle dinamico com chips coloridos quando 1 ou ambas as visoes ativas. Tambem: botao "+ Tipos" sempre disponivel quando ha contexto mas nenhum tipo selecionado (antes user travava em projeto-only).',
    bucket:         'medium',
    multiplierIds: [],
    profile:        'feature',
    humanHours:     3.5,
    completedAt:    new Date('2026-05-12T10:30:00-03:00'),
  },
  {
    releaseVersion: '4.40.1',
    releaseSlug:    '20260512-image-bank-counts-stale',
    title:          'Banco de Imagens: contadores das pills atualizam apos delete/edit/upload',
    summary:        'Bug: ao deletar imagem do banco, galeria atualizava mas os numeros nas pills de categoria ("Todas 11, Destino 9...") continuavam congelados. Causa: _categoryCounts so era invalidado em mudanca de filtro tipo/uploader/data, nao em mutacao. Fix: invalida _categoryCounts dentro de loadImages quando reset=true. Cobre delete, save (upload em lote) e updateImageMeta automaticamente.',
    bucket:         'trivial',
    multiplierIds: [],
    profile:        'bugfix',
    humanHours:     0.5,
    completedAt:    new Date('2026-05-12T11:00:00-03:00'),
  },
  {
    releaseVersion: '4.40.2',
    releaseSlug:    '20260512-office-fixes',
    title:          'Escritorio Virtual: 4 fixes (modulo, atividade, idle, anti-overlap)',
    summary:        'Quatro correcoes solicitadas: (1) Botao "Ir ate a sala" no painel lateral do avatar agora navega DIRETO pro modulo (location.hash = route) em vez de so zoomar no mapa — mapa e pequeno, justificava acao real. Renomeado pra "Ir ate o modulo". (2) "Atividade recente" do painel lateral estava SEMPRE vazia: query usava where(userId)+orderBy(timestamp) que precisava de composite index nao criado no firestore.indexes.json, falhava silenciosamente com catch(_). Fix: where(userId).limit(50) + sort client-side; erros agora vao pro console.warn. (3) Removido "(idle)" dos labels de UI (legenda, tooltip, painel) — termo tecnico que usuario nao conhecia. (4) Anti-overlap de avatares na mesma sala: spacing 60->90px H, 50->70px V; 3 colunas quando 5+ users; raio do walk path 35-50 -> 18-26 pra wander nao empurrar avatar em cima do vizinho.',
    bucket:         'small',
    multiplierIds: ['investigation'],
    profile:        'bugfix',
    humanHours:     2.5,
    completedAt:    new Date('2026-05-12T12:30:00-03:00'),
  },
  {
    releaseVersion: '4.40.3',
    releaseSlug:    '20260512-team-grouped-by-area',
    title:          'Equipe: Disponibilidade agrupada por area + filtro por permissao',
    summary:        'Tab Disponibilidade agora aplica o mesmo filtro de visibleSectors usado em Membros/Projetos: master/diretoria ve tudo; analista ve so a propria area. Antes a tab era flat showing all users a todos. Lista de barras e calendario ambos agrupados por area (sector) com cabecalho sticky/colorido espelhando o padrao da tab Membros. Setores ordenados alfabeticamente, "Sem area" por ultimo. Hint visual quando filtrado: "Voce esta vendo disponibilidade de [areas]" — explicita ao analista por que nao ve todo mundo.',
    bucket:         'small',
    multiplierIds: ['security'],
    profile:        'feature',
    humanHours:     1.5,
    completedAt:    new Date('2026-05-12T13:00:00-03:00'),
  },
  {
    releaseVersion: '4.40.4',
    releaseSlug:    '20260512-team-area-accordion',
    title:          'Equipe: Disponibilidade vira accordion por area (escala 200+ users)',
    summary:        'Iteracao do 4.40.3: usuario apontou que com 200 funcionarios a visao flat seria impraticavel. Refator pra accordion: cada area vira card colapsavel (default fechado quando 2+ areas, auto-expand se 1 area). Header fechado mostra resumo escaneavel: contagem de pessoas, % media de disponibilidade da area (verde/amarelo/vermelho), indicador 📌 N pra ausencias no periodo, mini-barra 60px. Estado de expansao persistido em localStorage (team-avail-open-sectors). Botoes "Expandir todas / Recolher todas" no topo quando 2+ areas. Diretor agora "navega" pelas areas em vez de scrollar listao enorme.',
    bucket:         'medium',
    multiplierIds: [],
    profile:        'feature',
    humanHours:     2.0,
    completedAt:    new Date('2026-05-12T14:30:00-03:00'),
  },
  {
    releaseVersion: '4.40.5',
    releaseSlug:    '20260512-image-bank-overhaul',
    title:          'Banco de Imagens: categoria Restaurante, modelo Destino-mae, UX upload',
    summary:        'Overhaul amplo do Banco de Imagens (9 mudancas em uma release). CATEGORIAS: nova categoria Restaurante (🍽, path R2 restaurantes/); Destino vira categoria-MAE, Hotel/Restaurante/Trem aceitam localizacao opcional. Modelo refatorado: requiresLocation binario -> showLocation "full"|"continent"|"none". UPLOAD: botoes "Aplicar a todas" e "Enviar todas" agora STICKY no topo da viewport durante scroll de fila grande; bug fix do def-copyright que persistia entre uploads (limpa apos sucesso); campo Tipo removido (passa a ser decidido em /dicas e /roteiros conforme uso); label "Nome do lugar" -> "Descricao da foto". GALERIA/FILTROS: "Mais filtros" default ABERTO (era fechado); continent/pais/cidade movidos pra DENTRO do painel de filtros (antes ficavam num breadcrumb separado); removidos dropdowns Categoria (redundante com pills do topo) e Tipo; novo botao "🌍 Cadastrar destinos" no header pra atalho a /portal-destinations. EDIT MODAL: max-height 90vh + flexbox column com scroll interno (antes ocupava 100% em telas menores ficando sem como fechar); backdrop-click fecha; Tipo removido daqui tambem.',
    bucket:         'large',
    multiplierIds: ['migration'],
    profile:        'feature',
    humanHours:     5.5,
    completedAt:    new Date('2026-05-12T17:00:00-03:00'),
  },
  {
    releaseVersion: '4.40.6',
    releaseSlug:    '20260512-image-bank-followups',
    title:          'Banco de Imagens: sticky bar de verdade, scrollbar visivel, Trem com loc',
    summary:        'Tres followups pos-feedback do user. STICKY BAR: 4.40.5 colocou position:sticky mas .card tem overflow:hidden que cria containing block, fazendo a sticky PARAR de funcionar quando o pai sai da viewport. Fix: overflow:visible no card especifico do upload. EDIT MODAL: overflow-y:auto -> overflow-y:scroll (forca barra sempre presente) + CSS injetado com ::-webkit-scrollbar custom (12px de largura, thumb cor visivel, hover dourado) + scrollbar-gutter:stable evita reflow ao scroll iniciar — resolve macOS auto-hide. TREM: showLocation "continent" -> "full" (continente/pais/cidade VISIVEIS mas opcionais, requiresLocation false). User decide o nivel de detalhe — atende rotas domesticas e internacionais (Eurostar).',
    bucket:         'small',
    multiplierIds: [],
    profile:        'bugfix',
    humanHours:     1.2,
    completedAt:    new Date('2026-05-12T18:00:00-03:00'),
  },
  {
    releaseVersion: '4.40.7',
    releaseSlug:    '20260512-sticky-bar-gap-fix',
    title:          'Banco de Imagens: fecha gap branco acima da sticky bar de upload',
    summary:        'Polish final: usuario reportou espaco em branco visivel acima da sticky action bar enquanto scrollava. Causa: .page-content tem padding-top:24px; position:sticky;top:0 gruda no edge INTERNO do padding -> 24px do bg da pagina (branco no tema light) ficavam visiveis acima da barra. Fix: box-shadow 0 -24px 0 var(--bg-surface) — solido 24px alto que estende o bg da bar pra cima visualmente, cobrindo o gap. Combinado com o shadow existente (0 2px 8px rgba(0,0,0,.18)) que separa do conteudo. Solucao puramente CSS sem reflows.',
    bucket:         'trivial',
    multiplierIds: [],
    profile:        'bugfix',
    humanHours:     0.4,
    completedAt:    new Date('2026-05-12T18:30:00-03:00'),
  },
];

const MULTIPLIERS = {
  investigation: 0.30, migration: 0.20, pdf: 0.15,
  integration: 0.20, security: 0.25, pure_refactor: -0.20,
};

function applyMultipliers(baseHours, ids = []) {
  let f = 1;
  for (const id of ids) f += (MULTIPLIERS[id] || 0);
  return Math.max(0.25, +(baseHours * f).toFixed(2));
}

function suggestBreakdown(totalHours, profile = 'feature') {
  const ratios = profile === 'bugfix'
    ? { refinamento: 0.30, desenvolvimento: 0.40, testes: 0.15, documentacao: 0.10, implantacao: 0.05 }
    : profile === 'docs'
    ? { refinamento: 0.10, desenvolvimento: 0.10, testes: 0.05, documentacao: 0.70, implantacao: 0.05 }
    : { refinamento: 0.20, desenvolvimento: 0.50, testes: 0.10, documentacao: 0.15, implantacao: 0.05 };
  const out = {}; let alloc = 0;
  for (const k of Object.keys(ratios)) { out[k] = +(totalHours * ratios[k]).toFixed(2); alloc += out[k]; }
  const diff = +(totalHours - alloc).toFixed(2);
  if (diff !== 0) out.desenvolvimento = +(out.desenvolvimento + diff).toFixed(2);
  return out;
}

(async () => {
  console.log(`Seeding ${RELEASES.length} releases (4.40.0-7)...\n`);
  const col = db.collection('dev_hours');
  let created = 0, updated = 0, totalH = 0, totalC = 0;

  for (const r of RELEASES) {
    const humanHours = applyMultipliers(r.humanHours, r.multiplierIds || []);
    const totalHours = Math.max(0.1, +(humanHours * AI_MULT).toFixed(2));
    const totalCost  = +(totalHours * HOURLY_RATE).toFixed(2);
    const breakdown  = suggestBreakdown(totalHours, r.profile);
    totalH += totalHours; totalC += totalCost;

    const doc = {
      entryType:              'release',
      releaseVersion:         r.releaseVersion,
      releaseSlug:            r.releaseSlug,
      title:                  r.title,
      summary:                r.summary,
      bucket:                 r.bucket,
      multiplierIds:          r.multiplierIds || [],
      profile:                r.profile,
      humanEquivalentHours:   humanHours,
      aiAssistanceMultiplier: AI_MULT,
      totalHours,
      totalCost,
      hourlyRate:             HOURLY_RATE,
      hoursByCategory:        breakdown,
      status:                 'approved',
      completedAt:            admin.firestore.Timestamp.fromDate(r.completedAt),
      approvedAt:             admin.firestore.FieldValue.serverTimestamp(),
      approvedBy:             { uid: 'seed-script', name: 'Seed (CLI)' },
      createdAt:              admin.firestore.FieldValue.serverTimestamp(),
      createdBy:              { uid: 'seed-script', name: 'Seed (CLI)' },
    };

    const existing = await col.where('releaseVersion', '==', r.releaseVersion).limit(1).get();
    if (!existing.empty) {
      await existing.docs[0].ref.update({ ...doc, createdAt: existing.docs[0].data().createdAt, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      updated++;
      console.log(`  ${r.releaseVersion}: ${totalHours}h, R$ ${totalCost.toFixed(2)} (atualizado)`);
    } else {
      await col.add(doc);
      created++;
      console.log(`  ${r.releaseVersion}: ${totalHours}h, R$ ${totalCost.toFixed(2)} (criado)`);
    }
  }

  console.log(`\n${created} criadas, ${updated} atualizadas`);
  console.log(`TOTAL: ${totalH.toFixed(2)}h, R$ ${totalC.toFixed(2)}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
