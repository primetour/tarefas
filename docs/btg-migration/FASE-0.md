# Fase 0 — Preparação (CONCLUÍDA)

> Data: 2026-05-18 · Branch: `feat/btg-migration` · Owner: Renê / Tiago

## Objetivo
Preparar o workspace de migração do projeto BTG Pactual (Next.js 16, deploy Vercel) para dentro do Gestor PRIMETOUR (HTML vanilla + Firebase + Cloudflare Pages), sem tocar em produção.

## O que foi feito

| # | Ação | Resultado |
|---|---|---|
| 1 | Workspace de trabalho criado | `~/Documents/Codex/btg-migration/tarefas/` (clonado de `https://github.com/primetour/tarefas.git`, branch `main` em `4.48.3`) |
| 2 | Branch de migração criada | `feat/btg-migration` (a partir de `main`, sem commits ainda) |
| 3 | Alias Firebase staging adicionado | `.firebaserc` agora tem `staging → gestor-btg-lp-builder-staging` (default segue produção) |
| 4 | POC trazida do lab | `btg/` (25 MB, 23 HTMLs + 30+ módulos JS/CSS) copiado de `gestor-btg-lp-builder-lab-main` |
| 5 | Config Firebase do BTG isolada | Novo `btg/shared/btg-config.js` com `btgFirebaseConfig` e `BTG_COLLECTION = 'btg_ofertas_dev'`. `btg-firebase.js` agora importa daqui (e não mais de `/js/config.js`) |
| 6 | Smoke test local | Servidor `python3 -m http.server 8765` rodando; 3 homes + dashboard + arquivos shared retornam HTTP 200 |

## Estrutura do workspace

```
~/Documents/Codex/btg-migration/tarefas/
├── .firebaserc            (default: prod, staging: gestor-btg-lp-builder-staging)
├── .git/                  (clone do primetour/tarefas)
├── btg/                   ← novo, vindo da POC
│   ├── FIREBASE-SETUP.md
│   ├── FIRESTORE-SCHEMA.md
│   ├── partners/        index.html + concierge/ + beneficios/ + viagens/ + cruzeiros/
│   ├── ultrablue/       idem
│   ├── operadora/       index.html + oferta/
│   ├── dashboard/       nova-oferta/ (form conversacional)
│   ├── shared/          btg-firebase.js, btg-config.js (NOVO), btg-ofertas-service.js, ...
│   └── assets/          imagens por marca
└── (todo o resto do gestor intacto)
```

## Camada de isolamento ativa

| Camada | Como protege |
|---|---|
| **Branch separada** | `feat/btg-migration` — `main` não é tocada |
| **Workspace fora do download original** | `~/Documents/Codex/btg-migration/` — Downloads/tarefas-main-3 fica como referência |
| **`.firebaserc default` mantido em prod** | Qualquer `firebase deploy` sem flag continua indo pra prod (proposital — evita acidente) |
| **App Firebase com nome próprio** | `btg-app` (vs `[DEFAULT]` do gestor) — apps coexistem na mesma página sem colidir |
| **Coleção separada** | `btg_ofertas_dev` (vs `btg_ofertas` que será produção) |
| **Config BTG isolada** | `btg/shared/btg-config.js` próprio, não compartilha com `/js/config.js` |
| **Modo localStorage automático** | Enquanto `btg-config.js` tem placeholders, POC roda 100% em localStorage |

## O que falta pra ativar Firestore staging

A POC está rodando em modo **localStorage** (fallback automático). Pra ativar Firestore staging real, preencher 3 placeholders em [btg/shared/btg-config.js](../../btg/shared/btg-config.js):

```js
apiKey: "PLACEHOLDER_API_KEY",          // ← pegar no Firebase Console
messagingSenderId: "PLACEHOLDER_SENDER_ID",
appId: "PLACEHOLDER_APP_ID"
```

**Onde pegar:**
1. https://console.firebase.google.com/project/gestor-btg-lp-builder-staging
2. ⚙️ Configurações do projeto → aba "Geral" → role até "Seus aplicativos"
3. Se não houver app Web: criar com ícone `</>` (nome sugerido: `btg-lp-builder`)
4. Em "SDK setup and configuration" → seleção "Config" → copiar bloco `firebaseConfig`
5. Substituir os 3 placeholders e salvar

Tempo: ~3 min. Apenas o owner técnico precisa fazer 1x.

## Como rodar localmente

```bash
cd ~/Documents/Codex/btg-migration/tarefas
python3 -m http.server 8765
```

Abrir:
- http://localhost:8765/btg/partners/
- http://localhost:8765/btg/ultrablue/
- http://localhost:8765/btg/operadora/
- http://localhost:8765/btg/dashboard/nova-oferta/

## Próximos passos (Fase 1+)

| Fase | Escopo | Estimativa |
|---|---|---|
| 0.5 | Preencher `btg-config.js` com credenciais reais + criar Firestore Rules da coleção `btg_ofertas_dev` | 30 min (você) |
| 1 | Validar end-to-end com Firestore staging real (criar oferta dummy, listar, abrir detalhe) | 1-2 dias |
| 2 | Completar POC (upload R2, dedup slug, soft-delete, import Excel/DOCX) | 5-7 dias |
| 3 | Integração com Claude via `callLLM` (substitui `/api/ai/sugerir` e `/api/ai/revisar` do Next.js) | 2-3 dias |
| 4 | Script de migração WordPress → Firestore (~10 ofertas, one-shot) | 1 dia |
| 5 | Cloudflare Pages staging (`*-beta.primetour.com.br`) + validação interna | 5-10 dias corridos |
| 6 | Cutover DNS por marca (Operadora → Ultrablue → Partners) | 3 dias |
| 7 | Aposentar WordPress (planejado +30d) | — |

Plano completo discutido no histórico do chat. Quando bater na Fase 5 (Cloudflare), abrir doc dedicado pro setup de DNS/CDN.
