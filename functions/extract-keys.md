# Extração segura das keys atuais (1× só)

## Passo 1 — Extrair keys do Firestore

Abre **DevTools** (F12) no Chrome com PRIMETOUR aberto (logado como master) e cola no Console:

```js
import('/tarefas/js/firebase.js?cb=' + Date.now()).then(({db}) =>
  import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js').then(async fs => {
    const cfg = await fs.getDoc(fs.doc(db, 'system_config', 'ai-config'));
    const sp  = await fs.getDoc(fs.doc(db, 'system_config', 'sharepoint-app'));
    const gh  = await fs.getDoc(fs.doc(db, 'system_config', 'github'));
    const c = cfg.exists() ? cfg.data() : {};
    const s = sp.exists() ? sp.data() : {};
    const g = gh.exists() ? gh.data() : {};
    // Gera comandos prontos pra colar no terminal
    const cmds = [];
    const proj = '--project gestor-de-tarefas-primetour';
    if (c.geminiApiKey)   cmds.push(`echo "${c.geminiApiKey}"   | firebase functions:secrets:set GEMINI_API_KEY ${proj}`);
    if (c.groqApiKey)     cmds.push(`echo "${c.groqApiKey}"     | firebase functions:secrets:set GROQ_API_KEY ${proj}`);
    if (c.openaiApiKey)   cmds.push(`echo "${c.openaiApiKey}"   | firebase functions:secrets:set OPENAI_API_KEY ${proj}`);
    if (c.anthropicApiKey)cmds.push(`echo "${c.anthropicApiKey}"| firebase functions:secrets:set ANTHROPIC_API_KEY ${proj}`);
    if (s.tenantId)       cmds.push(`echo "${s.tenantId}"       | firebase functions:secrets:set SHAREPOINT_TENANT_ID ${proj}`);
    if (s.clientId)       cmds.push(`echo "${s.clientId}"       | firebase functions:secrets:set SHAREPOINT_CLIENT_ID ${proj}`);
    if (s.clientSecret)   cmds.push(`echo "${s.clientSecret}"   | firebase functions:secrets:set SHAREPOINT_CLIENT_SECRET ${proj}`);
    if (g.token)          cmds.push(`echo "${g.token}"          | firebase functions:secrets:set GITHUB_PAT ${proj}`);
    // Token R2 hardcoded no código (rotacionar antes!)
    cmds.push(`echo "primetour2026-imagens-secreto-xk9q" | firebase functions:secrets:set R2_UPLOAD_TOKEN ${proj}`);
    console.log('=== COLE NO TERMINAL: ===\n\n' + cmds.join('\n\n') + '\n');
    // Copia automaticamente
    navigator.clipboard.writeText(cmds.join('\n')).then(() =>
      console.log('✓ Comandos copiados pro clipboard.'));
  }));
```

## Passo 2 — Cole no terminal (no diretório raiz do projeto)

```bash
cd "/Users/rene/Downloads/GESTOR DE TAREFAS PRIMETOUR/V11"
# Cola o que copiou (Cmd+V)
```

Cada linha vai pedir confirmação `[y/N]` quando criar nova versão do secret — digite `y`.

## Passo 3 — Deploy functions

```bash
firebase deploy --only functions --project gestor-de-tarefas-primetour
```

Isso vai demorar uns 2-3 minutos. O output mostra as URLs das funções no final.

## Passo 4 — Verifica

```bash
firebase functions:log --project gestor-de-tarefas-primetour | tail -20
```

E no app, qualquer chamada IA agora vai pelo Cloud Function (transparente — `chatWithAI` detecta automaticamente).

---

## (Opcional) Rotação de keys

Se quiser **rotacionar TODAS as keys agora** (recomendado pra seguir SOC2):

1. **Anthropic**: https://console.anthropic.com/settings/keys → Create Key → Revoke old
2. **OpenAI**: https://platform.openai.com/api-keys → + Create → Revoke old
3. **Gemini**: https://aistudio.google.com/apikey → Create API Key → Delete old
4. **Groq**: https://console.groq.com/keys → Create → Revoke old
5. **R2 Worker token**: edita o Worker no Cloudflare Dashboard → variable `UPLOAD_TOKEN` → novo valor
6. **SharePoint**: Azure Portal → App Registration → Certificates & secrets → New secret → delete old

Depois roda os comandos do Passo 1-2 com as **NOVAS keys** (substitua os valores antes de colar no terminal).
