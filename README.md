# Gestor PRIMETOUR

Plataforma interna de gestão de tarefas, projetos e produtividade da PRIMETOUR.

> Vanilla JS + Firebase. Zero build step. Deploy via GitHub Pages.

## Documentação

Toda documentação técnica vive sob `docs/` ou no app (aba **Sobre o Sistema → Documentação Técnica**) — não em READMEs soltos no root.

**Por onde começar:**
- 🚀 **[`docs/ONBOARDING.md`](./docs/ONBOARDING.md)** — setup em ~15 min, estrutura, deploy, comandos úteis
- 🏗 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — decisões, camadas, padrões, débitos técnicos
- 🤝 [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md) — convenções, workflow PR, anti-padrões
- ⚡ [`docs/PERFORMANCE.md`](./docs/PERFORMANCE.md) — otimizações + custos Firestore

**Contexto operacional:**
- 📄 [`FACT_SHEET.md`](./FACT_SHEET.md) — visão executiva
- 🗂 [`DATA-MODEL.md`](./DATA-MODEL.md) — schema Firestore (42+ collections)
- 🔑 [`ACCESS-CONTROL.md`](./ACCESS-CONTROL.md) — RBAC (6 roles + 50+ permissões)
- 🛡 [`SECURITY.md`](./SECURITY.md) — política de segurança
- 🎯 [`THREAT-MODEL.md`](./THREAT-MODEL.md) — modelo de ameaças (STRIDE)
- 🚨 [`INCIDENT-RESPONSE.md`](./INCIDENT-RESPONSE.md) — runbook
- ⚙ [`INFRA.md`](./INFRA.md) — infraestrutura produção

## Acesso in-app

Quando logado em https://primetour.github.io/tarefas/, todos os docs renderizados em HTML ficam em **Sobre o Sistema → 📚 Documentação Técnica**, agrupados por categoria (Desenvolvimento, Operação, Geral).
