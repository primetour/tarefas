# Gestor PRIMETOUR — Governança

> Política de governança técnica e de dados. Define responsabilidades, ciclo de
> vida de mudança, gestão de riscos e fornecedores.
> Atualizado em: 2026-05-05 · v3.1.0
> Owner: DPO + Incident Commander
> Revisão obrigatória: anual OU em mudanças de fornecedor crítico ou schema MAJOR.

---

## 1. Modelo de governança

### 1.1 Papéis e responsabilidades

| Papel | Quem | Responsabilidade |
|---|---|---|
| **Sponsor de produto** | Diretoria PRIMETOUR | Aprovar roadmap, priorizar investimento, autorizar contratos com fornecedores |
| **Tech Lead** | Engenharia interna | Aprovar mudanças MAJOR, definir padrões técnicos, owner do versionamento |
| **DPO** (Data Protection Officer, LGPD Art. 41) | Designado interno | Conformidade LGPD, resposta a titulares, comunicação com ANPD |
| **Incident Commander** | Designado interno | Coordenar resposta a incidentes P0–P3, comunicação durante crise |
| **Admin de plataforma** | Master + Admin (RBAC) | Gestão diária de usuários, configurações, secrets de produção |
| **Auditor (interno ou externo)** | Designado por contrato | Revisar logs de auditoria, validar conformidade, executar penetration tests anuais |

### 1.2 Comitês e cadências

| Comitê | Cadência | Pauta padrão |
|---|---|---|
| **Review de Segurança** | Mensal | Métricas de segurança, incidents do mês, ações corretivas, status de hardening |
| **Review de Acessos** | Trimestral | Revisão dos roles ativos (master/admin), Service Accounts, Conditional Access |
| **Review de Fornecedores** | Trimestral | SLA dos providers críticos, custos, contratos próximos de renovação |
| **Review de Versão MAJOR** | Por demanda | Aprovação técnica + sponsor antes de bump de major (mudança de schema, contrato externo) |
| **Penetration Test** | Anual | Execução por terceiro independente; relatório vai pra DPO + Tech Lead |
| **Auditoria deste documento** | Anual | Revisão completa do GOVERNANCE.md por DPO + Tech Lead |

---

## 2. Ciclo de vida de mudança

### 2.1 Versionamento de software

Esquema **SemVer + BUILD** — detalhado em [`docs/VERSIONING.md`](docs/VERSIONING.md):

| Bump | Quando | Aprovação |
|---|---|---|
| **MAJOR** | Schema de Firestore exige migração; quebra de contrato externo (URLs, integrações) | Tech Lead + Sponsor |
| **MINOR** | Tela ou módulo novo; feature compatível | Tech Lead |
| **PATCH** | Bugfix, polish, refactor | Auto-aprovado pelo desenvolvedor |
| **BUILD** | Cada deploy (yyyymmdd-slug) | Auto |

Histórico granular: [`CHANGELOG.md`](CHANGELOG.md).

### 2.2 Pipeline de deploy

1. **Desenvolvimento local** — branch `feat/...` ou `fix/...`
2. **Pull request** — review obrigatório se a mudança toca: Firestore Rules, Cloud Functions, RBAC, ou schema. Demais mudanças seguem self-review se forem PATCH.
3. **Merge em `main`** — dispara deploy automático no GitHub Pages (~30s)
4. **Smoke test in-browser** — validar versão no rodapé + função alterada
5. **Rollback** — `git revert` + push (~1 min para rollback completo)

**Cloud Functions**: deploy via `firebase deploy --only functions` exige aprovação do
Tech Lead (afeta backend que serve secrets). Não há pipeline automático para Functions
deliberadamente — exigência de revisão humana.

### 2.3 Janelas de manutenção

- **Padrão**: deploys ad-hoc (sistema é tolerante; sessões de usuário não são interrompidas em deploy estático).
- **Mudanças de Firestore Rules**: avisadas com 24h em canal interno; janela preferencial sábado 06h–09h BRT.
- **Mudanças MAJOR (schema)**: janela formal com pré-aviso de 7 dias. Backup PITR garantido até 7 dias atrás.

---

## 3. Gestão de fornecedores (vendor management)

### 3.1 Fornecedores críticos

Sistemas sem os quais o produto deixa de funcionar.

| Fornecedor | Função | Impacto se cair | SLA contratado |
|---|---|---|---|
| **Google Firebase** (Auth + Firestore + Functions) | Backend principal — auth, dados, lógica de negócio | App fica indisponível | Padrão Google Cloud (99.95%) |
| **GitHub Pages** (hosting) | Servir HTML/JS/CSS estáticos | App fica indisponível | Padrão GitHub (best-effort) |
| **Microsoft 365 / Azure AD** | SSO corporativo + Conditional Access | Login indisponível | E5 / Conditional Access SLA |
| **Cloudflare R2** (storage de imagens) | Upload e leitura de imagens de portal/conteúdo | Funcionalidades de imagem indisponíveis | Cloudflare R2 SLA |

### 3.2 Fornecedores não-críticos

Sistemas que podem falhar sem derrubar o produto principal (uso em features específicas).

| Fornecedor | Função | Impacto se cair |
|---|---|---|
| **Anthropic** | LLM (Claude) | IA em modo limitado; fallback automático para outros providers |
| **OpenAI** | LLM (GPT) | IA em modo limitado; fallback |
| **Google AI (Gemini)** | LLM (free tier) | IA em modo limitado |
| **Groq** | LLM (rápido) | IA em modo limitado |
| **EmailJS** | Envio de emails de CSAT | Feature CSAT degrada (sem envio automático) |
| **GA4 / Meta Graph / SFMC** | Sync de métricas externas | Páginas de Performance ficam com dados defasados (até próximo cron) |

### 3.3 Política de mudança de fornecedor crítico

Trocar fornecedor crítico exige **bump MAJOR** mais aprovação dupla (Tech Lead + Sponsor)
mais comunicação com 30 dias de antecedência ao cliente. Plano de rollback obrigatório.

Migração planejada de hospedagem (GitHub Pages → Cloudflare Pages) está documentada em
[`MIGRATION-CLOUDFLARE.md`](MIGRATION-CLOUDFLARE.md).

---

## 4. Gestão de dados

### 4.1 Política de retenção

| Categoria | Período | Justificativa |
|---|---|---|
| Tarefas / Projetos / Goals / Feedbacks | 7 anos após criação | Auditoria operacional, prazos contratuais |
| Audit logs (`audit_logs`) | 90 dias online; export anual para storage frio | LGPD + custo |
| Logs de uso de IA (`ai_usage_logs`) | 90 dias (TTL automático) | Otimização de custos; dados agregados preservados |
| Time clock / ponto eletrônico (`time_clock_audit`) | 5 anos | CLT obrigatório (Brasil) |
| Sessões de chat IA (`ai_chat_history`) | 30 dias (TTL); usuário pode apagar antes via LGPD | Privacidade |
| Backups Firestore | 30 dias rolling em GCS Cold | Recovery + compliance |
| PITR Firestore | 7 dias granularidade minuto | Recovery rápido |

### 4.2 Política de classificação de dados

| Classe | Exemplo | Tratamento |
|---|---|---|
| **Pública** | Dados em `portal-view.html`, `lp.html`, calendário público (sem dados pessoais), documentação | Acesso anônimo permitido |
| **Interna** | Listagem de tarefas, projetos, métricas internas | RBAC obrigatório; SSO interno |
| **Confidencial** | PII (nome, email, telefone), feedbacks de equipe, dados de CSAT | RBAC + scope (`own`/`sector`/`squad`); TLS obrigatório; audit log |
| **Restrita** | Secrets de provedores, dados financeiros agregados, evidências de avaliação de meta | Apenas Cloud Functions (server-side); zero acesso pelo client |

Detalhes em [`DATA-FLOW.md`](DATA-FLOW.md) — Inventário PII por collection.

### 4.3 Direitos do titular (LGPD)

Implementados via Cloud Functions:

| Direito | Implementação |
|---|---|
| **Acesso** (Art. 18 II) | `exportUserData(uid)` — usuário pode baixar todos os próprios dados (JSON) |
| **Correção** (III) | Edição manual via UI; histórico em `audit_logs` |
| **Anonimização / Erasure** (VI) | `eraseUserDataServer(uid)` — soft delete + anonimização preservando integridade referencial |
| **Portabilidade** (V) | Mesmo `exportUserData(uid)` em formato estruturado |
| **Informação** (I) | `getDataCategories()` — lista quais categorias de dados o sistema processa |
| **Revogação de consentimento** | Tratada por categoria; `consent.version` rastreado por usuário |

Solicitação de titular: dpo@primetour.com.br · resposta em até 15 dias (LGPD Art. 19).

### 4.4 Transferência internacional de dados

- **Firestore**: região `southamerica-east1` (São Paulo) — dados ficam no Brasil
- **Cloud Functions**: região `southamerica-east1` (São Paulo)
- **R2 (Cloudflare)**: edge global; objetos servidos do POP mais próximo
- **LLM providers**: dados saem do Brasil (provedores nos EUA). Política de uso explícita ao usuário; opt-out via desativação do agente

Mais detalhes em [`DATA-FLOW.md`](DATA-FLOW.md) — Transferência Internacional.

---

## 5. Gestão de riscos

### 5.1 Risk register

Riscos identificados, classificados e com plano de mitigação ou aceitação documentada.

| Risco | Probabilidade | Impacto | Tratamento | Owner |
|---|---|---|---|---|
| **Vendor lock-in Firebase** | Alta | Alto | Aceito; arquitetura modular permite migração com esforço estimado de 90 dias | Tech Lead |
| **Custo de IA descontrolado** | Média | Médio | Mitigado: rate limit per-IP/per-user, budget alerts, audit log de cada chamada | DPO |
| **Indisponibilidade GitHub Pages** | Baixa | Alto | Mitigado: prep para Cloudflare Pages pronta (`MIGRATION-CLOUDFLARE.md`), failover em ~24h |
| **Vazamento de credencial de provedor** | Média | Alto | Mitigado: secrets em Secret Manager, weeklySecretsAudit, rotação periódica obrigatória |
| **Comprometimento de conta admin** | Baixa | Crítico | Mitigado: MFA obrigatório, Conditional Access, auditoria mensal de roles, break-glass account isolada |
| **Quebra de schema durante migração** | Média | Alto | Mitigado: bump MAJOR exige plano de rollback, PITR garante recovery em 7 dias |
| **Volume de dados ultrapassa free tier** | Alta | Médio | Aceito; budget acompanhado mensalmente |
| **Falha de App Check (modo monitor)** | Média | Médio | Em rampa para enforce; monitor mode detecta abuso antes de bloquear |

### 5.2 Penetration testing

- **Cadência**: anual (mínimo); ad-hoc após mudanças MAJOR de schema/contrato
- **Executor**: terceiro independente certificado (CREST / OSCP)
- **Escopo padrão**: app web, Cloud Functions, Firestore Rules, Auth flow
- **Saída**: relatório formal entregue a DPO; achados críticos viram backlog priorizado

---

## 6. Continuidade de negócio

### 6.1 Backups

| Tipo | Cadência | Retenção | Restore RTO |
|---|---|---|---|
| **Firestore PITR** | Contínuo | 7 dias | < 30 min |
| **Firestore daily export** | Diário 03h BRT | 30 dias rolling em GCS | < 4h |
| **Firestore weekly snapshot** | Domingo 02h BRT | 1 ano | < 8h |
| **Code (Git)** | Cada commit | Indefinida (GitHub) | < 1h |
| **Secrets** | Replicação Secret Manager | N/A | < 1h |

### 6.2 Disaster Recovery (DR)

- **RTO** (Recovery Time Objective): 4h para incidente crítico
- **RPO** (Recovery Point Objective): 1h (graças ao PITR)
- **Plano detalhado**: ver [`INCIDENT-RESPONSE.md`](INCIDENT-RESPONSE.md)

### 6.3 Disponibilidade alvo

- **App principal** (`index.html`): 99.5% mensal (compatível com SLA combinado dos fornecedores críticos)
- **Páginas públicas standalone** (`portal-view.html`, `lp.html`, `calendario-conteudo.html`): 99.5%
- **Cloud Functions**: 99.5% (Firebase SLA)
- **Mediação durante incidente**: status comunicado via canal interno + atualização periódica em status page (a definir)

---

## 7. Compliance & certificação

### 7.1 Frameworks aplicáveis

| Framework | Status | Documentação |
|---|---|---|
| **LGPD** (Brasil) | Compliant — controles documentados | `DATA-FLOW.md`, esta seção |
| **SOC 2** (Type II) | Artefatos prontos; auditoria formal pendente | Mapeamento em `SECURITY.md` + `ACCESS-CONTROL.md` (CC6.1, CC6.3, CC7) |
| **ISO 27001** | Controles mapeados (A.5–A.18); certificação pendente de demanda comercial | `SECURITY.md` (Anexo A) |
| **GDPR** (UE) | Aplicável se houver dados de cidadãos UE; controles equivalentes a LGPD já implementados | `DATA-FLOW.md` |

### 7.2 Auditorias externas

Aceitamos e suportamos auditorias por especialistas TI de clientes corporativos. Esta
documentação é o ponto de partida; informações complementares (configurações específicas
de projeto, IDs internos, evidências de execução) ficam disponíveis sob NDA.

### 7.3 Frameworks que NÃO se aplicam (e por quê)

Declarar não-aplicabilidade explicitamente é tão importante quanto declarar conformidade —
evita escopo inflado, auditoria mal direcionada e custos desnecessários. As verificações
abaixo foram revisadas em cada release MAJOR.

| Framework | Não se aplica porque… |
|---|---|
| **PCI DSS** (Payment Card Industry) | O Gestor **não armazena, processa nem transmite dados de cartão de pagamento**. Não há checkout, gateway de pagamento, captura de PAN/CVV ou integração com PSP/adquirente. Dados de cartão da operação PRIMETOUR vivem em sistemas segregados (sistema de booking, gateway, ERP financeiro), cada um com seu próprio compliance PCI. Manter o Gestor fora do escopo PCI é decisão de arquitetura — minimizar superfície reduz drasticamente o custo de assessment QSA, pen-test específico e segmentação de rede. Auditoria do escopo de dados está em [`DATA-FLOW.md`](DATA-FLOW.md) — Inventário PII por collection. |
| **HIPAA** (saúde, EUA) | Não processa **Protected Health Information**. Sistema é de gestão operacional de agência de viagens; nenhuma collection contém prontuário médico, diagnóstico ou identificadores de paciente. |
| **PCI 3DS / EMVCo** | Decorrência do PCI DSS não-aplicável (sem cartão = sem 3DS). |
| **FedRAMP** (governo EUA) | Sistema serve clientes corporativos brasileiros; não há contrato com agência federal americana. |
| **SOX** (Sarbanes-Oxley) | Não é sistema de relatório financeiro auditado; PRIMETOUR não é empresa listada na bolsa americana. |

**Política de revisão**: a cada release MAJOR (`X.0.0`) o time revisa se algum framework
acima passou a se aplicar (ex: se um dia for adicionada feature de pagamento, PCI sai
desta seção e entra em 7.1 com plano de conformidade). Histórico em [`CHANGELOG.md`](CHANGELOG.md).

---

## 8. Ownership do produto

### 8.1 Propriedade intelectual

- **Código fonte**: propriedade da PRIMETOUR.
- **Dados de clientes**: propriedade dos clientes corporativos contratantes.
- **Modelos de IA**: propriedade dos respectivos fornecedores (Anthropic, OpenAI, Google, Groq); a PRIMETOUR não treina modelos com dados de cliente.

### 8.2 Política de uso de IA com dados de cliente

- Dados de cliente NÃO são usados para treinamento de modelos.
- Termos contratuais com providers de LLM exigem cláusula de "no training" (verificar com `Anthropic`: ✓, `OpenAI Enterprise`: ✓ via API com flag, `Google Gemini`: ✓ via Workspace API, `Groq`: ✓ pelos termos de serviço).
- Logs de uso (`ai_usage_logs`) registram apenas metadados (tokens, custo, timestamp) — não armazenam o prompt ou a resposta integralmente.

### 8.3 Handoff e transição

A documentação técnica (este conjunto de docs) é mantida com qualidade suficiente para
permitir handoff completo a outra equipe técnica em janela de 30 dias, conforme cláusula
contratual padrão.

---

## 9. Atualizações deste documento

| Versão | Data | Mudança |
|---|---|---|
| **v1.0** | 2026-05-05 | Primeira versão formal junto com app v3.2.0 |

Owner: DPO. Revisão obrigatória anual ou em qualquer mudança de fornecedor crítico.
