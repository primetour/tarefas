/**
 * Testa se a app no Azure tem permissão User.Read.All pra ler foto de
 * usuários via Graph com client_credentials. Se sim, podemos popular
 * photoURL de todos no Firestore em um shot.
 */
const { execSync } = require('child_process');

function getSecret(name) {
  return execSync(
    `gcloud secrets versions access latest --secret=${name} --project=gestor-de-tarefas-primetour`,
    { encoding: 'utf-8' }
  ).trim();
}

async function getToken() {
  const tenantId = getSecret('GRAPH_TENANT_ID');
  const clientId = getSecret('GRAPH_CLIENT_ID');
  const clientSecret = getSecret('GRAPH_CLIENT_SECRET');
  const body = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Token ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

(async () => {
  const token = await getToken();
  console.log(`✓ Token obtido (${token.length} chars)\n`);

  const targets = [
    'rene.castro@primetour.com.br',
    'gabrielle.carreira@primetour.com.br',
    'rafaela.gouvea@primetour.com.br',
    'thiago.firmino@primetour.com.br',
  ];

  for (const email of targets) {
    const url = `https://graph.microsoft.com/v1.0/users/${email}/photo/$value`;
    process.stdout.write(`  Tentando ${email}: `);
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        console.log(`✓ OK (${(buf.byteLength/1024).toFixed(1)}KB)`);
      } else {
        const text = await res.text();
        console.log(`✗ ${res.status} ${text.slice(0, 200)}`);
      }
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
  }
})();
