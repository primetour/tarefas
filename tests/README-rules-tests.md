# Firestore Rules Regression Tests

Roda testes contra o **Firestore Emulator** local pra garantir que mudanças
em `firestore.rules` não introduzam vulnerabilidades.

## Setup (uma vez)

```bash
cd tests
npm install --save-dev @firebase/rules-unit-testing firebase
```

## Rodar

```bash
# Terminal 1: emulator
firebase emulators:start --only firestore --project=primetour-rules-test

# Terminal 2: testes
node --test firestore-rules.test.mjs
```

## CI/CD (futuro)

Adicionar em `.github/workflows/security-tests.yml`:

```yaml
name: Security Tests
on: [push, pull_request]
jobs:
  rules-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm install -g firebase-tools
      - run: cd tests && npm install
      - run: |
          firebase emulators:exec --only firestore \
            --project=primetour-rules-test \
            "node --test firestore-rules.test.mjs"
```

## O que cobrem

Cada teste cobre um vetor de ataque conhecido (alinhado com THREAT-MODEL.md):

| Categoria | Vetor | Status |
|-----------|-------|--------|
| Sensitive read | anon/member lê system_secrets | ✅ deny |
| Sensitive read | admin lê system_secrets (zero-trust) | ✅ deny |
| Sensitive read | member lê ai_api_keys | ✅ deny |
| Rate limit | user limpa contador rate_limits | ✅ deny |
| Privilege escalation | member sobe pra admin via merge | ✅ deny |
| Cross-tenant | user A modifica dado de user B | ✅ deny |
| Audit immutability | qualquer um modifica audit_logs | ✅ deny |

## Adicionar testes

Pra cada nova rule sensível em `firestore.rules`, adicionar um teste em
`firestore-rules.test.mjs` cobrindo o cenário positivo (quem PODE) e negativo
(quem NÃO pode). Padrão: `assertSucceeds()` / `assertFails()`.
