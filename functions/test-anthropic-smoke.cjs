/**
 * Smoke test: chama Anthropic API com a key do Secret Manager
 * via Cloud Function callLLM (simulação direta com gcloud secret).
 *
 * Roda LOCAL com a key vindo do gcloud secrets, NUNCA logando a key.
 */
const { execSync } = require('child_process');

function getSecret(name) {
  return execSync(
    `gcloud secrets versions access latest --secret=${name} --project=gestor-de-tarefas-primetour`,
    { encoding: 'utf-8' }
  ).trim();
}

(async () => {
  const apiKey = getSecret('ANTHROPIC_API_KEY');
  console.log(`✓ Key carregada do Secret Manager (${apiKey.length} chars, sk-ant-***)`);

  // Teste 1: chamada texto simples
  console.log('\n📝 Teste 1: texto puro');
  const r1 = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Responda em 1 palavra: capital do Brasil?' }],
    }),
  });
  if (!r1.ok) {
    console.log('❌ Texto:', r1.status, await r1.text());
    process.exit(1);
  }
  const d1 = await r1.json();
  console.log(`✓ Resposta: "${d1.content?.[0]?.text?.trim()}" (model: ${d1.model})`);
  console.log(`  Tokens: ${d1.usage?.input_tokens} in / ${d1.usage?.output_tokens} out`);

  // Teste 2: web search nativo
  console.log('\n🌐 Teste 2: web search nativo');
  const r2 = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
      messages: [{ role: 'user', content: 'Qual a cotação do dólar hoje? Responda em 1 frase.' }],
    }),
  });
  if (!r2.ok) {
    console.log('⚠ Web search:', r2.status, await r2.text().then(t => t.slice(0, 300)));
  } else {
    const d2 = await r2.json();
    const textBlocks = (d2.content || []).filter(b => b.type === 'text').map(b => b.text || '');
    const searches = (d2.content || []).filter(b => b.type === 'server_tool_use' && b.name === 'web_search');
    console.log(`✓ Resposta: "${textBlocks.join(' ').trim().slice(0, 200)}"`);
    console.log(`  Buscas: ${searches.length} · Tokens: ${d2.usage?.input_tokens} in / ${d2.usage?.output_tokens} out`);
  }

  console.log('\n✅ Smoke OK — key Anthropic operacional + web search nativo funcionando');
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
