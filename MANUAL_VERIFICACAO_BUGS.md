# MANUAL DE VERIFICACAO DE BUGS — PRIMETOUR V11

**Data:** Abril 2026
**Versao:** 1.0
**Objetivo:** Roteiro completo e minucioso para verificacao de bugs em todas as paginas, modais, formularios, fluxos e integracoes do sistema PRIMETOUR V11.

---

## INDICE

1. [Pre-requisitos e Ambiente](#1-pre-requisitos-e-ambiente)
2. [Autenticacao e Login](#2-autenticacao-e-login)
3. [Sidebar e Navegacao Global](#3-sidebar-e-navegacao-global)
4. [Dashboard Principal](#4-dashboard-principal)
5. [Tarefas](#5-tarefas)
6. [Projetos](#6-projetos)
7. [Kanban (Steps)](#7-kanban-steps)
8. [Calendario](#8-calendario)
9. [Timeline](#9-timeline)
10. [Workspaces](#10-workspaces)
11. [Solicitacoes](#11-solicitacoes)
12. [Notificacoes](#12-notificacoes)
13. [Equipe](#13-equipe)
14. [Feedbacks](#14-feedbacks)
15. [Metas (Goals)](#15-metas-goals)
16. [CSAT](#16-csat)
17. [Dashboards de Produtividade](#17-dashboards-de-produtividade)
18. [Newsletters (NL Performance)](#18-newsletters-nl-performance)
19. [Instagram (Meta Performance)](#19-instagram-meta-performance)
20. [Google Analytics](#20-google-analytics)
21. [Roteiros de Viagem — Lista](#21-roteiros-de-viagem--lista)
22. [Roteiros de Viagem — Editor](#22-roteiros-de-viagem--editor)
23. [Roteiros de Viagem — Dashboard](#23-roteiros-de-viagem--dashboard)
24. [Portal de Dicas — Geracao](#24-portal-de-dicas--geracao)
25. [Portal de Dicas — Editor de Dicas](#25-portal-de-dicas--editor-de-dicas)
26. [Portal de Dicas — Dicas Cadastradas](#26-portal-de-dicas--dicas-cadastradas)
27. [Portal de Dicas — Banco de Imagens](#27-portal-de-dicas--banco-de-imagens)
28. [Portal de Dicas — Areas/BUs](#28-portal-de-dicas--areasbus)
29. [Portal de Dicas — Destinos](#29-portal-de-dicas--destinos)
30. [Portal de Dicas — Importacao](#30-portal-de-dicas--importacao)
31. [Portal de Dicas — Dashboard](#31-portal-de-dicas--dashboard)
32. [Landing Pages](#32-landing-pages)
33. [CMS / Site](#33-cms--site)
34. [Editor de Artes](#34-editor-de-artes)
35. [Monitor de Noticias](#35-monitor-de-noticias)
36. [Usuarios](#36-usuarios)
37. [Setores e Nucleos](#37-setores-e-nucleos)
38. [Tipos de Tarefa](#38-tipos-de-tarefa)
39. [Roles e Permissoes](#39-roles-e-permissoes)
40. [IA Skills](#40-ia-skills)
41. [IA Dashboard](#41-ia-dashboard)
42. [Auditoria](#42-auditoria)
43. [Configuracoes](#43-configuracoes)
44. [Integracoes](#44-integracoes)
45. [Perfil do Usuario](#45-perfil-do-usuario)
46. [Sobre o Sistema](#46-sobre-o-sistema)
47. [Paginas Publicas](#47-paginas-publicas)
48. [Testes Transversais](#48-testes-transversais)
49. [Matriz de Permissoes](#49-matriz-de-permissoes)

---

## 1. PRE-REQUISITOS E AMBIENTE

### 1.1 Perfis de Teste Necessarios

| Perfil         | Role           | O que testa                                   |
|----------------|----------------|-----------------------------------------------|
| **Perfil A**   | master         | Acesso total, funcoes admin, migracao dados    |
| **Perfil B**   | admin (Head)   | Gestao de usuarios, roles, configuracoes       |
| **Perfil C**   | manager        | Gestao de workspaces, tarefas, portal          |
| **Perfil D**   | coordinator    | Acesso intermediario, sem manage               |
| **Perfil E**   | member         | Acesso padrao de analista                      |
| **Perfil F**   | partner        | Acesso restrito ao portal (limite 5 downloads) |
| **Perfil G**   | role customizado | Permissoes especificas personalizadas         |

### 1.2 Navegadores para Testar
- Chrome (ultima versao)
- Safari (Mac)
- Firefox
- Edge
- Chrome Mobile (celular ou DevTools responsive)

### 1.3 Checklist Pre-Teste
- [ ] Firebase Console acessivel
- [ ] Firestore rules atualizadas (incluindo roteiros, roteiro_generations, roteiro_web_links)
- [ ] Pelo menos 1 usuario de cada perfil criado
- [ ] Pelo menos 1 workspace criado
- [ ] Pelo menos 1 projeto criado
- [ ] Pelo menos 3 tarefas em status variados
- [ ] Portal: ao menos 1 area, 1 destino, 1 dica, 3 imagens
- [ ] AI Skills: pelo menos 1 provider configurado com API key
- [ ] Console do navegador aberta (F12 > Console) durante todos os testes

---

## 2. AUTENTICACAO E LOGIN

### 2.1 Tela de Login
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 2.1.1 | Login com Google | Clicar "Entrar com Google" > selecionar conta | Redireciona para dashboard. Toast de boas-vindas. |
| 2.1.2 | Login com email/senha validos | Digitar email e senha corretos > clicar "Entrar" | Redireciona para dashboard. |
| 2.1.3 | Login com email invalido | Digitar email inexistente > clicar "Entrar" | Mensagem de erro clara. Nao redireciona. |
| 2.1.4 | Login com senha errada | Digitar email correto, senha errada > "Entrar" | Mensagem "Senha incorreta" ou equivalente. |
| 2.1.5 | Login com campos vazios | Deixar campos em branco > clicar "Entrar" | Validacao impede envio. Mensagem de campo obrigatorio. |
| 2.1.6 | Login de usuario desativado | Tentar login com usuario status=inactive | Mensagem "Conta desativada" ou bloqueio. |
| 2.1.7 | Persistencia de sessao | Fazer login > fechar aba > reabrir | Sessao mantida, nao pede login novamente. |
| 2.1.8 | Logout | Clicar no avatar > "Sair" | Retorna a tela de login. Sessao limpa. |
| 2.1.9 | Acesso sem autenticacao | Acessar index.html sem estar logado | Redireciona para tela de login. |
| 2.1.10 | Login partner | Login com perfil partner | Acessa apenas portal. Sidebar restrita. |

---

## 3. SIDEBAR E NAVEGACAO GLOBAL

### 3.1 Estrutura da Sidebar
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 3.1.1 | Itens visiveis por perfil | Login com cada perfil (A-G) | Itens da sidebar respeitam permissoes. Partner ve apenas portal. |
| 3.1.2 | Colapsar/expandir secoes | Clicar no titulo de cada secao (Principal, Gestao, etc.) | Secao colapsa/expande. Estado visual correto. |
| 3.1.3 | Navegacao por item | Clicar em cada item da sidebar | Pagina correta carrega. Item ativo destacado. |
| 3.1.4 | Badge de notificacoes | Criar notificacao para o usuario | Badge aparece no item "Notificacoes" com contagem. |
| 3.1.5 | Badge de solicitacoes | Criar solicitacao pendente | Badge aparece no item "Solicitacoes" com contagem. |
| 3.1.6 | Seletor de workspace | Clicar no workspace selector | Lista de workspaces aparece. Selecao muda contexto. |
| 3.1.7 | Multi-workspace | Selecionar mais de 1 workspace | Tarefas filtradas por workspaces selecionados. |
| 3.1.8 | Card de usuario (rodape) | Verificar card no rodape da sidebar | Nome, email, role exibidos corretamente. |
| 3.1.9 | Sidebar mobile | Redimensionar para <768px | Sidebar vira overlay. Hamburger menu aparece. |
| 3.1.10 | Sidebar mobile fechar | Clicar fora da sidebar no mobile | Sidebar fecha. Overlay some. |

### 3.2 Header
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 3.2.1 | Tema claro/escuro | Alternar tema no header | CSS muda. Variaveis de cor atualizadas. Sem quebra visual. |
| 3.2.2 | Avatar/perfil rapido | Clicar no avatar do header | Menu dropdown com opcoes (Perfil, Sair). |

---

## 4. DASHBOARD PRINCIPAL

**Rota:** `#dashboard` | **Permissao:** `dashboard_view`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 4.1 | Saudacao | Acessar dashboard em diferentes horarios | "Bom dia" / "Boa tarde" / "Boa noite" correto. Nome do usuario. |
| 4.2 | KPI - Tarefas Abertas | Verificar contagem | Numero corresponde as tarefas nao concluidas do usuario. |
| 4.3 | KPI - Em Andamento | Verificar contagem | Numero corresponde a tarefas com status "in_progress". |
| 4.4 | KPI - Concluidas Hoje | Concluir 1 tarefa > verificar | Contagem incrementa. |
| 4.5 | KPI - Projetos Ativos | Verificar contagem | Numero corresponde a projetos nao arquivados. |
| 4.6 | Minhas Tarefas | Verificar lista | Ate 7 tarefas do usuario. Prioridade, prazo, status visiveis. |
| 4.7 | Link "+X mais" | Ter >7 tarefas > clicar link | Navega para pagina de tarefas. |
| 4.8 | Meus Workspaces | Verificar cards | Workspaces do usuario com contagem de tarefas. |
| 4.9 | Solicitacoes pendentes | Ter solicitacoes pendentes (manager+) | Card aparece com contagem. |
| 4.10 | Minhas Metas | Ter metas atribuidas | Card com progress bars ate 3 metas. |
| 4.11 | Projetos | Verificar cards | Ate 4 projetos com progress bars. |
| 4.12 | Distribuicao | Verificar grafico | Barras horizontais com %, somam 100%. |
| 4.13 | Filtro por setor | Usuario multi-setor: mudar setor | KPIs recalculam filtrando por setor. |
| 4.14 | Botao Nova Tarefa | Clicar "+ Nova Tarefa" | Abre modal de criacao de tarefa. |
| 4.15 | Dashboard vazio | Login com usuario sem tarefas/projetos | Mensagens "nenhum dado" em cada card. Sem erros. |

---

## 5. TAREFAS

**Rota:** `#tasks` | **Permissao:** `task_create`

### 5.1 Listagem
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 5.1.1 | Carga inicial | Acessar pagina | Lista de tarefas carrega. Contagem exibida. |
| 5.1.2 | Busca por titulo | Digitar titulo parcial no campo de busca | Tarefas filtradas em tempo real (debounce). |
| 5.1.3 | Busca por tag | Digitar nome de tag | Tarefas com a tag aparecem. |
| 5.1.4 | Filtro por status | Selecionar "Em andamento" | Apenas tarefas in_progress. |
| 5.1.5 | Filtro por prioridade | Selecionar "Alta" | Apenas tarefas com prioridade alta. |
| 5.1.6 | Filtro por projeto | Selecionar projeto especifico | Apenas tarefas do projeto. |
| 5.1.7 | Filtro por responsavel | Selecionar usuario | Apenas tarefas atribuidas ao usuario. |
| 5.1.8 | Combinacao de filtros | Status + Prioridade + Projeto | Interseccao correta. |
| 5.1.9 | Limpar filtros | Voltar todos para "Todos" | Lista completa restaurada. |
| 5.1.10 | Agrupamento por status | Group by: "Por status" | Grupos colapsaveis com contagem. |
| 5.1.11 | Agrupamento por prioridade | Group by: "Por prioridade" | Grupos com cores de prioridade. |
| 5.1.12 | Agrupamento por projeto | Group by: "Por projeto" | Grupos por nome de projeto. |
| 5.1.13 | Sem agrupamento | Group by: "Sem agrupamento" | Lista plana. |
| 5.1.14 | Quick-add tarefa | No grupo, digitar titulo + Enter | Tarefa criada no status/grupo correto. |
| 5.1.15 | Quick-add vazio | Pressionar Enter sem digitar | Nada acontece. Sem erro. |

### 5.2 Modal de Tarefa (Criar)
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 5.2.1 | Abrir modal novo | Clicar "+ Nova Tarefa" | Modal abre com campos vazios. |
| 5.2.2 | Campo titulo obrigatorio | Tentar salvar sem titulo | Validacao bloqueia. Mensagem de erro. |
| 5.2.3 | Selecionar tipo | Escolher tipo de tarefa | Campos dinamicos aparecem (custom fields). |
| 5.2.4 | Mudar tipo | Escolher tipo A, preencher campos, mudar para tipo B | Campos de A desaparecem. Campos de B aparecem. |
| 5.2.5 | Atribuir responsavel | Selecionar 1 ou mais usuarios | Avatars aparecem. |
| 5.2.6 | Responsavel em ferias | Atribuir usuario com ausencia no periodo | Aviso de ausencia exibido (icone/tooltip). |
| 5.2.7 | Data inicio > Data prazo | Definir inicio depois do prazo | Verificar se ha alerta ou validacao. |
| 5.2.8 | Subtarefas | Adicionar 3 subtarefas | Subtarefas listadas com checkboxes. |
| 5.2.9 | Subtarefa vazia | Adicionar subtarefa sem titulo | Verificar se permite (bug: pode criar linha vazia). |
| 5.2.10 | Tags | Adicionar tags existentes e novas | Tags aparecem como chips. |
| 5.2.11 | Tag com caracteres especiais | Criar tag com espacos/acentos/simbolos | Verificar normalizacao. |
| 5.2.12 | Campos dinamicos obrigatorios | Preencher tipo com campo obrigatorio > salvar sem preencher | Validacao bloqueia com mensagem. |
| 5.2.13 | Salvar tarefa completa | Preencher todos os campos > Salvar | Tarefa criada. Toast de sucesso. Lista atualizada. |
| 5.2.14 | Cancelar criacao | Preencher campos > Cancelar | Modal fecha. Nenhuma tarefa criada. |
| 5.2.15 | Newsletter status | Se tipo aceita, verificar campo de status newsletter | Campo aparece e salva corretamente. |

### 5.3 Modal de Tarefa (Editar)
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 5.3.1 | Abrir tarefa existente | Clicar em tarefa na lista | Modal abre com dados preenchidos. |
| 5.3.2 | Editar titulo | Mudar titulo > Salvar | Titulo atualizado na lista. |
| 5.3.3 | Mudar status | Mudar para "Concluida" | Status atualizado. CSAT overlay se aplicavel. |
| 5.3.4 | Comentarios | Adicionar comentario | Comentario aparece na lista. Autor e data corretos. |
| 5.3.5 | Toggle subtarefa | Marcar subtarefa como concluida | Checkbox preenchido. Progresso atualizado. |
| 5.3.6 | Excluir tarefa | Clicar "Excluir" > Confirmar | Tarefa removida. Toast. Lista atualizada. |
| 5.3.7 | Excluir tarefa (cancelar) | Clicar "Excluir" > Cancelar | Tarefa permanece. |
| 5.3.8 | Permissao de edicao | Login como member, editar tarefa de outro | Verificar se permite/bloqueia conforme task_edit_any. |

### 5.4 Exportacao de Tarefas
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 5.4.1 | Export XLS | Clicar "XLS" | Arquivo .xlsx baixado com dados corretos. |
| 5.4.2 | Export PDF | Clicar "PDF" | Arquivo .pdf gerado com formatacao. |
| 5.4.3 | Export com filtros | Aplicar filtros > Exportar | Apenas dados filtrados no arquivo. |
| 5.4.4 | Import | Clicar "Importar" > selecionar arquivo | Tarefas importadas. Verificar mapeamento de campos. |

---

## 6. PROJETOS

**Rota:** `#projects` | **Permissao:** `task_create` ou `project_create`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 6.1 | Listagem | Acessar pagina | Cards de projetos com nome, status, progresso. |
| 6.2 | Busca | Digitar nome parcial | Filtra projetos. |
| 6.3 | Filtro por status | Selecionar status | Apenas projetos do status. |
| 6.4 | Criar projeto | Clicar "+ Novo Projeto" > Preencher > Salvar | Projeto criado. Card aparece. |
| 6.5 | Campos obrigatorios | Salvar sem nome | Validacao bloqueia. |
| 6.6 | Seletor de cor/icone | Escolher cor e icone | Preview atualiza no modal. |
| 6.7 | Membros do projeto | Adicionar/remover membros | Chips de membros atualizados. |
| 6.8 | Editar projeto | Clicar "Editar" > Mudar dados > Salvar | Dados atualizados no card. |
| 6.9 | Excluir projeto | Clicar "Excluir" > Confirmar | Projeto removido. Tarefas do projeto nao devem ser excluidas. |
| 6.10 | Progress bar | Concluir tarefas do projeto | Barra de progresso atualiza %. |
| 6.11 | Ver tarefas | Clicar "Ver tarefas" | Navega para tarefas filtradas pelo projeto. |
| 6.12 | Datas | Definir inicio e fim | Exibidas corretamente no card. |
| 6.13 | Projeto sem tarefas | Projeto novo, sem tarefas | Progress 0%. Contagem "0 tarefas". |

---

## 7. KANBAN (STEPS)

**Rota:** `#kanban` | **Permissao:** `task_create`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 7.1 | Colunas de status | Acessar Kanban | Colunas: A Fazer, Em Andamento, Em Revisao, Concluida. |
| 7.2 | Drag & drop | Arrastar tarefa de "A Fazer" para "Em Andamento" | Status atualizado no Firestore. Card move de coluna. |
| 7.3 | Drag cancelado | Iniciar drag > soltar fora de coluna | Tarefa volta a posicao original. |
| 7.4 | Filtro por setor | Selecionar setor | Apenas tarefas do setor nas colunas. |
| 7.5 | Filtro por tipo | Selecionar tipo de tarefa | Apenas tarefas do tipo. |
| 7.6 | Filtro por projeto | Selecionar projeto | Apenas tarefas do projeto. |
| 7.7 | Filtro por responsavel | Selecionar usuario | Apenas tarefas atribuidas. |
| 7.8 | View Pipeline | Clicar "Esteira" (Pipeline) | Colunas mudam para etapas do tipo selecionado. |
| 7.9 | Pipeline sem tipo | Acessar Pipeline sem tipos com etapas | Mensagem informativa. |
| 7.10 | Card click | Clicar em card de tarefa | Abre modal de edicao da tarefa. |
| 7.11 | Card preferences | Clicar icone de config do card | Modal de preferencias de exibicao. |
| 7.12 | Coluna vazia | Coluna sem tarefas | Mensagem "Nenhuma tarefa" ou area de drop visivel. |
| 7.13 | Muitas tarefas | Coluna com 50+ tarefas | Scroll funciona. Performance aceitavel. |

---

## 8. CALENDARIO

**Rota:** `#calendar` | **Permissao:** `task_create`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 8.1 | Vista mensal | Acessar calendario > Mes | Grade mensal com tarefas nos dias corretos. |
| 8.2 | Vista semanal | Mudar para Semana | 7 colunas com tarefas. |
| 8.3 | Vista diaria | Mudar para Dia | Lista de tarefas do dia selecionado. |
| 8.4 | Navegacao < > | Clicar setas anterior/proximo | Muda mes/semana/dia. Titulo atualiza. |
| 8.5 | Hoje | Clicar "Hoje" | Retorna ao periodo atual. |
| 8.6 | Tarefa sem data | Tarefa sem prazo definido | Nao aparece no calendario (correto). |
| 8.7 | Tarefa atrasada | Tarefa com prazo no passado | Exibida com destaque vermelho/alerta. |
| 8.8 | Clicar em tarefa | Clicar no evento | Abre modal de edicao da tarefa. |
| 8.9 | Modo Esteira | Mudar para modo Esteira | Exibe slots por tipo de tarefa. |
| 8.10 | Modo Agenda | Mudar para modo Agenda | Pre-agendamento de tarefas. |
| 8.11 | Filtros | Aplicar filtros (setor, tipo, projeto) | Calendario atualiza mostrando apenas filtrados. |

---

## 9. TIMELINE

**Rota:** `#timeline` | **Permissao:** `task_edit_any`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 9.1 | Gantt visual | Acessar timeline | Barras horizontais representando duracao das tarefas. |
| 9.2 | Janela de tempo | Alterar periodo (7/14/30/60/90 dias) | Escala do eixo X ajusta. |
| 9.3 | Tarefa sem datas | Tarefa sem inicio/fim | Nao aparece ou aparece como ponto. |
| 9.4 | Filtro por projeto | Selecionar projeto | Apenas tarefas do projeto. |
| 9.5 | Scroll horizontal | Navegar pela timeline | Scroll suave. Datas no eixo atualizadas. |
| 9.6 | Clicar em barra | Clicar na barra de tarefa | Abre modal de edicao. |
| 9.7 | Tarefas sobrepostas | Tarefas no mesmo periodo | Barras empilhadas sem sobreposicao visual. |
| 9.8 | Card preferences | Alterar preferencias de exibicao | Cards atualizam conforme preferencias. |

---

## 10. WORKSPACES

**Rota:** `#workspaces` | **Permissao:** `workspace_create` ou `system_view_all`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 10.1 | Listagem | Acessar pagina | Cards de workspaces com cor, icone, membros. |
| 10.2 | Criar workspace | Clicar "+ Novo Workspace" > Preencher > Salvar | Workspace criado. Card aparece. |
| 10.3 | Nome obrigatorio | Salvar sem nome | Validacao bloqueia. |
| 10.4 | Seletor de icone | Escolher icone | Preview atualiza. |
| 10.5 | Seletor de cor | Escolher cor | Borda do card atualiza. |
| 10.6 | Toggle multissetor | Ativar "Workspace multissetor" | Info tooltip aparece. |
| 10.7 | Editar workspace | Clicar "Editar" > Mudar dados > Salvar | Dados atualizados. |
| 10.8 | Excluir/Arquivar | Clicar "Arquivar" > Confirmar | Workspace arquivado. Removido da lista ativa. |
| 10.9 | Ver membros | Clicar icone de membros | Modal com lista de membros, roles. |
| 10.10 | Promover membro | No modal de membros, clicar "Promover" | Membro vira admin do workspace. |
| 10.11 | Remover membro | Clicar "Remover" membro | Membro removido. Toast. |
| 10.12 | Convidar | Clicar "+ Convidar" | Modal com lista de usuarios disponiveis. |
| 10.13 | Convidar usuario | Clicar "+ Adicionar" em usuario | Usuario adicionado. Aparece na lista de membros. |
| 10.14 | Membro overflow | Workspace com 10+ membros | "+X" badge aparece. Avatars limitados a 5. |

---

## 11. SOLICITACOES

**Rota:** `#requests` | **Permissao:** `task_create`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 11.1 | Listagem | Acessar pagina | Cards de solicitacoes com status, urgencia, dados. |
| 11.2 | Filtro por status | Clicar em botoes de status | Cards filtrados. Botao ativo destacado. |
| 11.3 | Filtro por setor | Mudar setor (multi-setor) | Solicitacoes do setor selecionado. |
| 11.4 | Abrir detalhe | Clicar em card | Modal com todas as infos da solicitacao. |
| 11.5 | Converter em tarefa | Clicar "Converter em tarefa" | Abre modal de tarefa pre-preenchido com dados da solicitacao. |
| 11.6 | Selecionar workspace | No modal, escolher workspace | Workspace definido para a nova tarefa. |
| 11.7 | Recusar solicitacao | Clicar "Recusar" > Digitar motivo > Confirmar | Status muda para rejeitado. Motivo salvo. |
| 11.8 | Recusar sem motivo | Clicar "Recusar" > Confirmar sem motivo | Verificar se exige motivo ou aceita vazio. |
| 11.9 | Nota interna | Digitar nota interna > Salvar | Nota persiste no recarregamento. |
| 11.10 | Badge de urgencia | Solicitacao urgente | Badge "Urgente" vermelho visivel. |
| 11.11 | Badge fora do calendario | Solicitacao com flag | Badge "Fora do calendario" visivel. |
| 11.12 | Abrir portal publico | Clicar "Abrir portal" | Nova aba com solicitar.html. |

---

## 12. NOTIFICACOES

**Rota:** `#notifications` | **Permissao:** `dashboard_view`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 12.1 | Listagem | Acessar pagina | Notificacoes agrupadas por data (Hoje, Ontem, Esta semana, Anteriores). |
| 12.2 | Notificacao nao lida | Ter notificacao nao lida | Dot dourado + titulo em negrito. |
| 12.3 | Marcar como lida | Clicar "Lida" em notificacao | Dot some. Contagem de nao lidas diminui. |
| 12.4 | Marcar tudo como lido | Clicar "Marcar tudo como lido" | Todas ficam lidas. Badge do sidebar zera. |
| 12.5 | Dispensar notificacao | Clicar "X" | Notificacao removida da lista. |
| 12.6 | Clicar notificacao | Clicar no corpo da notificacao | Navega para rota associada. Marca como lida. |
| 12.7 | Filtro por categoria | Clicar pill "Tarefas" | Apenas notificacoes de tarefas. |
| 12.8 | Filtro nao lidas | Ativar toggle "Apenas nao lidas" | Lista filtra. |
| 12.9 | Busca | Digitar texto no campo de busca | Notificacoes filtradas por conteudo. |
| 12.10 | Paginacao | Ter 20+ notificacoes > navegar paginas | Paginacao funciona. Dados corretos por pagina. |
| 12.11 | Prioridade alta | Notificacao de alta prioridade | Borda vermelha a esquerda. |
| 12.12 | Notificacao real-time | Outra sessao cria tarefa para voce | Notificacao aparece em tempo real. Som toca. |

---

## 13. EQUIPE

**Rota:** `#team` | **Permissao:** `task_view_all`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 13.1 | Visao de equipe | Acessar pagina | Cards de membros com carga de trabalho. |
| 13.2 | Capacidade | Verificar indicador de capacidade | Mostra tarefas abertas vs capacidade. |
| 13.3 | Ausencias | Membro com ausencia registrada | Indicador visual de ausencia. |
| 13.4 | Filtro por setor | Mudar setor | Membros do setor. |
| 13.5 | Clicar em membro | Clicar no card de membro | Detalhes de tarefas do membro ou navegacao. |

---

## 14. FEEDBACKS

**Rota:** `#feedbacks` | **Permissao:** `feedback_view` ou `feedback_create`

### 14.1 Tab Feedbacks
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 14.1.1 | Listagem | Acessar tab Feedbacks | Lista de feedbacks registrados. |
| 14.1.2 | Criar feedback | Clicar "+ Novo Feedback" > Preencher > Salvar | Feedback criado. Toast sucesso. |
| 14.1.3 | Filtro por contexto | Selecionar contexto | Feedbacks filtrados. |
| 14.1.4 | Filtro por gestor | Selecionar gestor | Feedbacks do gestor. |
| 14.1.5 | Filtro por periodo | Definir datas de/ate | Feedbacks no periodo. |
| 14.1.6 | Data ate < Data de | Definir periodo invertido | Verificar comportamento (deve alertar ou inverter). |
| 14.1.7 | Busca | Digitar texto | Feedbacks contendo o texto. |
| 14.1.8 | Editar feedback | Clicar em feedback > Editar > Salvar | Dados atualizados. |
| 14.1.9 | Excluir feedback | Excluir > Confirmar | Feedback removido. |

### 14.2 Tab Dashboard
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 14.2.1 | Metricas visuais | Acessar tab Dashboard | Graficos e KPIs exibidos. |
| 14.2.2 | Filtros aplicados | Mudar filtros | Dashboard recalcula. |

### 14.3 Tab Rotina
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 14.3.1 | Criar rotina | Configurar feedback recorrente | Agendamento salvo. |
| 14.3.2 | Editar rotina | Mudar frequencia/participantes | Atualizado. |
| 14.3.3 | Rotinas vencidas | Verificar indicador de atraso | Toast ou badge de atraso visivel. |

### 14.4 Tab Importar
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 14.4.1 | Upload CSV | Selecionar arquivo CSV valido | Feedbacks importados. |
| 14.4.2 | CSV invalido | Arquivo com formato errado | Mensagem de erro clara. |

---

## 15. METAS (GOALS)

**Rota:** `#goals` | **Permissao:** `goals_view`

### 15.1 Tab Metas
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 15.1.1 | Listagem | Acessar pagina | Lista de metas com status. |
| 15.1.2 | Criar meta | Clicar "+ Nova Meta" > Preencher pilares, KPIs, pesos > Salvar | Meta criada. |
| 15.1.3 | Validacao de pesos | Pesos dos pilares nao somam 100% | Validacao bloqueia ou alerta. |
| 15.1.4 | Filtro por escopo | Selecionar escopo | Metas filtradas. |
| 15.1.5 | Filtro por status | Rascunho/Publicada/Encerrada | Metas filtradas. |
| 15.1.6 | Busca | Digitar titulo | Metas encontradas. |
| 15.1.7 | Editar meta | Clicar meta > Editar > Salvar | Dados atualizados. |
| 15.1.8 | Publicar meta | Mudar status de Rascunho para Publicada | Status atualizado. Nao pode mais editar estrutura (apenas avaliar). |

### 15.2 Tab Avaliacao
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 15.2.1 | Avaliar KPI | Inserir valor realizado | Calculo de % atingimento. |
| 15.2.2 | Permissao de avaliacao | Member tenta avaliar | Bloqueado se nao tem goals_evaluate. |
| 15.2.3 | Periodo de avaliacao | Selecionar periodo | Dados do periodo. |

### 15.3 Exportacao
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 15.3.1 | Export XLS | Clicar "XLS" | Arquivo com dados de metas. |
| 15.3.2 | Export PDF | Clicar "PDF" | Relatorio formatado. |

---

## 16. CSAT

**Rota:** `#csat` | **Permissao:** `csat_send` ou `csat_view_all`

### 16.1 Gestao de Pesquisas
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 16.1.1 | KPIs | Acessar pagina | Media, NPS, Taxa Resposta, Total Enviado, Respondidas. |
| 16.1.2 | Criar pesquisa | Clicar "+ Nova Pesquisa" | Modal abre. |
| 16.1.3 | Campo tarefa | Selecionar tarefa concluida | Dropdown lista apenas concluidas. |
| 16.1.4 | Email invalido | Digitar "teste@" | Validacao bloqueia. |
| 16.1.5 | Email valido com + | Digitar "nome+label@empresa.com" | **VERIFICAR:** Regex pode rejeitar (bug potencial). |
| 16.1.6 | Enviar agora | Marcar "Enviar agora" > Salvar | Pesquisa criada e enviada. Status "sent". |
| 16.1.7 | Nao enviar agora | Desmarcar "Enviar agora" > Salvar | Pesquisa criada com status "pending". |
| 16.1.8 | Filtro por status | Clicar pills de status | Cards/tabela filtrados. |
| 16.1.9 | Busca | Digitar email ou tarefa | Pesquisas filtradas. |
| 16.1.10 | Visualizacao cards vs tabela | Alternar toggle | Layout muda sem perda de dados. |
| 16.1.11 | Ver resposta | Clicar em pesquisa respondida | Detalhes: score, comentario, data. |
| 16.1.12 | Distribuicao de notas | Verificar grafico | Barras corretas. Soma = total respondidas. |
| 16.1.13 | NPS calculo | Verificar valor NPS | (Promotores - Detratores) / Respondidas * 100. |
| 16.1.14 | Zero respondidas | Nenhuma pesquisa respondida | "Sem respostas". Sem divisao por zero. |

### 16.2 Pesquisa CSAT em Massa
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 16.2.1 | Bulk CSAT | Abrir modal bulk > selecionar multiplas > Enviar | Pesquisas criadas em lote. |

### 16.3 Auto CSAT
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 16.3.1 | Envio automatico | Configurar auto > concluir tarefa com email | Pesquisa enviada automaticamente. |

### 16.4 Exportacao
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 16.4.1 | Export XLS | Clicar "XLS" | Dados de pesquisas exportados. |
| 16.4.2 | Export PDF | Clicar "PDF" | Relatorio com metricas. |

---

## 17. DASHBOARDS DE PRODUTIVIDADE

**Rota:** `#dashboards` | **Permissao:** `analytics_view` ou `dashboard_view`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 17.1 | Carga inicial | Acessar pagina | KPIs e graficos carregam. |
| 17.2 | Seletor de periodo | Dia / Semana / Mes / Trimestre / Ano | Dados recalculam para o periodo. |
| 17.3 | Periodo customizado | Definir datas de/ate > Aplicar | Dados do periodo custom. |
| 17.4 | Filtro por usuario | Selecionar usuario(s) | Metricas do(s) usuario(s). |
| 17.5 | Filtro por nucleo | Selecionar nucleo | Metricas do nucleo. |
| 17.6 | Filtro por setor | Selecionar setor | Metricas do setor. |
| 17.7 | Limpar filtros | Clicar "Limpar filtros" | Todos os filtros resetados. |
| 17.8 | KPI cards | Verificar cada card | Valores numericos corretos. Icones e cores. |
| 17.9 | Grafico de evolucao | Verificar line chart | Dados mensais/semanais corretos. |
| 17.10 | Grafico por nucleo | Verificar bar chart | Nucleos com valores corretos. |
| 17.11 | CSAT geral | Verificar grafico CSAT | Dados de satisfacao corretos. |
| 17.12 | Heatmap | Verificar mapa de calor | Dados por dia da semana/hora. |
| 17.13 | Export XLS | Clicar "XLS" | Planilha com dados do dashboard. |
| 17.14 | Export PDF | Clicar "PDF" | Relatorio visual com graficos. |
| 17.15 | Dashboard vazio | Periodo sem dados | Graficos com mensagem "Sem dados". KPIs zerados. |

---

## 18. NEWSLETTERS (NL PERFORMANCE)

**Rota:** `#nl-performance` | **Permissao:** `analytics_view`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 18.1 | Carga de dados | Acessar pagina | Tabela de campanhas carrega. KPIs no topo. |
| 18.2 | Filtro por BU | Selecionar BU especifica | Campanhas da BU. |
| 18.3 | Filtro por periodo | 7d / 30d / 90d / 365d / Custom | Campanhas do periodo. |
| 18.4 | Periodo custom | Definir datas > Aplicar | Campanhas no range. |
| 18.5 | KPI - Total enviado | Verificar valor | Soma de emails enviados. |
| 18.6 | KPI - Taxa entrega | Verificar % | (Entregues / Enviados) * 100. |
| 18.7 | KPI - Taxa abertura | Verificar % | (Aberturas unicas / Entregues) * 100. |
| 18.8 | KPI - Taxa clique | Verificar % | (Cliques unicos / Entregues) * 100. |
| 18.9 | Tabela scrollavel | Scroll horizontal | Colunas fixas (data, campanha) ficam visiveis. |
| 18.10 | Wave merging | Campanhas com multiplos envios (U0197_1/2/3) | Linhas mescladas corretamente. Metricas agregadas. |
| 18.11 | Modo edicao | Ativar "Pre-editar linhas" | Checkboxes e botoes de ocultar aparecem. |
| 18.12 | Ocultar linha | Clicar "Ocultar" em linha | Linha fica com opacidade. Flag "editada". |
| 18.13 | Restaurar todas | Clicar "Restaurar" | Todas as linhas ocultas reaparecem. |
| 18.14 | Export XLS | Clicar "XLSX" | Planilha com dados (respeita edicoes). |
| 18.15 | Export PDF | Clicar "PDF" | Relatorio formatado. |
| 18.16 | Status de sincronia | Verificar indicador | Data/hora da ultima sincronizacao. |
| 18.17 | Sem dados | BU sem campanhas | Mensagem "Nenhuma campanha encontrada". |

---

## 19. INSTAGRAM (META PERFORMANCE)

**Rota:** `#meta-performance` | **Permissao:** `analytics_view`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 19.1 | Carga de dados | Acessar pagina | Tabela de posts carrega. KPIs no topo. |
| 19.2 | Filtro por conta | Selecionar @primetourviagens ou @icsbyprimetour | Posts da conta. |
| 19.3 | Filtro por tipo | Post / Reel / Carrossel / Story | Posts do tipo. |
| 19.4 | Filtro por periodo | 7d / 30d / 90d / 365d / Custom | Posts do periodo. |
| 19.5 | KPIs | Verificar Reach, Impressions, Engagement, Engagement Rate | Valores corretos e formatados. |
| 19.6 | Top Posts | Verificar secao | 5-10 melhores posts com metricas. |
| 19.7 | Thumbnails | Verificar imagens | Thumbnails carregam corretamente. |
| 19.8 | Colunas de Story | Selecionar tipo Story | Colunas especificas: Exits, Taps forward/back. |
| 19.9 | Colunas de Reels | Selecionar tipo Reel | Coluna "Plays" aparece. |
| 19.10 | Modo edicao | Ativar "Pre-editar" | Funcionalidade de ocultar linhas. |
| 19.11 | Export XLS | Clicar "XLSX" | Planilha com dados. |
| 19.12 | Export PDF | Clicar "PDF" | Relatorio formatado. |

---

## 20. GOOGLE ANALYTICS

**Rota:** `#ga-performance` | **Permissao:** `analytics_view`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 20.1 | Carga de dados | Acessar pagina | KPIs e tabelas carregam. |
| 20.2 | Seletor de propriedade | Selecionar propriedade GA4 | Dados da propriedade. |
| 20.3 | Seletor de periodo | 7d / 14d / 28d / 30d / 90d / 365d | Dados recalculam. |
| 20.4 | KPIs | Verificar todos os 9 KPIs | Valores numericos corretos. |
| 20.5 | Grafico Users & Sessions | Verificar line chart | Dual axis funcional. |
| 20.6 | Grafico Engagement | Verificar line chart | Bounce rate e engagement rate. |
| 20.7 | Tab Daily | Verificar tabela | Metricas diarias. Sortable. |
| 20.8 | Tab Pages | Mudar para Pages | Top paginas por views. |
| 20.9 | Tab Sources | Mudar para Sources | Fontes de trafego. |
| 20.10 | Tab Devices | Mudar para Devices | Breakdown por dispositivo. |
| 20.11 | Tab Countries | Mudar para Countries | Breakdown geografico. |
| 20.12 | Ordenacao | Clicar header de coluna | Ordena ASC/DESC. Indicador visual. |
| 20.13 | Export XLS | Clicar "XLSX" | Multi-sheet (1 por tab). |
| 20.14 | Export PDF | Clicar "PDF" | Relatorio com graficos. |

---

## 21. ROTEIROS DE VIAGEM — LISTA

**Rota:** `#roteiros` | **Permissao:** `roteiro_access`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 21.1 | Carga inicial | Acessar pagina | Lista de roteiros carrega. |
| 21.2 | Sem permissao | Login como partner | Mensagem "Sem permissao". |
| 21.3 | Lista vazia | Nenhum roteiro criado | Mensagem "Nenhum roteiro" + botao "Criar primeiro". |
| 21.4 | Botao Novo Roteiro | Clicar "+ Novo Roteiro" | Navega para #roteiro-editor. |
| 21.5 | Filtro por status | Clicar pill "Rascunho" | Apenas rascunhos. |
| 21.6 | Filtro "Todos" | Clicar pill "Todos" | Todos os roteiros. |
| 21.7 | Busca | Digitar nome de cliente | Roteiros do cliente. |
| 21.8 | Busca por destino | Digitar nome de cidade | Roteiros com a cidade. |
| 21.9 | Card click | Clicar no card de roteiro | Navega para editor com ?id=xxx. |
| 21.10 | Duplicar roteiro | Clicar "Duplicar" | Novo roteiro criado. Navega para editor. Toast. |
| 21.11 | Alterar status | Clicar "Status" > Selecionar novo status | Modal de status. Status atualizado. Toast. |
| 21.12 | Excluir roteiro | Clicar "X" > Confirmar | Roteiro removido. Toast. |
| 21.13 | Excluir (cancelar) | Clicar "X" > Cancelar | Roteiro permanece. |
| 21.14 | Excluir sem permissao | Member tenta excluir roteiro de outro | Botao "X" nao aparece. |
| 21.15 | Info no card | Verificar card | Titulo, cliente, destinos, noites, consultor, data, status badge. |

---

## 22. ROTEIROS DE VIAGEM — EDITOR

**Rota:** `#roteiro-editor` ou `#roteiro-editor?id=xxx` | **Permissao:** `roteiro_create`

### 22.1 Secao 1: Cliente
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 22.1.1 | Campos basicos | Preencher nome, email, telefone | Valores aceitos e persistidos ao salvar. |
| 22.1.2 | Autocomplete cliente | Digitar nome de cliente recente | Datalist sugere clientes anteriores. |
| 22.1.3 | Selecionar cliente recente | Escolher do datalist | Email e telefone preenchidos automaticamente. |
| 22.1.4 | Tipo de cliente | Selecionar cada tipo (individual/couple/family/group) | Dropdown funciona. |
| 22.1.5 | Adultos e criancas | Definir adultos=2, criancas=3 | Campos de idades aparecem (3 inputs). |
| 22.1.6 | Diminuir criancas | Mudar de 3 para 1 crianca | **VERIFICAR:** Campos de idades devem reduzir para 1. Idades anteriores nao devem persistir. |
| 22.1.7 | Idades invalidas | Digitar idade > 17 | Verificar validacao (min=0, max=17). |
| 22.1.8 | Preferencias | Clicar checkboxes de preferencias | Visual toggle (classe "checked"). |
| 22.1.9 | Restricoes | Clicar checkboxes de restricoes | Visual toggle. |
| 22.1.10 | Perfil economico | Selecionar standard/premium/luxury | Dropdown funciona. |
| 22.1.11 | Notas | Digitar texto longo no textarea | Texto salvo integralmente. |

### 22.2 Secao 2: Viagem
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 22.2.1 | Data de inicio | Selecionar data futura | Campo preenchido. |
| 22.2.2 | Adicionar destino | Clicar "+ Adicionar Destino" | Nova linha na tabela. |
| 22.2.3 | Preencher destino | Cidade, Pais, Continente, Noites | Dados aceitos. |
| 22.2.4 | Total de noites | Adicionar 2 destinos com 3 e 4 noites | Total exibe "7 noites". |
| 22.2.5 | Data de termino | Com inicio 01/05 e 7 noites | Termino exibe 08/05. |
| 22.2.6 | Remover destino | Clicar "X" em destino | Destino removido. Total recalcula. |
| 22.2.7 | Destino sem cidade | Adicionar destino sem preencher cidade | **VERIFICAR:** Deve alertar ou aceitar? Aparece em branco no PDF. |
| 22.2.8 | Noites = 0 | Definir 0 noites em destino | **VERIFICAR:** Deve aceitar (day trip) ou alertar? |
| 22.2.9 | Auto-gerar dias | Clicar "Auto-gerar dias" | Dias criados baseados nos destinos. Secao Dia a Dia abre. |
| 22.2.10 | Auto-gerar sem dados | Clicar "Auto-gerar dias" sem destinos ou data | Mensagem de erro. Nao cria dias. |
| 22.2.11 | Data inicio vazia | Remover data de inicio | Data de termino fica vazia. |

### 22.3 Secao 3: Dia a Dia
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 22.3.1 | Cards de dias | Apos auto-gerar | 1 card por dia com numero, data, titulo, cidade, narrativa. |
| 22.3.2 | Editar titulo | Mudar titulo do dia | Valor salvo. |
| 22.3.3 | Editar narrativa | Digitar texto no textarea | Texto salvo. |
| 22.3.4 | Gerar com IA | Clicar "Gerar com IA" no dia 1 | Busca skill de narrativa. Texto gerado inserido no textarea. |
| 22.3.5 | IA sem skill | Nenhuma skill de narrativa configurada | **VERIFICAR:** Mensagem de erro clara (nao silencioso). |
| 22.3.6 | IA com contexto | Gerar IA com destino, cliente, preferencias preenchidos | Narrativa usa contexto (destino, preferencias). |
| 22.3.7 | Adicionar dia manual | Clicar "+ Adicionar Dia" | Novo card com dayNumber incrementado. |
| 22.3.8 | Remover dia | Clicar "Remover" em dia 2 de 5 | Dia removido. Dias 3-5 renumerados para 2-4. |
| 22.3.9 | Remover todos os dias | Remover cada dia ate 0 | Lista vazia. Mensagem "Nenhum dia". |
| 22.3.10 | Narrativa longa | Colar texto de 5000 caracteres | Texto aceito. Sem truncamento. |
| 22.3.11 | IA durante geracao | Clicar "Gerar com IA" e clicar de novo antes de terminar | Botao desabilitado durante geracao. |

### 22.4 Secao 4: Hoteis
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 22.4.1 | Adicionar hotel | Clicar "+ Adicionar Hotel" | Nova linha na tabela. |
| 22.4.2 | Preencher hotel | Cidade, hotel, quarto, regime, check-in/out | Dados aceitos. |
| 22.4.3 | Calculo de noites | Check-in 01/05, Check-out 04/05 | Noites = 3. |
| 22.4.4 | Check-out antes de check-in | Check-in 05/05, Check-out 01/05 | **VERIFICAR:** Noites negativas ou zero? Deve alertar. |
| 22.4.5 | Somente check-in | Preencher check-in sem check-out | Noites fica vazio (sem erro no console). |
| 22.4.6 | Remover hotel | Clicar "X" | Hotel removido da tabela. |
| 22.4.7 | Multiplos hoteis | Adicionar 5 hoteis | Todos exibidos. Scroll se necessario. |

### 22.5 Secao 5: Valores
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 22.5.1 | Moeda | Selecionar BRL/USD/EUR | Dropdown funciona. |
| 22.5.2 | Valor por pessoa | Digitar 5000.50 | Aceita decimais (step=0.01). |
| 22.5.3 | Valor por casal | Digitar 9000 | Aceita inteiros. |
| 22.5.4 | Valor negativo | Digitar -500 | **VERIFICAR:** Aceita? Nao deveria. |
| 22.5.5 | Valido ate | Selecionar data | Data salva. |
| 22.5.6 | Disclaimer | Digitar texto longo | Texto salvo. |
| 22.5.7 | Linhas customizadas | Adicionar linha: "Seguro viagem" = "R$ 350" | Linha adicionada. |
| 22.5.8 | Remover linha | Clicar "X" na linha custom | Linha removida. |

### 22.6 Secao 6: Opcionais
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 22.6.1 | Adicionar opcional | Clicar "+ Adicionar Opcional" | Nova linha. |
| 22.6.2 | Preencher | Servico, preco adulto, preco crianca, notas | Dados aceitos. |
| 22.6.3 | Preco vazio | Preencher servico sem precos | **VERIFICAR:** Aceita? Nulo no PDF? |
| 22.6.4 | Remover | Clicar "X" | Opcional removido. |
| 22.6.5 | Servico duplicado | Adicionar mesmo servico 2x | **VERIFICAR:** Nenhuma validacao (aceita duplicado). |

### 22.7 Secao 7: Inclui / Nao Inclui
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 22.7.1 | Adicionar inclui | Clicar "+ Adicionar" em Inclui | Novo campo. |
| 22.7.2 | Adicionar nao inclui | Clicar "+ Adicionar" em Nao Inclui | Novo campo. |
| 22.7.3 | Carregar presets | Clicar "Carregar Presets" | Modal com checkboxes de presets comuns. |
| 22.7.4 | Aplicar presets | Selecionar 5 presets > Aplicar | 5 itens adicionados as listas. |
| 22.7.5 | Preset duplicado | Aplicar presets que ja existem | **VERIFICAR:** Duplica ou ignora? |
| 22.7.6 | Item vazio | Adicionar sem preencher texto | **VERIFICAR:** Aceita? Aparece como bullet vazio no PDF. |
| 22.7.7 | Remover item | Clicar "X" | Item removido. |

### 22.8 Secao 8: Pagamento
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 22.8.1 | Campos de texto livre | Preencher deposito, parcelamento, prazo | Valores aceitos. |
| 22.8.2 | Observacoes | Digitar observacoes | Texto salvo. |
| 22.8.3 | Campos vazios | Salvar sem preencher | **VERIFICAR:** Aceita? Secao vazia no PDF? |

### 22.9 Secao 9: Cancelamento
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 22.9.1 | Adicionar regra | Clicar "+ Adicionar Regra" | Nova linha. |
| 22.9.2 | Preencher | Periodo e penalidade | Dados aceitos. |
| 22.9.3 | Periodos sobrepostos | "60-30 dias" e "45-15 dias" | **VERIFICAR:** Aceita sem validacao (esperado, texto livre). |
| 22.9.4 | Remover regra | Clicar "X" | Regra removida. |

### 22.10 Secao 10: Informacoes Importantes
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 22.10.1 | Campos fixos | Preencher passaporte, visto, vacinas, clima, bagagem, voos | Todos salvos. |
| 22.10.2 | Auto-preencher do Portal | Clicar "Auto-preencher do Portal" | **VERIFICAR:** Busca dados do portal_tips pelo destino. Preenche campos de clima, etc. |
| 22.10.3 | Auto-preencher sobrescreve | Ter dados manuais > Auto-preencher | **VERIFICAR:** Dados manuais sao substituidos sem confirmacao (bug potencial). |
| 22.10.4 | Auto-preencher sem destino | Sem destinos definidos > Auto-preencher | Mensagem de erro ou nada acontece (sem crash). |
| 22.10.5 | Auto-preencher falha | Portal sem dados do destino | **VERIFICAR:** Mensagem de erro (nao silencioso). |
| 22.10.6 | Campo customizado | Adicionar campo "Moeda local" = "Iene" | Campo adicionado. |
| 22.10.7 | Remover campo custom | Clicar "X" | Campo removido. |

### 22.11 Secao 11: Preview & Export
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 22.11.1 | Titulo do roteiro | Preencher titulo | Titulo salvo. |
| 22.11.2 | Seletor de area/BU | Selecionar area | Dropdown carrega areas do portal. |
| 22.11.3 | Status | Mudar status | Status atualizado ao salvar. |
| 22.11.4 | Export PDF | Clicar "Exportar PDF" | Arquivo PDF baixado com 10 secoes. |
| 22.11.5 | PDF sem dias | Roteiro sem dias > Export PDF | **VERIFICAR:** Erro tratado com mensagem (nao crash). |
| 22.11.6 | PDF sem area | Sem area selecionada > Export PDF | **VERIFICAR:** PDF gerado com cores padrao ou erro. |
| 22.11.7 | PDF completo | Roteiro com todos os dados > Export PDF | Capa, day-by-day, hoteis, valores, opcionais, inclui/nao inclui, pagamento, cancelamento, info, fechamento. Paginacao. |
| 22.11.8 | Export PPTX | Clicar "Exportar PPTX" | Arquivo PPTX baixado. |
| 22.11.9 | PPTX slides | Abrir PPTX | Slides: capa, day-by-day, hoteis, valores, inclui/nao inclui, fechamento. |
| 22.11.10 | Gerar web link | Clicar "Gerar Web Link" | Link gerado. URL exibida. Botao "Copiar". |
| 22.11.11 | Copiar link | Clicar "Copiar" | URL copiada para clipboard. Toast de confirmacao. |
| 22.11.12 | Abrir web link | Abrir URL em aba anonima | Pagina publica carrega com dados do roteiro. |

### 22.12 Comportamentos Gerais do Editor
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 22.12.1 | Salvar | Clicar botao "Salvar" | Dados persistidos no Firestore. Toast sucesso. |
| 22.12.2 | Ctrl+S | Pressionar Ctrl+S | Salva sem recarregar pagina. |
| 22.12.3 | Dirty tracking | Modificar qualquer campo | Indicador "alteracoes nao salvas" aparece. |
| 22.12.4 | Voltar sem salvar | Clicar "Voltar" com alteracoes pendentes | Modal "Deseja salvar?" com opcoes Salvar/Descartar/Cancelar. |
| 22.12.5 | Voltar apos salvar | Salvar > Clicar "Voltar" | Navega sem modal (nao esta dirty). |
| 22.12.6 | Recarregar roteiro | Salvar > Navegar para lista > Clicar no roteiro | Todos os dados preservados (11 secoes). |
| 22.12.7 | Accordion | Clicar headers das secoes | Secoes expandem/colapsam. |
| 22.12.8 | Roteiro novo | Acessar #roteiro-editor (sem id) | Editor vazio com dados padrao. |
| 22.12.9 | Roteiro existente | Acessar #roteiro-editor?id=xxx | Dados do roteiro carregados. |

---

## 23. ROTEIROS DE VIAGEM — DASHBOARD

**Rota:** `#roteiro-dashboard` | **Permissao:** `roteiro_manage`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 23.1 | Carga inicial | Acessar pagina | 6 KPIs + 8 graficos + tabela de geracoes. |
| 23.2 | KPI - Total | Verificar contagem | Total de roteiros no Firestore. |
| 23.3 | KPI - Este Mes | Verificar | Roteiros criados no mes atual. |
| 23.4 | KPI - Rascunhos | Verificar | Roteiros com status "draft". |
| 23.5 | KPI - Enviados | Verificar | Roteiros com status "sent". |
| 23.6 | KPI - Aprovados | Verificar | Roteiros com status "approved". |
| 23.7 | KPI - Taxa Conversao | Verificar | (Aprovados / Enviados) * 100. Sem divisao por zero. |
| 23.8 | Filtro de periodo | 7d / 30d / 90d / 1 ano / Tudo | KPIs e graficos recalculam. |
| 23.9 | Grafico evolucao mensal | Verificar line chart | Ultimos 12 meses. |
| 23.10 | Grafico pipeline | Verificar doughnut | Draft, review, sent, approved, archived. |
| 23.11 | Top destinos | Verificar bar chart | Destinos mais cotados. |
| 23.12 | Perfil clientes | Verificar doughnut | Individual, couple, family, group. |
| 23.13 | Perfil economico | Verificar bar chart | Standard, premium, luxury. |
| 23.14 | Formatos export | Verificar pie chart | PDF, PPTX, Web. |
| 23.15 | Por consultor | Verificar bar chart | Roteiros por consultor. |
| 23.16 | Moedas | Verificar chart | BRL, USD, EUR. |
| 23.17 | Tabela de geracoes | Verificar | Data, usuario, destino, formato. |
| 23.18 | Export XLS | Clicar "Exportar XLS" | 2 sheets: Roteiros + Geracoes. |
| 23.19 | Dashboard vazio | Sem roteiros | KPIs zerados. Graficos vazios. Sem erros. |
| 23.20 | Permissao Firestore | Acessar dashboard | **VERIFICAR:** Sem erro "Missing or insufficient permissions" (regras atualizadas). |

---

## 24. PORTAL DE DICAS — GERACAO

**Rota:** `#portal-tips` | **Permissao:** `portal_access`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 24.1 | Area picker | Clicar para selecionar area | Categorias exibidas. Navegacao por sub-areas. |
| 24.2 | Busca de area | Digitar nome no campo de busca | Filtra areas (com normalizacao de acentos). |
| 24.3 | Navegacao por teclado | Usar setas + Enter | Navega e seleciona areas. |
| 24.4 | Seletor de destino | Selecionar Continente > Pais > Cidade | Cascata funcional. |
| 24.5 | Multi-destino | Adicionar 2+ destinos | Destinos adicionados como chips. |
| 24.6 | Remover destino extra | Clicar "X" em destino extra | Destino removido. |
| 24.7 | Segmentos | Selecionar segmentos | Checkboxes funcionam. |
| 24.8 | Todos/Nenhum | Clicar "Todos" e "Nenhum" | Todos selecionados / desmarcados. |
| 24.9 | Formato de saida | Selecionar PDF/PPTX/HTML/LINK | Radio button funciona. |
| 24.10 | Preview card | Mudar area/destino | Preview atualiza dinamicamente. |
| 24.11 | Gerar material | Clicar "Gerar" | Material gerado. Download inicia ou link exibido. |
| 24.12 | Termos de uso | Primeiro acesso (partner) | Modal de termos aparece. Deve aceitar antes de gerar. |
| 24.13 | Limite de downloads | Partner apos 5 downloads no dia | Botao desabilitado. Mensagem de limite. |
| 24.14 | Sem area | Gerar sem selecionar area | Validacao bloqueia. |
| 24.15 | Sem destino | Gerar sem selecionar destino | Validacao bloqueia. |

---

## 25. PORTAL DE DICAS — EDITOR DE DICAS

**Rota:** `#portal-tip-editor` | **Permissao:** `portal_create`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 25.1 | Seletor cascata | Continente > Pais > Cidade | Cascata funcional. |
| 25.2 | Carregar dica | Selecionar destino > "Carregar Dica" | Dados existentes carregam ou cria nova dica. |
| 25.3 | Flag prioritaria | Marcar "Destino prioritario" | Flag salva. |
| 25.4 | Sidebar de segmentos | Verificar nav vertical | Segmentos com status (vazio/preenchido/expirado). |
| 25.5 | Navegar segmentos | Clicar em cada segmento na sidebar | Painel direito muda para o segmento. |
| 25.6 | Info Geral | Preencher campos estruturados | Dados salvos. |
| 25.7 | Bairros (lista simples) | Adicionar/remover itens | Itens adicionados/removidos. |
| 25.8 | Atracoes (lista de lugares) | Adicionar atracao com nome, descricao, endereco, etc. | Formulario completo funciona. |
| 25.9 | Restaurantes | Similar a atracoes | Funciona identicamente. |
| 25.10 | Agenda Cultural | Adicionar evento com periodo | Campo periodo funciona. |
| 25.11 | Validade | Marcar "Tem validade" > Definir data | Data de expiracao salva. |
| 25.12 | Salvar dica | Clicar "Salvar Dica" | Toast sucesso. Dados persistidos. |
| 25.13 | Auto-save | Modificar campo e aguardar | Indicador de auto-save. |
| 25.14 | Dirty state | Modificar campo sem salvar | Indicador de alteracoes pendentes. |
| 25.15 | Dica com todos os segmentos | Preencher todos os segmentos | Todos persistidos ao recarregar. |

---

## 26. PORTAL DE DICAS — DICAS CADASTRADAS

**Rota:** `#portal-tips-list` | **Permissao:** `portal_create`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 26.1 | Listagem | Acessar pagina | Tabela de dicas com destino, segmentos, validade. |
| 26.2 | KPIs | Verificar cards | Total, prioritarios, expirados, expirando, OK. |
| 26.3 | Busca | Digitar destino | Tabela filtra. |
| 26.4 | Filtro validade | Selecionar "Expirados" | Apenas dicas expiradas. |
| 26.5 | Filtro prioritarios | Ativar toggle | Apenas prioritarios. |
| 26.6 | Toggle prioridade | Clicar estrela na linha | Prioridade ativada/desativada. |
| 26.7 | Preview | Clicar "Preview" | Modal com conteudo da dica. |
| 26.8 | Materiais gerados | Clicar "Materiais gerados" | Modal com lista de materiais. |
| 26.9 | Editar original | Clicar "Editar original" | Navega para portalTipEditor com destino. |
| 26.10 | Excluir dica | Clicar "X" > Confirmar | Dica removida. |
| 26.11 | Badge de segmentos | Verificar badges | Segmentos exibidos (max 4 + contagem). |
| 26.12 | Badge de validade | Verificar | Verde (OK), Amarelo (expirando), Vermelho (expirado). |

---

## 27. PORTAL DE DICAS — BANCO DE IMAGENS

**Rota:** `#portal-images` | **Permissao:** `portal_manage`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 27.1 | Galeria grid | Acessar pagina | Thumbnails em grid. |
| 27.2 | Vista lista | Alternar para lista | Tabela com metadados. |
| 27.3 | Upload painel | Clicar botao upload | Painel de upload expande. |
| 27.4 | Drag & drop | Arrastar imagem para dropzone | Imagem aparece no painel com preview. |
| 27.5 | Click para upload | Clicar na dropzone > selecionar arquivo | Arquivo adicionado. |
| 27.6 | Validacao de formato | Tentar .gif ou .bmp | Rejeitado (aceita apenas JPG, PNG, WEBP, HEIC). |
| 27.7 | Validacao de tamanho | Arquivo > 10MB | Rejeitado com mensagem. |
| 27.8 | Upload multiplo | Selecionar 5 arquivos | 5 previews com metadados individuais. |
| 27.9 | Metadados padrao | Definir continente/pais/cidade padrao | Aplicados a todas as imagens sem metadado individual. |
| 27.10 | Metadados individuais | Definir metadado em 1 imagem diferente | Metadado individual prevalece sobre padrao. |
| 27.11 | Tags | Adicionar tags em imagem | Chips de tags. |
| 27.12 | Enviar todas | Clicar "Enviar todas" | Progresso por arquivo. Status sucesso/erro. |
| 27.13 | Falha parcial | 1 de 3 imagens falha | 2 com sucesso, 1 com erro. Log exibido. |
| 27.14 | Navegacao breadcrumb | Clicar em continente > pais > cidade | Filtro hierarquico funciona. |
| 27.15 | Busca | Digitar tag ou nome | Imagens filtradas. |
| 27.16 | Lightbox | Clicar em thumbnail | Imagem fullsize. Navegacao prev/next. |
| 27.17 | Lightbox teclas | Setas esq/dir, Esc | Navegam e fecham. |
| 27.18 | Excluir imagem | Botao direito ou botao X | Imagem removida. |
| 27.19 | Editar metadados | Botao de edicao em imagem | Modal de edicao. |

---

## 28. PORTAL DE DICAS — AREAS/BUs

**Rota:** `#portal-areas` | **Permissao:** `portal_manage`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 28.1 | Listagem | Acessar pagina | Grid de areas com logo, nome, cor. |
| 28.2 | Criar area | Clicar "+ Nova Area" > Preencher > Salvar | Area criada. Card aparece. |
| 28.3 | Nome obrigatorio | Salvar sem nome | Validacao bloqueia. |
| 28.4 | Logo URL | Inserir URL de logo | Preview da logo atualiza em tempo real. |
| 28.5 | Cores | Escolher cor primaria e secundaria | Preview visual. |
| 28.6 | Categoria | Digitar/selecionar categoria | Datalist funciona. |
| 28.7 | Editar area | Clicar "Editar" > Mudar dados > Salvar | Dados atualizados. |
| 28.8 | Excluir area | Clicar "Excluir" > Confirmar | Area removida. |
| 28.9 | Excluir area com materiais | Excluir area que tem materiais gerados | **VERIFICAR:** Aviso ou bloqueio? |

---

## 29. PORTAL DE DICAS — DESTINOS

**Rota:** `#portal-destinations` | **Permissao:** `portal_manage`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 29.1 | Listagem | Acessar pagina | Tabela de destinos. |
| 29.2 | Filtro continente | Selecionar continente | Tabela filtra. Dropdown de pais atualiza. |
| 29.3 | Filtro pais | Selecionar pais | Tabela filtra por pais. |
| 29.4 | Contagem | Verificar display "X destino(s)" | Numero correto. |
| 29.5 | Criar destino | Clicar "+ Novo Destino" > Preencher > Salvar | Destino criado. Tabela atualiza. |
| 29.6 | Continente obrigatorio | Salvar sem continente | Validacao bloqueia. |
| 29.7 | Pais obrigatorio | Salvar sem pais | Validacao bloqueia. |
| 29.8 | Status dica | Destino com dica cadastrada | Badge "Cadastrada" verde. |
| 29.9 | Status sem dica | Destino sem dica | Badge "Sem dica" cinza. |
| 29.10 | Editar destino | Clicar "Destino" > Editar | Modal de edicao. |
| 29.11 | Ir para dica | Clicar "Dica" | Navega para portalTipEditor com destino. |
| 29.12 | Excluir destino | Clicar "X" > Confirmar | Destino removido. |

---

## 30. PORTAL DE DICAS — IMPORTACAO

**Rota:** `#portal-import` | **Permissao:** `portal_create`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 30.1 | Download modelo | Clicar "Baixar Planilha Modelo" | Arquivo .xlsx baixado. |
| 30.2 | Upload arquivo | Arrastar .xlsx para dropzone | Arquivo parseado. Status exibido. |
| 30.3 | Upload click | Clicar na dropzone > selecionar .xlsx | Arquivo parseado. |
| 30.4 | Arquivo invalido | Upload .pdf ou .doc | Rejeitado com mensagem. |
| 30.5 | Preview de importacao | Apos parse | Resumo: X destinos, Y itens. Cards por destino. |
| 30.6 | Confirmar importacao | Clicar "Confirmar e Importar" | Progresso real-time. Status por destino/segmento. |
| 30.7 | Importacao com erro | Arquivo com dados invalidos | Log mostra erros em vermelho. Itens validos importados. |
| 30.8 | Cancelar | Clicar "Cancelar" antes de importar | Reset para estado inicial. |
| 30.9 | Manual de importacao | Clicar "Manual de Importacao" | Navega para portalImportManual. |

---

## 31. PORTAL DE DICAS — DASHBOARD

**Rota:** `#portal-dashboard` | **Permissao:** `portal_manage`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 31.1 | KPIs | Verificar cards | Areas, destinos, dicas, imagens, geracoes, validade. |
| 31.2 | Filtro periodo | 7d / 30d / 60d / 90d / Custom | Dados recalculam. |
| 31.3 | Filtro usuario | Selecionar usuario | Geracoes do usuario. |
| 31.4 | Graficos | Verificar todos os graficos | Dados corretos. Sem erros. |
| 31.5 | Tabela destinos | Verificar validade | Sorting funciona. |
| 31.6 | Tabela geracoes | Verificar log | Datas, formatos, usuarios corretos. |
| 31.7 | Export XLS | Clicar "XLS" | Planilha com dados. |
| 31.8 | Export PDF | Clicar "PDF" | Relatorio formatado. |
| 31.9 | Refresh | Clicar "Atualizar" | Dados recarregados. |

---

## 32. LANDING PAGES

**Rota:** `#landing-pages` | **Permissao:** `portal_manage`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 32.1 | Listagem | Acessar pagina | Cards de LPs com status, titulo, views. |
| 32.2 | Criar LP | Clicar "+ Nova Landing Page" | Layout picker modal. |
| 32.3 | Selecionar layout | Clicar em layout | Builder modal abre. |
| 32.4 | Nome da LP | Editar nome no header | Nome salvo. |
| 32.5 | Slug | Editar slug | Verificacao de disponibilidade em tempo real. |
| 32.6 | Slug duplicado | Usar slug existente | Indicador de "slug em uso". |
| 32.7 | Adicionar secao | Clicar "+ Secao" | Nova secao adicionada. |
| 32.8 | Tipos de secao | Hero, texto/CTA, galeria, testimonials, FAQ, pricing | Cada tipo renderiza corretamente. |
| 32.9 | Editar secao | Selecionar secao > Editar campos | Campos especificos do tipo. |
| 32.10 | Reordenar secoes | Drag-to-reorder na lista | Ordem muda. |
| 32.11 | Remover secao | Clicar "X" na secao | Secao removida. |
| 32.12 | Preview | Clicar "Preview" | Visualizacao da LP. |
| 32.13 | Salvar | Clicar "Salvar" | Dados persistidos. |
| 32.14 | Publicar | Clicar "Publicar" | Status muda. Link publico ativo. |
| 32.15 | Despublicar | Clicar "Despublicar" | LP offline. Link inativo. |
| 32.16 | Abrir link | Clicar "Abrir" em LP publicada | Nova aba com lp.html#{slug}. |
| 32.17 | Excluir LP | Clicar "X" > Confirmar | LP removida. |

---

## 33. CMS / SITE

**Rota:** `#cms` | **Permissao:** `portal_manage`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 33.1 | Status | Acessar pagina | Badge "Em desenvolvimento". |
| 33.2 | Info cards | Verificar conteudo | Visao, arquitetura, features planejadas. |
| 33.3 | Sem funcionalidade ativa | Nao ha formularios ativos | Pagina informacional apenas. |

---

## 34. EDITOR DE ARTES

**Rota:** `#arts-editor` | **Permissao:** `portal_manage`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 34.1 | Grid de templates | Acessar pagina | Thumbnails dos templates. |
| 34.2 | Busca | Digitar nome de template | Templates filtrados. |
| 34.3 | Filtro categoria | Clicar pill de categoria | Templates da categoria. |
| 34.4 | Filtro setor | Selecionar setor | Templates do setor. |
| 34.5 | Abrir editor | Clicar em template | Canvas Fabric.js carrega com template. |
| 34.6 | Manipular objetos | Selecionar, mover, redimensionar objetos | Canvas responsivo. Handles funcionam. |
| 34.7 | Editar texto | Duplo-clique em texto | Modo de edicao inline. Font, tamanho, cor. |
| 34.8 | Filtros de imagem | Selecionar imagem > aplicar filtro | Brightness, contrast, blur, etc. aplicados. |
| 34.9 | Banco de imagens | Abrir painel de imagens | Busca e selecao de imagens do portal. |
| 34.10 | Arrastar imagem | Arrastar imagem do banco para canvas | Imagem adicionada ao canvas. |
| 34.11 | Layers | Verificar painel de layers | Add/remove/reorder funcional. |
| 34.12 | Salvar template | Clicar "Salvar" | Template persistido. |
| 34.13 | Sair do editor | Clicar "Sair" | Retorna ao grid. |
| 34.14 | Criar template (admin) | Clicar "+ Novo template" | Novo canvas em branco. |
| 34.15 | Gerenciar categorias (admin) | Clicar "Categorias" | Modal de CRUD de categorias. |
| 34.16 | Guia | Clicar "Guia" | Modal com melhores praticas. |

---

## 35. MONITOR DE NOTICIAS

**Rota:** `#news-monitor` | **Permissao:** `dashboard_view`

### 35.1 Tab Noticias
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 35.1.1 | Listagem | Acessar tab | Tabela de noticias. |
| 35.1.2 | Criar noticia | Clicar "+ Nova noticia" > Preencher > Salvar | Noticia criada. |
| 35.1.3 | Campo titulo obrigatorio | Salvar sem titulo | Validacao bloqueia. |
| 35.1.4 | Filtro categoria | Selecionar categoria | Noticias filtradas. |
| 35.1.5 | Filtro validade | Selecionar "Expirados" | Noticias expiradas. |
| 35.1.6 | Filtro periodo | Definir datas | Noticias no periodo. |
| 35.1.7 | KPIs | Verificar strip | Total, validas, expiradas, ultimos 7 dias. |
| 35.1.8 | Link fonte | Clicar "Ver fonte" | Abre URL em nova aba. |
| 35.1.9 | Editar noticia | Clicar "Editar" > Mudar > Salvar | Dados atualizados. |
| 35.1.10 | Excluir noticia | Clicar "X" > Confirmar | Noticia removida. |
| 35.1.11 | Busca | Digitar texto | Noticias contendo o texto. |

### 35.2 Tab Clipping
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 35.2.1 | Listagem | Acessar tab Clipping | Tabela de clippings. |
| 35.2.2 | Criar clipping | Preencher formulario > Salvar | Clipping criado. |
| 35.2.3 | Filtro midia | Online/Impresso/TV/Radio | Filtrado corretamente. |
| 35.2.4 | Sentimento | Positivo/Neutro/Negativo | Filtrado por sentimento. |

### 35.3 Exportacao
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 35.3.1 | Export XLS | Clicar "XLS" | Planilha com noticias. |
| 35.3.2 | Export PDF | Clicar "PDF" | Relatorio formatado. |

---

## 36. USUARIOS

**Rota:** `#users` | **Permissao:** `system_manage_users`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 36.1 | Listagem | Acessar pagina | Tabela de usuarios com avatar, nome, email, role, status. |
| 36.2 | Stats | Verificar cards | Total, ativos, admin/head, managers/coordinators. |
| 36.3 | Busca | Digitar nome ou email | Usuarios filtrados. |
| 36.4 | Filtro por cargo | Selecionar role | Usuarios do role. |
| 36.5 | Filtro por status | Ativo/Inativo | Usuarios filtrados. |
| 36.6 | Ordenacao | Clicar header de coluna | Ordena ASC/DESC. |
| 36.7 | Paginacao | Navegar paginas | Dados corretos por pagina. |
| 36.8 | Criar usuario | Clicar "+ Novo Usuario" > Preencher > Salvar | Usuario criado. |
| 36.9 | Email obrigatorio | Salvar sem email | Validacao bloqueia. |
| 36.10 | Email duplicado | Criar com email existente | Erro claro. |
| 36.11 | Editar usuario | Clicar "Editar" > Mudar role/setor > Salvar | Dados atualizados. |
| 36.12 | Desativar usuario | Clicar "Desativar" | Status muda para inativo. |
| 36.13 | Reativar usuario | Clicar "Ativar" | Status muda para ativo. |
| 36.14 | Excluir usuario | Clicar "Excluir" > Confirmar | Usuario removido permanentemente. |
| 36.15 | Reset senha | Clicar "Reset Senha" | Instrucoes/Firebase link exibidos. |
| 36.16 | Avatar color | Escolher cor do avatar | Preview atualiza. |
| 36.17 | Export | Clicar "Exportar" | Arquivo com dados de usuarios. |

---

## 37. SETORES E NUCLEOS

**Rota:** `#sectors` | **Permissao:** `system_manage_users`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 37.1 | Listagem | Acessar pagina | Grid de setores com nucleos e membros. |
| 37.2 | Criar nucleo | Clicar "+ Novo Nucleo" > Preencher > Salvar | Nucleo criado no setor. |
| 37.3 | Setor obrigatorio | Salvar sem setor | Validacao bloqueia. |
| 37.4 | Nome obrigatorio | Salvar sem nome | Validacao bloqueia. |
| 37.5 | Seletor de cor | Escolher cor (12 opcoes) | Preview do badge atualiza. |
| 37.6 | Editar nucleo | Clicar "Editar" > Mudar > Salvar | Dados atualizados. Badge atualiza. |
| 37.7 | Excluir nucleo | Clicar "X" > Confirmar | Nucleo removido do setor. |
| 37.8 | Membros | Verificar avatar stack | Membros do setor exibidos (max 8 + overflow). |
| 37.9 | Setor sem nucleos | Setor sem nucleos cadastrados | "Nenhum nucleo cadastrado". |

---

## 38. TIPOS DE TAREFA

**Rota:** `#task-types` | **Permissao:** `task_type_create` ou `system_manage_users`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 38.1 | Listagem | Acessar pagina | Lista de tipos de tarefa. |
| 38.2 | Criar tipo | Criar com nome, campos customizados, etapas | Tipo criado. |
| 38.3 | Campos dinamicos | Adicionar campos: texto, select, data, checkbox, arquivo | Cada tipo de campo funciona. |
| 38.4 | Campo obrigatorio | Marcar campo como obrigatorio | Validacao ao criar tarefa com esse tipo. |
| 38.5 | Etapas (pipeline) | Definir etapas sequenciais | Etapas salvas. Visiveis no Kanban Pipeline. |
| 38.6 | Editar tipo | Mudar campos/etapas > Salvar | Atualizado. Tarefas existentes afetadas? |
| 38.7 | Excluir tipo | Excluir > Confirmar | Tipo removido. Tarefas existentes mantidas. |
| 38.8 | Categorias | Verificar agrupamento | Tipos agrupados por categoria. |

---

## 39. ROLES E PERMISSOES

**Rota:** `#roles` | **Permissao:** `system_manage_roles` ou `system_manage_users`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 39.1 | Grid de roles | Acessar pagina | Cards de roles com cor, nome, permissoes. |
| 39.2 | Roles do sistema | Verificar master, admin, manager, coordinator, member, partner | Badge "Sistema". Nao editaveis (estrutura). |
| 39.3 | Criar role custom | Clicar "+ Novo Role" > Preencher > Salvar | Role criado. Card aparece. |
| 39.4 | Nome obrigatorio | Salvar sem nome | Validacao bloqueia. |
| 39.5 | Seletor de cor | Escolher entre 9 cores | Borda do card atualiza. |
| 39.6 | Permissoes em grupos | Expandir/colapsar grupos | Checkboxes por permissao. |
| 39.7 | Tooltip de permissao | Hover no "i" da permissao | Descricao da permissao. |
| 39.8 | Editar permissoes | Mudar permissoes de role custom > Salvar | Permissoes atualizadas. Usuarios do role afetados. |
| 39.9 | Ver permissoes sistema | Clicar "Ver permissoes" em role sistema | Modal readonly com todas as permissoes. |
| 39.10 | Excluir role custom | Clicar "X" > Confirmar | Role removido. |
| 39.11 | Excluir role em uso | Excluir role que tem usuarios | **VERIFICAR:** Bloqueia ou transfere usuarios? |
| 39.12 | Contagem de permissoes | Verificar progress bar | X de 44 permissoes ativas. |

---

## 40. IA SKILLS

**Rota:** `#ai-skills` | **Permissao:** `system_manage_settings`

### 40.1 Tab Skills
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 40.1.1 | Listagem | Acessar tab Skills | Cards de skills agrupados por modulo. |
| 40.1.2 | Criar skill | Preencher nome, modulo, provider, model, prompt > Salvar | Skill criada. |
| 40.1.3 | Provider cascata | Selecionar provider > Models atualizam | Models do provider selecionado. |
| 40.1.4 | Testar skill | Clicar "Testar" > Inserir input > Executar | Output gerado. Tokens e tempo exibidos. |
| 40.1.5 | Teste sem API key | Testar sem key configurada | Erro claro sobre falta de API key. |
| 40.1.6 | Toggle ativo/inativo | Clicar toggle | Status muda. Skill nao aparece para uso. |
| 40.1.7 | Editar skill | Clicar "Editar" > Mudar > Salvar | Dados atualizados. |
| 40.1.8 | Excluir skill | Clicar "X" > Confirmar | Skill removida. |
| 40.1.9 | Knowledge base | Selecionar documentos da base | Documentos linkados a skill. |
| 40.1.10 | Folder da base | Verificar campo folder | Datalist com pastas existentes. |

### 40.2 Tab Config API
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 40.2.1 | Providers | Verificar cards de providers | OpenAI, Anthropic, Gemini, Azure, Groq. |
| 40.2.2 | Salvar API key | Inserir key > Salvar | Key mascarada ("sk-...****"). Indicador configurado. |
| 40.2.3 | Azure endpoint | Inserir endpoint + key > Salvar | Ambos salvos. |
| 40.2.4 | Defaults globais | Definir provider e max tokens padrao | Defaults salvos. |

### 40.3 Tab Knowledge Base
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 40.3.1 | Upload documento | Selecionar PDF/TXT/DOCX | Documento carregado. |
| 40.3.2 | Categorizar | Definir categoria e nome | Metadados salvos. |
| 40.3.3 | Editar documento | Mudar nome/categoria | Atualizado. |
| 40.3.4 | Excluir documento | Clicar excluir > Confirmar | Documento removido. |

### 40.4 Tab Logs
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 40.4.1 | Listagem | Acessar tab Logs | Tabela com historico de chamadas. |
| 40.4.2 | Filtros | Filtrar por data, skill, modulo | Logs filtrados. |
| 40.4.3 | Detalhes | Clicar em log | Timestamp, usuario, tokens in/out, custo, status. |

---

## 41. IA DASHBOARD

**Rota:** `#ai-dashboard` | **Permissao:** `system_manage_settings`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 41.1 | KPIs | Verificar cards | Total calls, tokens, input, output, users, custo estimado. |
| 41.2 | Filtro periodo | 7d / 30d / 90d / All-time | Dados recalculam. |
| 41.3 | Calls per day | Verificar line chart | Dados diarios corretos. |
| 41.4 | Tokens per day | Verificar stacked bar | Input vs output separados. |
| 41.5 | By module | Verificar donut | Modulos com proporcoes corretas. |
| 41.6 | By provider | Verificar donut | Providers usados. |
| 41.7 | By model | Verificar donut | Models usados. |
| 41.8 | Top skills | Verificar horizontal bar | Skills mais usadas. |
| 41.9 | Top users | Verificar horizontal bar | Usuarios mais ativos. |
| 41.10 | Cost by module | Verificar stacked bar | Custos por modulo. |
| 41.11 | Unused skills | Verificar card list | Skills sem uso no periodo. |
| 41.12 | Sem dados | Periodo sem chamadas IA | KPIs zerados. Graficos vazios. Sem erros. |

---

## 42. AUDITORIA

**Rota:** `#audit` | **Permissao:** `system_manage_settings`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 42.1 | Listagem | Acessar pagina | Tabela de logs com timestamp, acao, usuario, recurso. |
| 42.2 | Stats | Verificar 4 cards | Registros hoje, acoes auth, usuarios ativos, total periodo. |
| 42.3 | Busca | Digitar texto | Logs filtrados. |
| 42.4 | Filtro por acao | Selecionar acao (optgroups) | Logs da acao. |
| 42.5 | Filtro por usuario | Selecionar usuario | Logs do usuario. |
| 42.6 | Filtro por periodo | Definir datas | Logs no range. |
| 42.7 | Limpar filtros | Clicar "Limpar" | Todos os filtros resetados. |
| 42.8 | Expandir detalhes | Clicar em linha de log | Detalhes expandem. |
| 42.9 | Badge de acao | Verificar cor do badge | Cores por tipo (auth, create, update, delete). |
| 42.10 | Paginacao | Navegar paginas | Dados corretos. Controles funcionais. |
| 42.11 | Atualizar | Clicar "Atualizar" | Dados recarregados. |
| 42.12 | Export XLS | Clicar "XLS" | Planilha com logs. |
| 42.13 | Export PDF | Clicar "PDF" | Relatorio de auditoria. |

---

## 43. CONFIGURACOES

**Rota:** `#settings` | **Permissao:** `system_manage_settings`

### 43.1 Secao Geral
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 43.1.1 | Nome da empresa | Mudar nome > Salvar | Nome atualizado em todo o sistema. |
| 43.1.2 | Timezone | Mudar timezone | Datas/horas recalculam. |
| 43.1.3 | Idioma | Mudar idioma | Interface traduz (se suportado). |
| 43.1.4 | Itens por pagina | Mudar para 25 | Tabelas mostram 25 itens por pagina. |
| 43.1.5 | Cor de destaque | Mudar cor | Elementos da UI atualizam. |

### 43.2 Secao Tarefas
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 43.2.1 | Membros criam tarefas | Desativar toggle | Member nao consegue criar tarefa. |
| 43.2.2 | Auto-atribuir criador | Ativar toggle | Ao criar tarefa, criador auto-atribuido. |
| 43.2.3 | Exigir prazo | Ativar toggle > Criar tarefa sem prazo | Validacao bloqueia. |
| 43.2.4 | Exigir projeto | Ativar toggle > Criar tarefa sem projeto | Validacao bloqueia. |
| 43.2.5 | Limite subtarefas | Definir 5 > Criar tarefa com 6 subtarefas | **VERIFICAR:** Bloqueio ao adicionar 6a subtarefa. |
| 43.2.6 | Dias antecedencia | Definir 3 dias | Notificacoes de prazo 3 dias antes. |

### 43.3 Secao Notificacoes
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 43.3.1 | Cada toggle | Ativar/desativar cada tipo | Notificacao enviada/nao enviada conforme config. |

### 43.4 Secao CSAT
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 43.4.1 | Oferecer pesquisa | Ativar > Concluir tarefa | Overlay CSAT aparece. |
| 43.4.2 | Exigir email | Ativar > Criar tarefa sem email | Campo email obrigatorio. |
| 43.4.3 | Expiracao link | Definir 30 dias | Links CSAT expiram em 30 dias. |
| 43.4.4 | Mensagem padrao | Editar mensagem | Usada como default em novos CSATs. |

### 43.5 Secao Dados
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 43.5.1 | Export tarefas | Clicar card Tarefas | Arquivo exportado. |
| 43.5.2 | Export projetos | Clicar card Projetos | Arquivo exportado. |
| 43.5.3 | Export usuarios | Clicar card Usuarios | Arquivo exportado. |
| 43.5.4 | Export auditoria | Clicar card Auditoria | Arquivo exportado. |
| 43.5.5 | Limpar cache | Clicar "Limpar cache" | Cache limpo. Confirmacao. |
| 43.5.6 | Redefinir config | Clicar "Redefinir" | Confirmacao. Valores padrao restaurados. |

### 43.6 Migracao (Master only)
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 43.6.1 | Executar migracao | Clicar "Executar migracao" | Barra de progresso. Migracao de setores/nucleos. |
| 43.6.2 | Visibilidade | Login nao-master | Secao de migracao nao aparece. |

---

## 44. INTEGRACOES

**Rota:** `#integrations` | **Permissao:** admin

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 44.1 | Listagem | Acessar pagina | Cards de integracoes disponiveis. |
| 44.2 | Stats | Verificar 3 cards | Conectadas, categorias, disponiveis. |
| 44.3 | Tabs de categoria | Clicar em cada tab | Cards filtrados por categoria. |
| 44.4 | Conectar Slack | Clicar "Conectar" > Preencher config | Formulario especifico do Slack. |
| 44.5 | Testar conexao | Clicar "Testar" | Resultado: sucesso/falha com mensagem. |
| 44.6 | Salvar config | Preencher > Salvar | Integracao ativa. Status verde. |
| 44.7 | Toggle integracao | Desativar toggle | Integracao pausada. |
| 44.8 | Desconectar | Clicar "X" | Integracao removida. Config limpa. |
| 44.9 | Import Figma | Preencher Team ID > Carregar projetos | Projetos listados com checkboxes. |
| 44.10 | Import GitHub | Preencher owner/repo > Carregar issues | Issues listadas. |
| 44.11 | Importar selecionados | Selecionar itens > Importar | Tarefas criadas a partir dos itens. |
| 44.12 | Campo senha | Verificar mascara | API key mascarada. Toggle de visibilidade. |
| 44.13 | Docs link | Clicar link de documentacao | Abre URL externa. |

---

## 45. PERFIL DO USUARIO

**Rota:** `#profile`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 45.1 | Dados pessoais | Verificar nome, email, role | Dados corretos. |
| 45.2 | Editar nome | Mudar nome > Salvar | Nome atualizado (sidebar, header, etc.). |
| 45.3 | Mudar avatar | Trocar cor do avatar | Nova cor aplicada. |
| 45.4 | Permissoes | Verificar lista de permissoes | Permissoes do role exibidas. |

---

## 46. SOBRE O SISTEMA

**Rota:** `#about` | **Permissao:** `system_manage_users`

| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 46.1 | Info do sistema | Acessar pagina | Versao, stack tecnologico, creditos. |

---

## 47. PAGINAS PUBLICAS

### 47.1 solicitar.html (Portal de Solicitacoes)
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 47.1.1 | Carga | Abrir solicitar.html em aba anonima | Formulario publico carrega. |
| 47.1.2 | Campos | Preencher nome, email, tipo, descricao | Campos aceitos. |
| 47.1.3 | Enviar | Preencher > Enviar | Solicitacao criada no Firestore. Confirmacao. |
| 47.1.4 | Campos obrigatorios | Enviar sem preencher | Validacao bloqueia. |
| 47.1.5 | Mobile | Abrir em celular | Layout responsivo funcional. |

### 47.2 csat-response.html (Resposta CSAT)
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 47.2.1 | Link valido | Abrir com token valido | 5 botoes de nota (1-5) com emojis. |
| 47.2.2 | Link expirado | Abrir com token expirado | Mensagem "Pesquisa expirada". |
| 47.2.3 | Ja respondida | Abrir pesquisa ja respondida | Mensagem "Ja respondida" com nota/comentario. |
| 47.2.4 | Selecionar nota | Clicar nota 4 | Botao 4 selecionado. Outros deselecionados. |
| 47.2.5 | Enviar sem nota | Clicar "Enviar" sem selecionar nota | Botao desabilitado. |
| 47.2.6 | Comentario | Digitar comentario (ate 500 chars) | Texto aceito. |
| 47.2.7 | Comentario longo | Colar texto > 500 chars | **VERIFICAR:** Truncado ou aceito? |
| 47.2.8 | Enviar resposta | Selecionar nota + comentario > Enviar | Sucesso. Tela de agradecimento. |
| 47.2.9 | Token invalido | Abrir com token inexistente | Mensagem "Pesquisa nao encontrada". |
| 47.2.10 | Firebase offline | Simular offline | Mensagem de erro (nao crash). |

### 47.3 portal-view.html (Visualizador de Dicas)
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 47.3.1 | Link valido | Abrir com token | Pagina publica com dicas do destino. |
| 47.3.2 | Navegacao interna | Clicar nav de segmentos | Scroll suave para secao. |
| 47.3.3 | Multi-destino | Roteiro com 3 destinos | Tabs de destino funcionam. |
| 47.3.4 | Galeria de imagens | Verificar imagens | Imagens carregam. Fallback para placeholder se necessario. |
| 47.3.5 | Imagem com erro | URL de imagem invalida | Imagem ocultada (onerror handler). |
| 47.3.6 | Mobile | Abrir em celular | Layout responsivo. |
| 47.3.7 | Cores da area | Area com cores custom | CSS variables atualizadas. |
| 47.3.8 | ViewCount | Abrir link | viewCount incrementa no Firestore. |
| 47.3.9 | Token invalido | Token inexistente | Mensagem "Nao encontrado". |
| 47.3.10 | Texto com HTML | Dica com <script> ou <b> no texto | HTML escapado (XSS prevenido). |

### 47.4 roteiro-view.html (Visualizador de Roteiro)
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 47.4.1 | Link valido | Abrir com token | Roteiro completo: hero, nav, timeline, hoteis, etc. |
| 47.4.2 | Sticky nav | Scroll pela pagina | Nav fixa no topo ao rolar. |
| 47.4.3 | Timeline day-by-day | Verificar timeline | Cards de dias com narrativa. |
| 47.4.4 | Hoteis | Verificar secao | Cards de hoteis com detalhes. |
| 47.4.5 | Valores | Verificar secao | Precos, moeda, disclaimer. |
| 47.4.6 | Opcionais | Verificar tabela | Servicos com precos. |
| 47.4.7 | Inclui/Nao inclui | Verificar listas | Checkmarks verdes e Xs vermelhos. |
| 47.4.8 | Info importante | Verificar accordion | Secoes expandiveis. |
| 47.4.9 | Cores da area | Area com cores custom | Tema aplicado. |
| 47.4.10 | ViewCount | Abrir link | viewCount incrementa. |
| 47.4.11 | Mobile | Abrir em celular | Layout mobile-first funcional. |
| 47.4.12 | Token invalido | Token inexistente | Mensagem de erro. |

### 47.5 lp.html (Landing Page Viewer)
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 47.5.1 | Slug valido | Abrir lp.html#{slug} | LP renderiza com todas as secoes. |
| 47.5.2 | Secoes dinâmicas | LP com hero, texto, galeria, FAQ | Cada secao renderiza corretamente. |
| 47.5.3 | CTA buttons | Clicar botoes de acao | Scroll anchor ou link externo funciona. |
| 47.5.4 | FAQ accordion | Clicar em perguntas | Respostas expandem/colapsam. |
| 47.5.5 | Galeria lightbox | Clicar em imagem | Lightbox abre. |
| 47.5.6 | Mobile | Abrir em celular | Responsivo. Menu mobile. |
| 47.5.7 | LP nao publicada | Abrir LP com status draft | Mensagem "Pagina nao encontrada" ou bloqueio. |
| 47.5.8 | Slug invalido | Slug inexistente | Mensagem de erro. |

---

## 48. TESTES TRANSVERSAIS

### 48.1 Performance
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 48.1.1 | Carga com muitos dados | 100+ tarefas, 50+ roteiros | Paginas carregam em <3s. Sem travamento. |
| 48.1.2 | Memory leaks | Navegar entre 20+ paginas sem recarregar | Memoria nao cresce indefinidamente. |
| 48.1.3 | CDN offline | Bloquear CDN (jsPDF, Chart.js) | Erro tratado. Mensagem clara. Sem crash. |

### 48.2 Seguranca
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 48.2.1 | XSS em titulo | Criar tarefa com titulo `<script>alert(1)</script>` | Texto exibido literalmente, nao executado. |
| 48.2.2 | XSS em comentario | Comentario com `<img onerror=alert(1)>` | HTML escapado. |
| 48.2.3 | XSS em nome de cliente | Roteiro com cliente `<b>test</b>` | HTML escapado no editor e PDF. |
| 48.2.4 | Manipulacao de URL | Acessar #roteiro-editor?id=ID_ALHEIO | Verificar se carrega (permissao) ou bloqueia. |
| 48.2.5 | Firestore rules | Via console, tentar write em audit_logs | Bloqueado por rules. |
| 48.2.6 | Partner fora do portal | Partner tenta acessar #tasks via URL | Rota bloqueada. Redireciona. |

### 48.3 Responsividade
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 48.3.1 | Desktop (1920px) | Verificar todas as paginas | Layout completo. |
| 48.3.2 | Tablet (768px) | Verificar todas as paginas | Layout adapta. Sidebar colapsada. |
| 48.3.3 | Mobile (375px) | Verificar todas as paginas | Layout mobile. Hamburger menu. |
| 48.3.4 | Modais mobile | Abrir modais no mobile | Modais ocupam tela cheia ou adaptam. |
| 48.3.5 | Tabelas mobile | Tabelas com muitas colunas | Scroll horizontal. Colunas fixas visiveis. |

### 48.4 Tema Claro/Escuro
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 48.4.1 | Todas as paginas | Alternar tema e visitar cada pagina | Cores adaptam. Textos legiveis. Contraste adequado. |
| 48.4.2 | Modais | Abrir modais em cada tema | Fundo, borda, texto corretos. |
| 48.4.3 | Graficos | Verificar Chart.js em tema escuro | Labels e eixos visiveis. |
| 48.4.4 | PDF/PPTX | Gerar export em tema escuro | PDF nao e afetado pelo tema (cores proprias). |

### 48.5 Navegacao
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 48.5.1 | Voltar do navegador | Navegar A > B > C > Voltar | Retorna a B. Pagina carrega. |
| 48.5.2 | URL direta | Colar URL com hash (#dashboard) | Pagina carrega diretamente apos login. |
| 48.5.3 | Pagina 404 | Acessar #rota-inexistente | Pagina 404 exibida. |
| 48.5.4 | Recarregar pagina | F5 em qualquer pagina | Pagina recarrega corretamente na mesma rota. |
| 48.5.5 | Cleanup de pagina | Navegar saindo do editor de roteiro | destroyRoteiroEditor() executado. Sem erros no console. |

### 48.6 Erros e Console
| # | Teste | Passos | Resultado Esperado |
|---|-------|--------|--------------------|
| 48.6.1 | Console limpo | Navegar por todas as paginas | Sem erros vermelhos no console. Warnings aceitaveis. |
| 48.6.2 | Erro de rede | Simular offline (DevTools > Network > Offline) | Mensagens de erro. Toasts de falha. Sem crash. |
| 48.6.3 | Toast de erro | Provocar erro (ex: salvar sem conexao) | Toast.error() exibido com mensagem util. |
| 48.6.4 | Toast de sucesso | Completar acao (criar tarefa) | Toast.success() exibido brevemente. |

---

## 49. MATRIZ DE PERMISSOES

Testar que cada perfil tem acesso apenas ao que deveria:

### Rotas por Perfil

| Rota | master | admin | manager | coordinator | member | partner |
|------|:------:|:-----:|:-------:|:-----------:|:------:|:-------:|
| dashboard | SIM | SIM | SIM | SIM | SIM | NAO |
| tasks | SIM | SIM | SIM | SIM | SIM | NAO |
| projects | SIM | SIM | SIM | SIM | SIM | NAO |
| kanban | SIM | SIM | SIM | SIM | SIM | NAO |
| calendar | SIM | SIM | SIM | SIM | SIM | NAO |
| timeline | SIM | SIM | SIM | SIM | NAO* | NAO |
| workspaces | SIM | SIM | SIM | SIM | NAO* | NAO |
| requests | SIM | SIM | SIM | SIM | SIM | NAO |
| notifications | SIM | SIM | SIM | SIM | SIM | NAO |
| team | SIM | SIM | SIM | SIM | NAO* | NAO |
| feedbacks | SIM | SIM | SIM | SIM | SIM* | NAO |
| goals | SIM | SIM | SIM | SIM | SIM | NAO |
| csat | SIM | SIM | SIM | SIM | NAO* | NAO |
| dashboards | SIM | SIM | SIM | SIM | SIM | NAO |
| nl-performance | SIM | SIM | SIM | NAO* | NAO | NAO |
| meta-performance | SIM | SIM | SIM | NAO* | NAO | NAO |
| ga-performance | SIM | SIM | SIM | NAO* | NAO | NAO |
| roteiros | SIM | SIM | SIM | SIM | SIM | NAO |
| roteiro-editor | SIM | SIM | SIM | SIM | SIM | NAO |
| roteiro-dashboard | SIM | SIM | SIM | NAO | NAO | NAO |
| portal-tips | SIM | SIM | SIM | SIM | SIM | SIM |
| portal-tip-editor | SIM | SIM | SIM | SIM | SIM | NAO |
| portal-tips-list | SIM | SIM | SIM | SIM | SIM | NAO |
| portal-images | SIM | SIM | SIM | NAO | NAO | NAO |
| portal-areas | SIM | SIM | SIM | NAO | NAO | NAO |
| portal-destinations | SIM | SIM | SIM | NAO | NAO | NAO |
| portal-dashboard | SIM | SIM | SIM | NAO | NAO | NAO |
| portal-import | SIM | SIM | SIM | SIM | SIM | NAO |
| landing-pages | SIM | SIM | SIM | NAO | NAO | NAO |
| cms | SIM | SIM | SIM | NAO | NAO | NAO |
| arts-editor | SIM | SIM | SIM | NAO | NAO | NAO |
| news-monitor | SIM | SIM | SIM | SIM | SIM | NAO |
| users | SIM | SIM | NAO | NAO | NAO | NAO |
| sectors | SIM | SIM | NAO | NAO | NAO | NAO |
| task-types | SIM | SIM | SIM | NAO* | NAO | NAO |
| roles | SIM | SIM | NAO | NAO | NAO | NAO |
| ai-skills | SIM | SIM | NAO | NAO | NAO | NAO |
| ai-dashboard | SIM | SIM | NAO | NAO | NAO | NAO |
| audit | SIM | SIM | NAO | NAO | NAO | NAO |
| settings | SIM | SIM | NAO | NAO | NAO | NAO |
| integrations | SIM | SIM | NAO | NAO | NAO | NAO |

> *NAO = depende das permissoes especificas do role. Verificar conforme SYSTEM_ROLES em rbac.js.*

### Teste para cada perfil:
1. Login com o perfil
2. Verificar itens visiveis na sidebar
3. Tentar acessar cada rota via URL (#rota)
4. Verificar que rotas nao autorizadas exibem mensagem ou redirecionam
5. Verificar que botoes de acao (criar, editar, excluir) respeitam permissoes

---

## APENDICE A: BUGS POTENCIAIS CONHECIDOS

| ID | Modulo | Descricao | Severidade |
|----|--------|-----------|------------|
| B01 | roteiroEditor | Idades de criancas persistem quando quantidade diminui | ALTA |
| B02 | roteiroEditor | IA falha silenciosamente se nenhuma skill encontrada | ALTA |
| B03 | roteiroEditor | Auto-preencher do Portal sobrescreve dados sem confirmacao | MEDIA |
| B04 | roteiroEditor | Destinos sem cidade aceitos (aparecem em branco no PDF) | MEDIA |
| B05 | roteiroEditor | Valores negativos aceitos em precos | BAIXA |
| B06 | roteiroEditor | Items vazios em inclui/nao inclui aceitos | BAIXA |
| B07 | roteiroEditor | Presets podem duplicar items existentes | BAIXA |
| B08 | csat | Regex de email rejeita emails validos com "+" | MEDIA |
| B09 | csat-response | Comentario >500 chars nao validado no submit | BAIXA |
| B10 | csat-response | Timezone de expiracao pode divergir | MEDIA |
| B11 | portal-view | esc() de URL de imagem com query params quebra URL | ALTA |
| B12 | portal-view | Observer de navegacao criado 2x (duplica highlights) | BAIXA |
| B13 | taskModal | Mudanca de tipo perde valores de campos customizados | MEDIA |
| B14 | taskModal | Subtarefa com titulo vazio permitida | BAIXA |
| B15 | taskModal | Data inicio > data prazo aceita sem alerta | MEDIA |
| B16 | kanban | Estado de drag persiste apos navegacao | BAIXA |
| B17 | hoteis | Check-out antes de check-in: noites negativas/undefined | MEDIA |
| B18 | roteiroGenerator | CDN offline nao tem timeout tratado | MEDIA |
| B19 | roteiroDashboard | Firestore permissions se rules nao atualizadas | CRITICA |

---

## APENDICE B: COMO REPORTAR BUGS

Para cada bug encontrado, registrar:

1. **ID do teste:** Referencia da tabela (ex: 22.1.6)
2. **Pagina/Rota:** Onde ocorreu
3. **Perfil de teste:** Qual perfil estava logado
4. **Navegador:** Chrome/Safari/Firefox + versao
5. **Passos para reproduzir:** Sequencia exata
6. **Resultado esperado:** O que deveria acontecer
7. **Resultado obtido:** O que aconteceu
8. **Screenshot/Console:** Captura de tela + erros do console
9. **Severidade:** Critica / Alta / Media / Baixa
10. **Observacoes:** Contexto adicional

---

*Fim do Manual de Verificacao de Bugs — PRIMETOUR V11*
