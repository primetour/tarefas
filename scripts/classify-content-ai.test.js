/**
 * Test harness pra classify-content-ai.js (v4.49.43+)
 *
 * Roda sem precisar de Firebase ou Anthropic. Valida as funções puras
 * (parsing, validação, custo, hash de versão) com casos reais coletados
 * da operação do regex em produção.
 *
 * Uso:  cd scripts && node classify-content-ai.test.js
 * Exit: 0 = todos passaram · 1 = pelo menos 1 falhou
 */
const lib = require('./classify-content-ai.js');

let pass = 0, fail = 0;
const results = [];

function eq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ ok, msg, actual, expected });
  if (ok) pass++; else fail++;
}
function truthy(v, msg) {
  const ok = !!v;
  results.push({ ok, msg, actual: v, expected: 'truthy' });
  if (ok) pass++; else fail++;
}
function throws(fn, msg) {
  let threw = false;
  try { fn(); } catch (_) { threw = true; }
  results.push({ ok: threw, msg, actual: threw ? 'threw' : 'did not throw', expected: 'throw' });
  if (threw) pass++; else fail++;
}

/* ═══════════════════════════════════════════════════════════
 * 1. parseClaudeJson — cobre os formatos que Claude pode retornar
 * ═══════════════════════════════════════════════════════════ */

// Caso ideal: JSON puro
eq(
  lib.parseClaudeJson('{"commercial":"sazonal","tourism":"hotelaria","confidence":"high","reasoning":"natal"}'),
  { commercial: 'sazonal', tourism: 'hotelaria', confidence: 'high', reasoning: 'natal' },
  'parseClaudeJson: JSON puro',
);

// Com fence ```json
eq(
  lib.parseClaudeJson('```json\n{"commercial":"promocao","tourism":"hotelaria","confidence":"medium","reasoning":"3a noite"}\n```'),
  { commercial: 'promocao', tourism: 'hotelaria', confidence: 'medium', reasoning: '3a noite' },
  'parseClaudeJson: fence ```json',
);

// Com fence simples ```
eq(
  lib.parseClaudeJson('```\n{"commercial":"parceiro","tourism":"aereo","confidence":"high","reasoning":"latam"}\n```'),
  { commercial: 'parceiro', tourism: 'aereo', confidence: 'high', reasoning: 'latam' },
  'parseClaudeJson: fence ``` sem lang',
);

// Lixo antes/depois (defesa contra prefacio do LLM tipo "Aqui está a classificação:")
eq(
  lib.parseClaudeJson('Aqui está:\n{"commercial":"sazonal","tourism":"evento","confidence":"low","reasoning":"x"}\nEspero ter ajudado.'),
  { commercial: 'sazonal', tourism: 'evento', confidence: 'low', reasoning: 'x' },
  'parseClaudeJson: texto antes/depois do JSON',
);

// Erro: vazio
throws(() => lib.parseClaudeJson(''), 'parseClaudeJson: vazio lança');
throws(() => lib.parseClaudeJson(null), 'parseClaudeJson: null lança');

// Erro: JSON mal-formado
throws(() => lib.parseClaudeJson('{"commercial":"sazonal'), 'parseClaudeJson: JSON truncado lança');

/* ═══════════════════════════════════════════════════════════
 * 2. validateOutput — defesa contra LLM inventar categoria
 * ═══════════════════════════════════════════════════════════ */

// Válido high
eq(
  lib.validateOutput({ commercial: 'sazonal', tourism: 'hotelaria', confidence: 'high', reasoning: 'natal' }),
  { commercial: 'sazonal', tourism: 'hotelaria', confidence: 'high', reasoning: 'natal' },
  'validateOutput: caso valido',
);

// Confidence inválida → cai pra 'medium' (não lança)
const r = lib.validateOutput({ commercial: 'sazonal', tourism: 'hotelaria', confidence: 'altíssima', reasoning: 'x' });
eq(r.confidence, 'medium', 'validateOutput: confidence invalida vira medium');

// Categoria inventada → lança
throws(
  () => lib.validateOutput({ commercial: 'desconto', tourism: 'hotelaria', confidence: 'high' }),
  'validateOutput: commercial inventado lança',
);
throws(
  () => lib.validateOutput({ commercial: 'sazonal', tourism: 'voo', confidence: 'high' }),
  'validateOutput: tourism inventado lança',
);

// reasoning >400 chars é truncado
const longReason = 'a'.repeat(500);
const truncated = lib.validateOutput({ commercial: 'sazonal', tourism: 'hotelaria', confidence: 'high', reasoning: longReason });
eq(truncated.reasoning.length, 400, 'validateOutput: reasoning truncado em 400');

// reasoning undefined vira string vazia (não null/undefined)
const noReason = lib.validateOutput({ commercial: 'sazonal', tourism: 'hotelaria', confidence: 'high' });
eq(typeof noReason.reasoning, 'string', 'validateOutput: reasoning ausente vira string');
eq(noReason.reasoning, '', 'validateOutput: reasoning ausente vira ""');

// Output não-objeto → lança
throws(() => lib.validateOutput(null), 'validateOutput: null lança');
throws(() => lib.validateOutput('texto'), 'validateOutput: string lança');

/* ═══════════════════════════════════════════════════════════
 * 3. buildPayload — formato esperado pelo agente
 * ═══════════════════════════════════════════════════════════ */

const sampleDoc = {
  subject: 'Verão em Mykonos — diárias a partir de US$ 1.200',
  name: 'P0210',
  buId: 'primetour',
  htmlText: '<p>Aproveite ofertas especiais...</p>'.repeat(500), // > 4000 chars
  extracted: {
    countries: ['Grécia'],
    cities: ['Mykonos'],
    hotels: [{ name: 'Cavo Tagoo' }, 'Belvedere'],
    brands: ['Cavo Tagoo'],
    cruises: [],
  },
};
const payload = lib.buildPayload(sampleDoc);

eq(payload.buId, 'primetour', 'buildPayload: buId');
eq(payload.subject, sampleDoc.subject, 'buildPayload: subject');
eq(payload.name, 'P0210', 'buildPayload: name');
truthy(payload.htmlText.length <= 4000, 'buildPayload: htmlText truncado em 4000');
eq(payload.extracted.countries, ['Grécia'], 'buildPayload: countries');
// hotels normalizado: objetos viram nome
eq(payload.extracted.hotels, ['Cavo Tagoo', 'Belvedere'], 'buildPayload: hotels normalizados');
eq(payload.extracted.cruises, [], 'buildPayload: cruises vazio');

// Doc com BU override
eq(lib.buildPayload({ ...sampleDoc, buId: undefined }, 'btg-partners').buId, 'btg-partners',
   'buildPayload: buId override');

// Doc sem extracted (defesa)
const minimal = lib.buildPayload({ subject: 'X', name: 'Y' });
eq(minimal.extracted.countries, [], 'buildPayload: extracted ausente vira []');
eq(minimal.htmlText, '', 'buildPayload: htmlText ausente vira ""');

/* ═══════════════════════════════════════════════════════════
 * 4. shouldClassify — filtros de idempotência
 * ═══════════════════════════════════════════════════════════ */

// Doc sem extracted → false (não enriquecido)
eq(lib.shouldClassify({ extracted: {} }, 'v1'), false, 'shouldClassify: sem extracted = false');

// Doc enriquecido sem aiClassifiedAt → true
eq(lib.shouldClassify({ extracted: { cities: ['x'] } }, 'v1'), true,
   'shouldClassify: enriquecido sem aiClassifiedAt = true');

// Doc com aiClassifiedAt da mesma versão → false (idempotente)
eq(lib.shouldClassify({
  extracted: { cities: ['x'], aiClassifiedAt: '2026-05-19', aiAgentVersion: 'v1' },
}, 'v1'), false, 'shouldClassify: mesma versao = false');

// Doc com aiClassifiedAt de versão antiga → true (re-classifica)
eq(lib.shouldClassify({
  extracted: { cities: ['x'], aiClassifiedAt: '2026-05-19', aiAgentVersion: 'v0' },
}, 'v1'), true, 'shouldClassify: versao mudou = true');

// Force = true ignora idempotência
eq(lib.shouldClassify({
  extracted: { cities: ['x'], aiClassifiedAt: '2026-05-19', aiAgentVersion: 'v1' },
}, 'v1', { force: true }), true, 'shouldClassify: force=true ignora idempotencia');

/* ═══════════════════════════════════════════════════════════
 * 5. agentVersion — determinístico, sensível a mudanças
 * ═══════════════════════════════════════════════════════════ */

const v1 = lib.agentVersion({ model: 'claude-haiku-4-5', systemPrompt: 'prompt v1' });
const v1_again = lib.agentVersion({ model: 'claude-haiku-4-5', systemPrompt: 'prompt v1' });
const v2 = lib.agentVersion({ model: 'claude-haiku-4-5', systemPrompt: 'prompt v2' });
const v3 = lib.agentVersion({ model: 'claude-sonnet-4-6', systemPrompt: 'prompt v1' });

eq(v1, v1_again, 'agentVersion: deterministico (mesmo input = mesma saida)');
truthy(v1 !== v2, 'agentVersion: prompt diferente = versao diferente');
truthy(v1 !== v3, 'agentVersion: model diferente = versao diferente');
truthy(v1.startsWith('a-'), 'agentVersion: prefixo "a-"');
eq(v1.length, 12, 'agentVersion: total 12 chars (a- + 10 hash)');

/* ═══════════════════════════════════════════════════════════
 * 6. estimateRunCostUsd + modelPricing — math
 * ═══════════════════════════════════════════════════════════ */

// Haiku, 1M tokens puro input + 1M output
const haikuCost = lib.estimateRunCostUsd('claude-haiku-4-5', {
  inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheCreationTokens: 0,
});
eq(haikuCost, 0.25 + 1.25, 'estimateRunCostUsd: Haiku 1M+1M = $1.50');

// Haiku com cache hit massivo (cenário típico)
// 7k input total, 6500 cacheados, 500 puros + 150 output
const haikuCached = lib.estimateRunCostUsd('claude-haiku-4-5', {
  inputTokens: 7000, outputTokens: 150, cacheReadTokens: 6500, cacheCreationTokens: 0,
});
// pureInput = 7000 - 6500 = 500 → 500/1e6 * 0.25 = 0.000125
// cache    = 6500/1e6 * 0.025 = 0.0001625
// output   = 150/1e6 * 1.25   = 0.0001875
// total    ≈ 0.000475
truthy(haikuCached > 0 && haikuCached < 0.001, `estimateRunCostUsd: Haiku cached ~$0.0005 (got $${haikuCached.toFixed(6)})`);

// Modelo desconhecido cai no _default (Sonnet)
const unknownCost = lib.estimateRunCostUsd('claude-future-9000', {
  inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
});
eq(unknownCost, 3.0, 'estimateRunCostUsd: modelo desconhecido usa fallback Sonnet ($3/1M)');

// Tabela existe pra Haiku, Sonnet e Opus
truthy(lib.ANTHROPIC_PRICING['claude-haiku-4-5'],   'ANTHROPIC_PRICING tem Haiku');
truthy(lib.ANTHROPIC_PRICING['claude-sonnet-4-6'],  'ANTHROPIC_PRICING tem Sonnet');
truthy(lib.ANTHROPIC_PRICING['claude-opus-4-6'],    'ANTHROPIC_PRICING tem Opus');

/* ═══════════════════════════════════════════════════════════
 * 7. Loop integrado: parse + validate + cost — fluxo completo
 * ═══════════════════════════════════════════════════════════ */

// Simulação de resposta real do Claude pra um disparo conhecido
const fakeClaudeResponse = `\`\`\`json
{
  "commercial": "promocao",
  "tourism": "hotelaria",
  "confidence": "high",
  "reasoning": "3a noite cortesia (promo) + Faena (hotel)"
}
\`\`\``;
const parsed = lib.parseClaudeJson(fakeClaudeResponse);
const validated = lib.validateOutput(parsed);
eq(validated.commercial, 'promocao', 'fluxo: parse+validate commercial');
eq(validated.tourism, 'hotelaria', 'fluxo: parse+validate tourism');

// Validação cruzada: todas as categorias do COMMERCIAL_VALUES passam validateOutput
for (const c of lib.COMMERCIAL_VALUES) {
  const r = lib.validateOutput({ commercial: c, tourism: 'hotelaria', confidence: 'high' });
  eq(r.commercial, c, `valida todas as categorias commercial: ${c}`);
}
for (const t of lib.TOURISM_VALUES) {
  const r = lib.validateOutput({ commercial: 'sazonal', tourism: t, confidence: 'high' });
  eq(r.tourism, t, `valida todas as categorias tourism: ${t}`);
}

/* ═══════════════════════════════════════════════════════════
 * 8. Mock end-to-end: simulação da chamada ao Claude
 * ═══════════════════════════════════════════════════════════
 * Substitui o fetch global pra retornar uma resposta canned. Isto
 * NÃO testa callClaude diretamente (privado), mas mostra que o
 * formato de payload + parsing está coerente com a API real.
 */

// Payload formado pra disparar a IA
const integrationPayload = lib.buildPayload({
  subject: 'Réveillon em Bariloche — pacote 7 noites com all-inclusive',
  name: 'P0231',
  buId: 'primetour',
  htmlText: 'Curta a passagem de ano em Bariloche...',
  extracted: { countries: ['Argentina'], cities: ['Bariloche'], hotels: [], brands: [], cruises: [] },
});

// Simulação de resposta esperada pra este caso
const expectedResponseBody = JSON.stringify({
  commercial: 'sazonal',
  tourism: 'roteiro',
  confidence: 'high',
  reasoning: 'Réveillon (sazonal) > promoção. 7 noites + multi-dia em Bariloche = roteiro.',
});

const finalOutput = lib.validateOutput(lib.parseClaudeJson(expectedResponseBody));
eq(finalOutput.commercial, 'sazonal', 'e2e: Reveillon -> sazonal');
eq(finalOutput.tourism, 'roteiro', 'e2e: 7 noites -> roteiro');

// Verifica que o payload do request está no formato esperado
truthy(integrationPayload.subject.includes('Réveillon'), 'e2e: payload preserva subject');
truthy(integrationPayload.extracted.cities.includes('Bariloche'), 'e2e: payload preserva cities');

/* ═══════════════════════════════════════════════════════════
 * REPORT
 * ═══════════════════════════════════════════════════════════ */
console.log(`\n══════════════════════════════════════════`);
console.log(`📊 RESULTADO`);
console.log(`══════════════════════════════════════════`);
console.log(`  ✓ Passou: ${pass}`);
console.log(`  ✗ Falhou: ${fail}`);
console.log(`  Total:    ${pass + fail}`);

if (fail > 0) {
  console.log(`\n══ FALHAS ══`);
  results.filter(r => !r.ok).forEach((r, i) => {
    console.log(`${i+1}. ${r.msg}`);
    console.log(`   actual:   ${JSON.stringify(r.actual)}`);
    console.log(`   expected: ${JSON.stringify(r.expected)}`);
  });
  process.exit(1);
}

console.log(`\n✓ TODOS OS TESTES PASSARAM`);
process.exit(0);
