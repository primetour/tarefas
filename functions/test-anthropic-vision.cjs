/**
 * Smoke test VISION: imagem base64 → callAnthropic com image block
 * Valida que o pipeline multimodal funciona ponta-a-ponta.
 */
const { execSync } = require('child_process');

function getSecret(name) {
  return execSync(
    `gcloud secrets versions access latest --secret=${name} --project=gestor-de-tarefas-primetour`,
    { encoding: 'utf-8' }
  ).trim();
}

// Imagem 5x5 vermelha PNG (mínima válida)
const RED_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';

(async () => {
  const apiKey = getSecret('ANTHROPIC_API_KEY');
  console.log(`✓ Key carregada (${apiKey.length} chars)`);
  console.log('\n🖼  Teste vision: descrever imagem vermelha 5x5');

  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: RED_PNG_B64 } },
        { type: 'text', text: 'Que cor predomina nessa imagem? Responda em 1 palavra.' },
      ],
    }],
  };

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    console.log('❌ Vision:', r.status, await r.text());
    process.exit(1);
  }
  const d = await r.json();
  console.log(`✓ Resposta: "${d.content?.[0]?.text?.trim()}" (model: ${d.model})`);
  console.log(`  Tokens: ${d.usage?.input_tokens} in / ${d.usage?.output_tokens} out`);
  console.log('\n✅ Vision OK — pipeline multimodal funcionando');
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
