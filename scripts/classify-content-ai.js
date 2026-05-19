/**
 * Classificação dupla via AGENTE IA — Shadow Mode.
 * v4.49.41+
 *
 * MOTIVAÇÃO
 *   A classificação determinística em scripts/classify-content.js usa regex
 *   curados (cobertura ~92% nos dois eixos). Limitações:
 *     - Subjects novos com vocabulário não previsto caem em "inspiracional/outros"
 *     - Manutenção dos patterns é manual
 *     - Não generaliza pra novas BUs ou novos eixos sem novo deploy
 *
 *   Este script roda o AGENTE 'nl-content-classifier' (registrado no IA Hub
 *   via SYSTEM_SEED_AGENTS) em SHADOW MODE: grava o veredito da IA em campos
 *   PARALELOS (extracted.ai*) sem tocar nos campos de produção (extracted.commercial
 *   / extracted.tourism, que continuam vindo do regex). Permite comparar
 *   empiricamente antes de promover.
 *
 * FLUXO
 *   1. Lê o agente nl-content-classifier do Firestore (collection ai_agents)
 *      via filtro migratedFrom.systemSeed='nl-content-classifier'.
 *   2. Se !agent.active → log e exit 0 (RESPEITA o toggle do IA Hub).
 *      Isso é o KILL SWITCH: pausar o agente no Hub desliga o cron.
 *   3. Itera mc_performance buscando docs sem `extracted.aiClassifiedAt`
 *      (ou com versão de agente antiga — pra reclassificar quando prompt muda).
 *   4. Pra cada doc: monta payload { buId, subject, name, htmlText, extracted },
 *      chama api.anthropic.com/v1/messages com cache_control no system prompt
 *      (cache hit cobra ~10% do input — desconto de 90% de prompt caching),
 *      parse do JSON retornado, grava extracted.aiCommercial/aiTourism/...
 *   5. Concorrência: 3 chamadas em paralelo (rate limit Anthropic é generoso,
 *      mas é a primeira execução em escala — começa cauteloso).
 *   6. Skip se já tem aiClassifiedAt da MESMA versão de agente (idempotente).
 *   7. Grava resumo em nl_ai_classifier_runs pra dashboard de shadow mode.
 *
 * CAMPOS GRAVADOS EM extracted (NÃO sobrescreve os de produção)
 *   aiCommercial      - 'sazonal'|'promocao'|'parceiro'|'inspiracional'
 *   aiTourism         - 'evento'|'aereo'|...|'outros'
 *   aiConfidence      - 'high'|'medium'|'low'
 *   aiReasoning       - string curta com o gatilho que decidiu
 *   aiModel           - ex: 'claude-haiku-4-5'
 *   aiAgentVersion    - hash/marker do agente (pra detectar prompt changes)
 *   aiClassifiedAt    - ISO timestamp
 *   aiAgreesCommercial - bool: aiCommercial === commercial (quando há regex)
 *   aiAgreesTourism    - bool: aiTourism === tourism (quando há regex)
 *
 * SAÍDA NÃO-DESTRUTIVA
 *   NUNCA toca em: extracted.commercial, extracted.tourism, extracted.cities,
 *   extracted.countries, extracted.brands, extracted.hotels, extracted.cruises.
 *
 * ENV (CI ou local)
 *   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY (admin SDK)
 *   ANTHROPIC_API_KEY (sk-ant-...)
 *
 * FLAGS
 *   --dry     - mostra o que seria gravado, não grava
 *   --limit N - processa só os N primeiros docs do recorte
 *   --force   - reclassifica mesmo docs já com aiClassifiedAt
 *   --verbose - log de cada doc (default só log de erros + sumário)
 */

const admin = require('firebase-admin');
const crypto = require('crypto');

// ── Init Admin SDK ────────────────────────────────────────────
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
} else {
  admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
}
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

// ── Flags ─────────────────────────────────────────────────────
const DRY     = process.argv.includes('--dry');
const FORCE   = process.argv.includes('--force');
const VERBOSE = process.argv.includes('--verbose');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : null;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL     = 'https://api.anthropic.com/v1/messages';

// Categorias válidas — espelha o systemPrompt do agente. Defesa contra
// LLM inventar categoria nova: se retornar algo fora dessa lista, marca
// como erro (não grava).
const COMMERCIAL_VALUES = ['sazonal', 'promocao', 'parceiro', 'inspiracional'];
const TOURISM_VALUES    = ['evento','aereo','roteiro','servico','hotelaria','cruzeiro','produto','destino','outros'];

// ── Fetch do agente ────────────────────────────────────────────
async function loadAgent() {
  const snap = await db.collection('ai_agents')
    .where('migratedFrom.systemSeed', '==', 'nl-content-classifier')
    .limit(1)
    .get();
  if (snap.empty) {
    throw new Error('Agente nl-content-classifier não encontrado em ai_agents. ' +
      'Rode "Recriar agentes-seed" no IA Hub primeiro.');
  }
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// Versão = hash do (model + systemPrompt). Se o prompt mudar no IA Hub,
// a versão muda e os docs antigos viram candidatos a reclassificar.
function agentVersion(agent) {
  const fingerprint = `${agent.model}|${agent.systemPrompt || ''}`;
  return 'a-' + crypto.createHash('sha1').update(fingerprint).digest('hex').slice(0, 10);
}

// ── Chamada à Anthropic com prompt caching ─────────────────────
// Cache hit cobra ~10% do input → economia massiva em runs repetidas.
async function callClaude(agent, payload, attempt = 1) {
  const systemPrompt = agent.systemPrompt || '';
  // cache_control só se o prompt for grande o suficiente pra valer a pena.
  // O nosso tem ~7k chars, sempre cacheia.
  const useCache = systemPrompt.length >= 1024;
  const systemField = useCache
    ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
    : systemPrompt;

  const body = {
    model: agent.model || 'claude-haiku-4-5',
    system: systemField,
    messages: [
      { role: 'user', content: JSON.stringify(payload) },
    ],
    max_tokens: agent.limits?.maxTokensPerRun || 512,
    temperature: agent.limits?.temperature ?? 0.1,
  };

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429 || res.status >= 500) {
    if (attempt > 3) throw new Error(`Anthropic ${res.status} após 3 tentativas`);
    const wait = 1500 * attempt;
    await new Promise(r => setTimeout(r, wait));
    return callClaude(agent, payload, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text || '')
    .join('');
  return {
    text,
    inputTokens:         data.usage?.input_tokens || 0,
    outputTokens:        data.usage?.output_tokens || 0,
    cacheReadTokens:     data.usage?.cache_read_input_tokens || 0,
    cacheCreationTokens: data.usage?.cache_creation_input_tokens || 0,
  };
}

// Parse seguro: LLM às vezes vem com ```json wrapper ou texto extra.
function parseClaudeJson(text) {
  if (!text) throw new Error('resposta vazia');
  // Remove fence ```json ... ```
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  // Pega só o primeiro {...} se houver lixo antes/depois
  const m = t.match(/\{[\s\S]*\}/);
  if (m) t = m[0];
  return JSON.parse(t);
}

// Valida resposta — defesa contra LLM inventar categoria.
function validateOutput(out) {
  if (!out || typeof out !== 'object') throw new Error('output não é objeto');
  if (!COMMERCIAL_VALUES.includes(out.commercial)) {
    throw new Error(`commercial inválido: ${out.commercial}`);
  }
  if (!TOURISM_VALUES.includes(out.tourism)) {
    throw new Error(`tourism inválido: ${out.tourism}`);
  }
  if (!['high','medium','low'].includes(out.confidence)) {
    out.confidence = 'medium';
  }
  out.reasoning = String(out.reasoning || '').slice(0, 400);
  return out;
}

// ── Construção do payload pro agente ───────────────────────────
function buildPayload(doc, buId) {
  const ex = doc.extracted || {};
  // htmlText pode estar enorme. Truncamos pra não estourar contexto e custo.
  const htmlText = String(doc.htmlText || '').slice(0, 4000);
  return {
    buId: buId || doc.buId || 'primetour',
    subject: doc.subject || '',
    name:    doc.name || '',
    htmlText,
    extracted: {
      countries: ex.countries || [],
      cities:    ex.cities || [],
      hotels:    (ex.hotels || []).map(h => typeof h === 'string' ? h : (h?.name || '')).filter(Boolean),
      brands:    ex.brands || [],
      cruises:   (ex.cruises || []).map(c => typeof c === 'string' ? c : (c?.name || '')).filter(Boolean),
    },
  };
}

// ── Filtro de docs a classificar ───────────────────────────────
// Critérios:
//   - Tem extracted (foi enriquecido) — não classifica doc cru
//   - Skip se já tem aiClassifiedAt com a MESMA aiAgentVersion (idempotente)
//   - --force ignora idempotência (reclassifica TUDO)
function shouldClassify(doc, currentVersion) {
  const ex = doc.extracted || {};
  if (!ex || Object.keys(ex).length === 0) return false; // ainda não enriquecido
  if (FORCE) return true;
  if (!ex.aiClassifiedAt) return true;
  // Re-classifica se a versão do agente mudou (prompt foi editado no IA Hub)
  if (ex.aiAgentVersion !== currentVersion) return true;
  return false;
}

// ── Concorrência limitada ──────────────────────────────────────
async function processInChunks(items, concurrency, worker) {
  const results = [];
  let cursor = 0;
  async function next() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (e) {
        results[i] = { error: e.message };
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => next()));
  return results;
}

// ── Main ───────────────────────────────────────────────────────
(async () => {
  console.log(`${DRY ? '🔍 DRY-RUN' : '✏  ESCREVENDO'} · Classificador IA (shadow mode) v4.49.41`);
  if (!ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY não está no env. Configure em GitHub Secrets.');
    process.exit(1);
  }

  // 1. Carrega agente
  let agent;
  try {
    agent = await loadAgent();
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }

  // 2. KILL SWITCH: respeita o toggle do IA Hub.
  //    Pausar o agente no Hub desliga o cron sem precisar mexer no workflow.
  if (agent.active === false) {
    console.log(`⏸  Agente "${agent.name}" está PAUSADO no IA Hub. Saindo sem rodar.`);
    console.log(`   (Pra ativar: IA Hub → editar agente → active=true OU clicar ▶)`);
    process.exit(0);
  }

  const currentVersion = agentVersion(agent);
  console.log(`📋 Agente: ${agent.name}`);
  console.log(`   provider=${agent.provider} model=${agent.model}`);
  console.log(`   versão=${currentVersion} (hash de model+systemPrompt)`);
  console.log(`   temperature=${agent.limits?.temperature ?? 0.1} maxTokens=${agent.limits?.maxTokensPerRun || 512}`);

  // 3. Busca docs pra classificar
  const snap = await db.collection('mc_performance').get();
  const allDocs = snap.docs.map(d => ({ _id: d.id, _ref: d.ref, ...d.data() }));
  console.log(`📚 Total no Firestore: ${allDocs.length} docs`);

  let candidates = allDocs.filter(d => shouldClassify(d, currentVersion));
  if (LIMIT && candidates.length > LIMIT) {
    console.log(`✂  Limit aplicado: ${LIMIT} de ${candidates.length}`);
    candidates = candidates.slice(0, LIMIT);
  }
  console.log(`🎯 Candidatos a classificar: ${candidates.length}`);
  if (!candidates.length) {
    console.log(`✓ Nada a fazer. Saindo.`);
    process.exit(0);
  }

  // 4. Loop com concorrência limitada
  const stats = {
    classified: 0, skipped: 0, errors: 0,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
    agreesCommercial: 0, agreesTourism: 0, agreesBoth: 0,
    confDist: { high: 0, medium: 0, low: 0 },
    commercialDist: { sazonal: 0, promocao: 0, parceiro: 0, inspiracional: 0 },
    tourismDist:    { evento: 0, aereo: 0, roteiro: 0, servico: 0, hotelaria: 0, cruzeiro: 0, produto: 0, destino: 0, outros: 0 },
    disagreementsCommercial: [],  // top divergências comerciais
    disagreementsTourism: [],     // top divergências turismo
  };
  const startedAt = Date.now();

  await processInChunks(candidates, 3, async (doc, i) => {
    const buId = doc.buId;
    const payload = buildPayload(doc, buId);
    try {
      const resp = await callClaude(agent, payload);
      stats.inputTokens     += resp.inputTokens;
      stats.outputTokens    += resp.outputTokens;
      stats.cacheReadTokens += resp.cacheReadTokens;

      const out = validateOutput(parseClaudeJson(resp.text));
      stats.commercialDist[out.commercial]++;
      stats.tourismDist[out.tourism]++;
      stats.confDist[out.confidence]++;

      // Compara com regex de produção (se houver)
      const exProd = doc.extracted || {};
      const agreesC = exProd.commercial && exProd.commercial === out.commercial;
      const agreesT = exProd.tourism    && exProd.tourism    === out.tourism;
      if (agreesC) stats.agreesCommercial++;
      if (agreesT) stats.agreesTourism++;
      if (agreesC && agreesT) stats.agreesBoth++;

      // Coleta amostras de divergência (10 primeiras de cada eixo)
      if (exProd.commercial && !agreesC && stats.disagreementsCommercial.length < 10) {
        stats.disagreementsCommercial.push({
          subject: doc.subject || '', name: doc.name || '',
          regex: exProd.commercial, ai: out.commercial,
          confidence: out.confidence, reasoning: out.reasoning,
        });
      }
      if (exProd.tourism && !agreesT && stats.disagreementsTourism.length < 10) {
        stats.disagreementsTourism.push({
          subject: doc.subject || '', name: doc.name || '',
          regex: exProd.tourism, ai: out.tourism,
          confidence: out.confidence, reasoning: out.reasoning,
        });
      }

      if (VERBOSE) {
        const tag = (agreesC && agreesT) ? '✓' : (agreesC || agreesT) ? '~' : '✗';
        console.log(`  ${tag} ${doc.name || doc._id} → C:${out.commercial} T:${out.tourism} (${out.confidence})`);
      }

      // 5. Grava (não-destrutivo: SÓ campos ai*)
      if (!DRY) {
        await doc._ref.update({
          'extracted.aiCommercial':     out.commercial,
          'extracted.aiTourism':        out.tourism,
          'extracted.aiConfidence':     out.confidence,
          'extracted.aiReasoning':      out.reasoning,
          'extracted.aiModel':          agent.model,
          'extracted.aiAgentVersion':   currentVersion,
          'extracted.aiClassifiedAt':   new Date().toISOString(),
          'extracted.aiAgreesCommercial': !!agreesC,
          'extracted.aiAgreesTourism':    !!agreesT,
        });
      }
      stats.classified++;
    } catch (e) {
      stats.errors++;
      console.error(`  ✗ ${doc.name || doc._id}: ${e.message}`);
    }
  });

  const elapsedMs = Date.now() - startedAt;

  // 6. Resumo
  const totalAgreed = stats.classified > 0 ? stats.agreesBoth : 0;
  const concC = stats.classified > 0 ? (stats.agreesCommercial / stats.classified * 100).toFixed(1) : '—';
  const concT = stats.classified > 0 ? (stats.agreesTourism    / stats.classified * 100).toFixed(1) : '—';
  const concBoth = stats.classified > 0 ? (totalAgreed / stats.classified * 100).toFixed(1) : '—';

  console.log(`\n══════════════════════════════════════════`);
  console.log(`📊 Sumário (${(elapsedMs/1000).toFixed(1)}s)`);
  console.log(`══════════════════════════════════════════`);
  console.log(`  Classificados: ${stats.classified}`);
  console.log(`  Erros:         ${stats.errors}`);
  console.log(`  Tokens: input=${stats.inputTokens.toLocaleString('pt-BR')} cached=${stats.cacheReadTokens.toLocaleString('pt-BR')} output=${stats.outputTokens.toLocaleString('pt-BR')}`);
  console.log(`\n  Concordância com regex (shadow):`);
  console.log(`    Comercial:    ${concC}%  (${stats.agreesCommercial}/${stats.classified})`);
  console.log(`    Turismo:      ${concT}%  (${stats.agreesTourism}/${stats.classified})`);
  console.log(`    Ambos eixos:  ${concBoth}%`);
  console.log(`\n  Distribuição comercial IA:`, stats.commercialDist);
  console.log(`  Distribuição turismo IA:`,    stats.tourismDist);
  console.log(`  Confiança:`, stats.confDist);

  // 7. Grava sumário no Firestore pro dashboard de shadow mode
  if (!DRY) {
    await db.collection('nl_ai_classifier_runs').add({
      runAt:           FV.serverTimestamp(),
      agentId:         agent.id,
      agentVersion:    currentVersion,
      model:           agent.model,
      classified:      stats.classified,
      errors:          stats.errors,
      elapsedMs,
      inputTokens:     stats.inputTokens,
      cacheReadTokens: stats.cacheReadTokens,
      outputTokens:    stats.outputTokens,
      agreesCommercial: stats.agreesCommercial,
      agreesTourism:    stats.agreesTourism,
      agreesBoth:       stats.agreesBoth,
      concordanceCommercialPct: stats.classified > 0 ? +(stats.agreesCommercial / stats.classified * 100).toFixed(2) : null,
      concordanceTourismPct:    stats.classified > 0 ? +(stats.agreesTourism    / stats.classified * 100).toFixed(2) : null,
      concordanceBothPct:       stats.classified > 0 ? +(totalAgreed           / stats.classified * 100).toFixed(2) : null,
      commercialDist: stats.commercialDist,
      tourismDist:    stats.tourismDist,
      confDist:       stats.confDist,
      disagreementsCommercialSample: stats.disagreementsCommercial,
      disagreementsTourismSample:    stats.disagreementsTourism,
      triggeredBy: process.env.GITHUB_RUN_ID ? `github-actions:${process.env.GITHUB_RUN_ID}` : 'local',
    });
  }

  console.log(`\n${DRY ? '(dry-run, nada gravado)' : '✓ Resumo gravado em nl_ai_classifier_runs'}`);
  process.exit(0);
})().catch(e => {
  console.error(`💥 Falha fatal: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
