/**
 * PRIMETOUR — Biblioteca de Templates (SSOT + service layer)
 *
 * Sprint v4.63.x: Upload de templates real (HTML/DOCX/PPTX).
 *
 * Arquitetura (CLAUDE.md decisões com Renê 28/05/2026):
 * - HTML  → renderiza PDF (Puppeteer) E Web link (mesmo arquivo serve 2 formatos)
 * - DOCX  → docxtemplater (template Word com placeholders Mustache no XML)
 * - PPTX  → pptxtemplater (template PowerPoint idem)
 *
 * Placeholders: Handlebars {{cliente.nome}} consistente nos 3 formatos.
 *
 * Permissão: nova role `templates_manage` (separada de portal_areas_manage).
 * Hard delete: master only (bibliotecas são imutáveis — use archive).
 *
 * Schema Firestore (templates/{templateId}):
 *
 *   {
 *     name:             'BTG Cotação Padrão Q1 2026',     // string user-facing
 *     module:           'cotacoes' | 'portal' | 'banco-roteiros',
 *     format:           'html' | 'docx' | 'pptx',         // HTML serve PDF+Web
 *     fileUrl:          'https://storage.../tpl_xyz.docx',
 *     fileStoragePath:  'templates/cotacoes/tpl_xyz.docx', // pra delete físico futuro
 *     fileSize:         124800,
 *     fileSha256:       'a3f4b9...',                       // integridade + dedup
 *     fileMime:         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 *     previewUrl:       'https://storage.../thumb.png',    // só HTML por enquanto (v1)
 *     placeholders:     ['cliente.nome', 'viagem.dataInicio', 'dias', ...],
 *     ownerType:        'area' | 'global',
 *     ownerId:          'lazer' | null,
 *     isDefault:        false,                              // default da área pra esse module+format
 *     status:           'active' | 'archived',
 *
 *     version:          1,
 *     parentTemplateId: null,                               // doc anterior se update
 *     versionHistory:   [{ version:1, sha:'...', uploadedAt:Timestamp }],
 *     duplicatedFrom:   null,                               // template original se foi duplicado
 *
 *     uploadedAt:       serverTimestamp,
 *     uploadedBy:       uid,
 *     updatedAt:        serverTimestamp,
 *     updatedBy:        uid,
 *   }
 *
 * business_units/{buId}.templateRefs = {
 *   cotacoes: { html: 'tpl_xyz', docx: 'tpl_abc', pptx: 'tpl_def' },
 *   portal:   { ... },
 * }
 */

import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc,
  updateDoc, query, where, orderBy, limit,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';
import { store } from '../store.js';
import { auditLog } from '../auth/audit.js';

const COLLECTION = 'templates';

/* ─── Constantes públicas ───────────────────────────────────────────── */

/** Módulos que aceitam templates uploaded. */
export const TEMPLATE_MODULES = [
  { id: 'cotacoes',       label: 'Cotações',          icon: '✈' },
  { id: 'portal',         label: 'Portal de Dicas',   icon: '💡' },
  { id: 'banco-roteiros', label: 'Banco de Roteiros', icon: '📚' },
];

/** Formatos suportados pra upload. v4.63.22+ Web separado de HTML (PDF). */
export const TEMPLATE_FORMATS = [
  { id: 'html', label: 'HTML → PDF',  ext: ['html', 'htm'], maxMB: 5,  exports: ['pdf'],
    mime: 'text/html',
    desc: 'Template HTML renderizado em PDF via Puppeteer (cotações/portal/banco).' },
  // v4.63.22+ Web Link formato distinto. Diferenças vs html (PDF):
  // - Servido como HTML interativo no browser (sem @page A4, sem print:exact)
  // - Pode incluir <script> + libs externas (Leaflet, Alpine, etc. — SSRF allowlist expandido)
  // - 2 modos via `templateMode` no doc: 'full' (substitui portal-view.html) | 'slots' (injeta partes)
  // - Não é renderizado server-side; servido direto do R2 OU via portal-view-tpl.html proxy
  { id: 'web', label: 'Web Link', ext: ['html', 'htm'], maxMB: 8, exports: ['web'],
    mime: 'text/html',
    desc: 'Template HTML interativo pra Web Link público (cliente abre no browser). Suporta JS + libs externas. 2 modos: full (substitui página) ou slots (header/footer/CSS).' },
  { id: 'docx', label: 'Word',  ext: ['docx'],        maxMB: 10, exports: ['docx'],
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    desc: 'Template Word com placeholders {{cliente.nome}}.' },
  { id: 'pptx', label: 'PowerPoint', ext: ['pptx'],   maxMB: 15, exports: ['pptx'],
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    desc: 'Template PowerPoint com placeholders {{cliente.nome}}.' },
];

/** v4.63.22+ Modos de template Web Link. */
export const WEB_TEMPLATE_MODES = [
  { id: 'full',  label: 'Substituição total',
    desc: 'Template HTML completo substitui portal-view.html / roteiro-view.html. JS interativo (mapa, carrousel, search) precisa ser RE-IMPLEMENTADO no template. Máxima customização.' },
  { id: 'slots', label: 'Slots customizáveis',
    desc: 'portal-view.html canônico mantém tudo (Leaflet, search). Template injeta só PARTES: header HTML, footer HTML, CSS vars extras, fonte custom. Conservador, mais seguro.' },
];

/** Map por id pra lookup O(1). */
export const FORMAT_MAP = Object.fromEntries(TEMPLATE_FORMATS.map(f => [f.id, f]));
export const MODULE_MAP = Object.fromEntries(TEMPLATE_MODULES.map(m => [m.id, m]));

/** Limite global de tamanho de arquivo upload (defensivo). */
export const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * v4.63.20+ Schema de placeholders ENRIQUECIDO por módulo.
 *
 * Cada entry: { key, type, category, required, example, desc }
 *   - type: 'string' | 'number' | 'bool' | 'array' | 'object' | 'url' | 'date'
 *   - category: agrupa pra UI dicionário (cliente/viagem/branding/etc.)
 *   - required: 'always' (sempre presente) | 'common' (geralmente) | 'optional'
 *   - example: valor real de exemplo pra dar contexto
 *   - desc: descrição curta
 *
 * Documento mestre pra autor de template (HTML/DOCX/PPTX). Atualize quando
 * adapter `roteiroToTemplateData`/`portalToTemplateData`/`bancoToTemplateData`
 * ganhar campos. Manual completo: docs/TEMPLATES-AUTHORING-GUIDE.md
 */
export const PLACEHOLDERS_SPEC = {
  cotacoes: [
    // — Root —
    { key: 'titulo',               type: 'string',  category: 'root',     required: 'optional', example: 'Lua de mel — Itália',           desc: 'Título da cotação' },
    { key: 'today',                type: 'date',    category: 'root',     required: 'always',   example: '28/05/2026',                    desc: 'Data de hoje DD/MM/YYYY' },
    { key: 'contact',              type: 'string',  category: 'root',     required: 'optional', example: 'cotacoes@primetour.com.br',     desc: 'Contato pro rodapé/closing' },
    { key: 'customFooterText',     type: 'string',  category: 'root',     required: 'optional', example: 'PRIMETOUR Lazer · …',           desc: 'Texto rodapé (Áreas → Exports config)' },
    { key: 'customHeaderText',     type: 'string',  category: 'root',     required: 'optional', example: 'CONFIDENCIAL',                  desc: 'Texto canto sup. direito' },
    { key: 'hideCover',            type: 'bool',    category: 'root',     required: 'optional', example: 'false',                         desc: 'Pular capa + closing page' },
    { key: 'hasIncExc',            type: 'bool',    category: 'root',     required: 'computed', example: 'true',                          desc: 'Flag visibilidade Inclui/Exclui' },
    // — Branding —
    { key: 'area.nome',            type: 'string',  category: 'branding', required: 'always',   example: 'Lazer',                          desc: 'Nome da área (respeita useExternalName)' },
    { key: 'area.logoUrl',         type: 'url',     category: 'branding', required: 'common',   example: 'https://pub-…r2.dev/logos/lazer.webp', desc: 'Logo principal (R2)' },
    { key: 'area.logoUrlAlt',      type: 'url',     category: 'branding', required: 'optional', example: 'https://pub-…r2.dev/logos/lazer-alt.webp', desc: 'Logo alt (fundo claro)' },
    { key: 'area.corPrimary',      type: 'string',  category: 'branding', required: 'always',   example: '#D4A843',                        desc: 'Cor gold/brand principal' },
    { key: 'area.corSecondary',    type: 'string',  category: 'branding', required: 'always',   example: '#0F172A',                        desc: 'Cor navy escura (fundo capa)' },
    { key: 'area.corAccent',       type: 'string',  category: 'branding', required: 'always',   example: '#D4A843',                        desc: 'Cor accent (titles)' },
    // — Cliente —
    { key: 'cliente.nome',         type: 'string',  category: 'cliente',  required: 'common',   example: 'João e Maria Silva',             desc: 'Nome do cliente' },
    { key: 'cliente.adults',       type: 'number',  category: 'cliente',  required: 'common',   example: '2',                              desc: 'Número de adultos' },
    { key: 'cliente.children',     type: 'number',  category: 'cliente',  required: 'optional', example: '0',                              desc: 'Número de crianças' },
    { key: 'cliente.email',        type: 'string',  category: 'cliente',  required: 'optional', example: 'joao@…',                         desc: 'Email' },
    { key: 'cliente.telefone',     type: 'string',  category: 'cliente',  required: 'optional', example: '+55 11 …',                       desc: 'Phone' },
    { key: 'cliente.adultsLabel',  type: 'string',  category: 'cliente',  required: 'computed', example: '2 adultos',                      desc: 'Label "N adulto(s)" (sem eq helper)' },
    { key: 'cliente.childrenLabel',type: 'string',  category: 'cliente',  required: 'computed', example: '1 criança',                      desc: 'Label "N criança(s)"' },
    { key: 'cliente.paxLabel',     type: 'string',  category: 'cliente',  required: 'computed', example: '2 adultos + 1 criança',          desc: 'Label combinado' },
    // — Viagem —
    { key: 'viagem.dataInicio',    type: 'date',    category: 'viagem',   required: 'common',   example: '01/10/2026',                     desc: 'Data início DD/MM/YYYY (sem timezone shift)' },
    { key: 'viagem.dataFim',       type: 'date',    category: 'viagem',   required: 'common',   example: '12/10/2026',                     desc: 'Data fim' },
    { key: 'viagem.noites',        type: 'number',  category: 'viagem',   required: 'common',   example: '11',                             desc: 'Número de noites' },
    { key: 'viagem.noitesLabel',   type: 'string',  category: 'viagem',   required: 'computed', example: '11 NOITES',                      desc: 'Label uppercase' },
    { key: 'viagem.destinos',      type: 'string',  category: 'viagem',   required: 'common',   example: 'Roma · Florença · Veneza',       desc: 'Joined " · "' },
    { key: 'viagem.destinosLista', type: 'array',   category: 'viagem',   required: 'optional', example: '[{cidade,pais}]',                desc: 'Array detalhado' },
    // — Dias (loop) —
    { key: 'dias',                 type: 'array',   category: 'dias',     required: 'common',   example: '[{numero,cidade,…}]',            desc: 'Array de dias (loop {{#each dias}})' },
    { key: 'dias.[i].numero',      type: 'number',  category: 'dias',     required: 'common',   example: '1',                              desc: 'Dia (1, 2, 3…)' },
    { key: 'dias.[i].data',        type: 'date',    category: 'dias',     required: 'optional', example: '01/10/2026',                     desc: 'Data do dia' },
    { key: 'dias.[i].cidade',      type: 'string',  category: 'dias',     required: 'common',   example: 'Roma',                           desc: 'Cidade' },
    { key: 'dias.[i].narrativa',   type: 'string',  category: 'dias',     required: 'common',   example: 'Chegada em Roma…',               desc: 'Texto descritivo' },
    { key: 'dias.[i].heroUrl',     type: 'url',     category: 'dias',     required: 'optional', example: 'https://pub-…r2.dev/images/roma.webp', desc: 'Hero image (banco_imagens)' },
    { key: 'dias.[i].atividades',  type: 'array',   category: 'dias',     required: 'optional', example: '[{hora,descricao}]',             desc: 'Atividades planejadas' },
    { key: 'dias.[i].pernoite',    type: 'string',  category: 'dias',     required: 'optional', example: 'Roma',                           desc: 'Cidade pernoite' },
    // — Hotéis —
    { key: 'hoteis',               type: 'array',   category: 'hoteis',   required: 'optional', example: '[{…}]',                          desc: 'Array hotéis (loop)' },
    { key: 'hoteis.[i].cidade',    type: 'string',  category: 'hoteis',   required: 'common',   example: 'Roma',                           desc: '' },
    { key: 'hoteis.[i].nome',      type: 'string',  category: 'hoteis',   required: 'common',   example: 'Hotel de Russie',                desc: '' },
    { key: 'hoteis.[i].quarto',    type: 'string',  category: 'hoteis',   required: 'optional', example: 'Junior Suite',                   desc: 'Tipo de quarto' },
    { key: 'hoteis.[i].regime',    type: 'string',  category: 'hoteis',   required: 'optional', example: 'Café da manhã',                  desc: 'Plano' },
    { key: 'hoteis.[i].noites',    type: 'number',  category: 'hoteis',   required: 'common',   example: '3',                              desc: '' },
    { key: 'hoteis.[i].checkIn',   type: 'date',    category: 'hoteis',   required: 'optional', example: '01/10/2026',                     desc: '' },
    { key: 'hoteis.[i].checkOut',  type: 'date',    category: 'hoteis',   required: 'optional', example: '04/10/2026',                     desc: '' },
    // — Voos —
    { key: 'voos',                 type: 'array',   category: 'voos',     required: 'optional', example: '[{…}]',                          desc: 'Array voos' },
    { key: 'voos.[i].cia',         type: 'string',  category: 'voos',     required: 'common',   example: 'LATAM',                          desc: 'Airline' },
    { key: 'voos.[i].numero',      type: 'string',  category: 'voos',     required: 'common',   example: 'LA8084',                         desc: 'Número' },
    { key: 'voos.[i].rota',        type: 'string',  category: 'voos',     required: 'computed', example: 'GRU → FCO',                      desc: 'Origin → Dest formatado' },
    { key: 'voos.[i].dataPartida', type: 'date',    category: 'voos',     required: 'common',   example: '30/09/2026',                     desc: '' },
    { key: 'voos.[i].horaPartida', type: 'string',  category: 'voos',     required: 'optional', example: '20:45',                          desc: '' },
    { key: 'voos.[i].dataChegada', type: 'date',    category: 'voos',     required: 'common',   example: '01/10/2026',                     desc: '' },
    { key: 'voos.[i].horaChegada', type: 'string',  category: 'voos',     required: 'optional', example: '14:30',                          desc: '' },
    { key: 'voos.[i].classe',      type: 'string',  category: 'voos',     required: 'optional', example: 'Business',                       desc: '' },
    // — Preços —
    { key: 'precos.hasData',       type: 'bool',    category: 'precos',   required: 'computed', example: 'true',                           desc: 'Flag visibilidade' },
    { key: 'precos.moeda',         type: 'string',  category: 'precos',   required: 'common',   example: 'BRL',                            desc: 'ISO 4217' },
    { key: 'precos.totalCasal',    type: 'string',  category: 'precos',   required: 'optional', example: 'R$ 124.500,00',                  desc: 'Por casal formatado' },
    { key: 'precos.porPessoa',     type: 'string',  category: 'precos',   required: 'optional', example: 'R$ 62.250,00',                   desc: 'Por pessoa formatado' },
    { key: 'precos.customRows',    type: 'array',   category: 'precos',   required: 'optional', example: '[{label,value}]',                desc: 'Linhas extras' },
    { key: 'precos.validUntil',    type: 'date',    category: 'precos',   required: 'optional', example: '15/06/2026',                     desc: 'Validade da cotação' },
    { key: 'precos.disclaimer',    type: 'string',  category: 'precos',   required: 'optional', example: 'Valores sujeitos…',              desc: 'Disclaimer' },
    // — Inclui/Exclui/Opcionais —
    { key: 'inclui',               type: 'array',   category: 'inclui',   required: 'optional', example: '["Hospedagem"]',                 desc: 'Strings inclui' },
    { key: 'naoInclui',            type: 'array',   category: 'inclui',   required: 'optional', example: '["Gorjetas"]',                   desc: 'Strings exclui' },
    { key: 'opcionais',            type: 'array',   category: 'opcionais',required: 'optional', example: '[{servico,…}]',                  desc: 'Array opcionais' },
    { key: 'opcionais.[i].servico',type: 'string',  category: 'opcionais',required: 'common',   example: 'Aulas culinária',                desc: '' },
    { key: 'opcionais.[i].precoAdulto',  type: 'string', category: 'opcionais', required: 'common', example: 'R$ 850,00', desc: '' },
    { key: 'opcionais.[i].precoCrianca', type: 'string', category: 'opcionais', required: 'common', example: '—',         desc: '' },
    { key: 'opcionais.[i].observacoes',  type: 'string', category: 'opcionais', required: 'optional', example: 'Inclui mercado', desc: '' },
    // — Pagamento/Cancelamento/Info —
    { key: 'pagamento.hasData',    type: 'bool',    category: 'pagamento',required: 'computed', example: 'true',                           desc: 'Flag visibilidade' },
    { key: 'pagamento.deposit',    type: 'string',  category: 'pagamento',required: 'optional', example: 'R$ 25.000',                      desc: 'Sinal/entrada' },
    { key: 'pagamento.installments', type:'string', category: 'pagamento',required: 'optional', example: 'Saldo em 6× cartão',             desc: 'Parcelamento' },
    { key: 'pagamento.deadline',   type: 'string',  category: 'pagamento',required: 'optional', example: '45 dias antes',                  desc: 'Prazo' },
    { key: 'pagamento.notes',      type: 'string',  category: 'pagamento',required: 'optional', example: '…',                              desc: 'Observações' },
    { key: 'cancelamento',         type: 'array',   category: 'cancelamento', required: 'optional', example: '[{period,penalty}]',         desc: 'Períodos × penalidades' },
    { key: 'cancelamento.[i].period', type: 'string', category: 'cancelamento', required: 'common', example: 'Até 60 dias antes', desc: '' },
    { key: 'cancelamento.[i].penalty', type: 'string', category: 'cancelamento', required: 'common', example: 'Multa 10%', desc: '' },
    { key: 'informacoes.hasData',  type: 'bool',    category: 'informacoes', required: 'computed', example: 'true',                       desc: 'Flag visibilidade' },
    { key: 'informacoes.passport', type: 'string',  category: 'informacoes', required: 'optional', example: 'Validade 6 meses+',           desc: 'Passaporte' },
    { key: 'informacoes.visa',     type: 'string',  category: 'informacoes', required: 'optional', example: 'Não necessário',              desc: 'Vistos' },
    { key: 'informacoes.vaccines', type: 'string',  category: 'informacoes', required: 'optional', example: 'Nenhuma obrigatória',         desc: 'Vacinas' },
    { key: 'informacoes.climate',  type: 'string',  category: 'informacoes', required: 'optional', example: 'Outono 15-22°C',              desc: 'Clima' },
    { key: 'informacoes.luggage',  type: 'string',  category: 'informacoes', required: 'optional', example: '2×32kg + mão 8kg',            desc: 'Bagagem' },
    { key: 'informacoes.flights',  type: 'string',  category: 'informacoes', required: 'optional', example: 'Confirmar 72h antes',         desc: 'Voos info' },
    { key: 'informacoes.customFields', type: 'array', category: 'informacoes', required: 'optional', example: '[{label,value}]',         desc: 'Fields custom' },
  ],
  portal: [
    // — Root —
    { key: 'today',                type: 'date',    category: 'root',     required: 'always',   example: '28/05/2026',                    desc: '' },
    { key: 'customFooterText',     type: 'string',  category: 'root',     required: 'optional', example: '…',                             desc: '' },
    { key: 'customHeaderText',     type: 'string',  category: 'root',     required: 'optional', example: '…',                             desc: '' },
    { key: 'hideCover',            type: 'bool',    category: 'root',     required: 'optional', example: 'false',                         desc: '' },
    { key: 'segments',             type: 'array',   category: 'root',     required: 'optional', example: '[]',                            desc: 'Segments custom da área (avançado)' },
    // — Branding —
    { key: 'area.nome',            type: 'string',  category: 'branding', required: 'always',   example: 'Lazer',                         desc: '' },
    { key: 'area.logoUrl',         type: 'url',     category: 'branding', required: 'common',   example: '…',                             desc: 'Logo R2' },
    { key: 'area.logoUrlAlt',      type: 'url',     category: 'branding', required: 'optional', example: '…',                             desc: 'Logo alt' },
    { key: 'area.corPrimary',      type: 'string',  category: 'branding', required: 'always',   example: '#D4A843',                       desc: '' },
    { key: 'area.corSecondary',    type: 'string',  category: 'branding', required: 'always',   example: '#0F172A',                       desc: '' },
    // — Destinos —
    { key: 'destinos',             type: 'array',   category: 'destinos', required: 'common',   example: '[{…}]',                         desc: 'Destinos agrupados (N tips na mesma cidade = 1 destino)' },
    { key: 'destinos.[i].id',      type: 'string',  category: 'destinos', required: 'common',   example: 'paris',                         desc: 'ID do dest' },
    { key: 'destinos.[i].cidade',  type: 'string',  category: 'destinos', required: 'common',   example: 'Paris',                         desc: '' },
    { key: 'destinos.[i].pais',    type: 'string',  category: 'destinos', required: 'optional', example: 'França',                        desc: '' },
    { key: 'destinos.[i].label',   type: 'string',  category: 'destinos', required: 'computed', example: 'Paris, França',                 desc: 'Joined' },
    { key: 'destinos.[i].heroUrl', type: 'url',     category: 'destinos', required: 'optional', example: '…r2.dev/paris-hero.webp',       desc: 'Hero image (banco_imagens)' },
    { key: 'destinos.[i].tips',    type: 'array',   category: 'destinos', required: 'optional', example: '[{…}]',                         desc: 'Tips raw (avançado)' },
    { key: 'destinos.[i].segmentos', type: 'array', category: 'destinos', required: 'common',   example: '[{key,label,mode,…}]',          desc: 'Segmentos shaped (use pra loop)' },
    // — Segments (sub-shape) —
    { key: 'destinos.[i].segmentos.[j].key',   type: 'string', category: 'segmentos', required: 'common', example: 'restaurantes', desc: 'Slug' },
    { key: 'destinos.[i].segmentos.[j].label', type: 'string', category: 'segmentos', required: 'common', example: 'Restaurantes', desc: '' },
    { key: 'destinos.[i].segmentos.[j].mode',  type: 'string', category: 'segmentos', required: 'common', example: 'place_list',   desc: 'special_info | simple_list | place_list | agenda' },
    { key: 'destinos.[i].segmentos.[j].narrative', type: 'string', category: 'segmentos', required: 'optional', example: 'Os melhores bistros…', desc: 'themeDesc' },
    { key: 'destinos.[i].segmentos.[j].items', type: 'array',  category: 'segmentos', required: 'optional', example: '[{name,desc}]', desc: 'Lista' },
    { key: 'destinos.[i].segmentos.[j].info',  type: 'object', category: 'segmentos', required: 'optional', example: '{descricao,…}', desc: 'Info gerais (só se mode=special_info)' },
    // v4.63.22+ Web Link exclusive (formato 'web', não html→PDF)
    { key: 'webUrl',            type: 'url',     category: 'web', required: 'always',   example: 'https://primetour.github.io/tarefas/portal-view.html#token', desc: 'URL canônica do web link (compartilhar)' },
    { key: 'previewUrl',        type: 'url',     category: 'web', required: 'common',   example: 'https://…cloudfunctions.net/previewLink?t=token',          desc: 'URL com OG meta dinâmico pra WhatsApp/social' },
    { key: 'token',             type: 'string',  category: 'web', required: 'always',   example: 'joao-maria-paris-2026',                                    desc: 'Token único do link' },
    { key: 'webExports.headerText', type: 'string', category: 'web', required: 'optional', example: 'CONFIDENCIAL',                                          desc: 'Faixa superior custom (Áreas → Exports → Web)' },
    { key: 'webExports.footerText', type: 'string', category: 'web', required: 'optional', example: 'PRIMETOUR Lazer · …',                                   desc: 'Texto rodapé custom' },
    { key: 'createdBy.name',    type: 'string',  category: 'web', required: 'common',   example: 'Renê Castro',                                              desc: 'Nome do consultor que gerou' },
    { key: 'createdBy.email',   type: 'string',  category: 'web', required: 'optional', example: 'rene@…',                                                   desc: 'Email do consultor' },
    { key: 'createdAt',         type: 'date',    category: 'web', required: 'always',   example: 'Firestore Timestamp',                                      desc: 'Data de criação (servidor)' },
    { key: 'views',             type: 'number',  category: 'web', required: 'computed', example: '47',                                                       desc: 'Views acumuladas (incrementado por portal-view)' },
    { key: 'PRIMETOUR.onDestinoClick', type: 'function', category: 'web', required: 'hooks', example: 'fn(destId) { … }',                                    desc: 'JS hook: chamado quando user clica num destino' },
    { key: 'PRIMETOUR.onSegmentFilter', type: 'function', category: 'web', required: 'hooks', example: 'fn(segmentKey) { … }',                               desc: 'JS hook: filtro de segmento aplicado' },
    { key: 'PRIMETOUR.onMapPinClick', type: 'function', category: 'web', required: 'hooks', example: 'fn(placeId, latlng) { … }',                            desc: 'JS hook: clique em pin do mapa Leaflet' },
  ],
  'banco-roteiros': [
    { key: 'today',                type: 'date',    category: 'root',     required: 'always',   example: '28/05/2026',                    desc: '' },
    { key: 'titulo',               type: 'string',  category: 'root',     required: 'common',   example: 'China Classic Collection',     desc: 'Título do roteiro modelo' },
    { key: 'area.nome',            type: 'string',  category: 'branding', required: 'always',   example: 'PRIMETOUR',                     desc: '' },
    { key: 'area.logoUrl',         type: 'url',     category: 'branding', required: 'optional', example: '…',                             desc: '' },
    { key: 'viagem.noites',        type: 'number',  category: 'viagem',   required: 'common',   example: '14',                            desc: '' },
    { key: 'viagem.destinos',      type: 'string',  category: 'viagem',   required: 'common',   example: 'Pequim · Xangai · Hong Kong',  desc: 'Joined' },
    { key: 'dias',                 type: 'array',   category: 'dias',     required: 'common',   example: '[{numero,cidade,narrativa}]',  desc: 'Loop' },
    { key: 'dias.[i].numero',      type: 'number',  category: 'dias',     required: 'common',   example: '1',                             desc: '' },
    { key: 'dias.[i].cidade',      type: 'string',  category: 'dias',     required: 'common',   example: 'Pequim',                        desc: '' },
    { key: 'dias.[i].narrativa',   type: 'string',  category: 'dias',     required: 'common',   example: '…',                             desc: '' },
    { key: 'hoteis',               type: 'array',   category: 'hoteis',   required: 'optional', example: '[{cidade,nome,regime,noites}]', desc: 'Flatten de categories[].hotels[]' },
    { key: 'inclui',               type: 'array',   category: 'inclui',   required: 'optional', example: '["Hospedagem"]',                desc: '' },
    { key: 'naoInclui',            type: 'array',   category: 'inclui',   required: 'optional', example: '["Gorjetas"]',                  desc: '' },
  ],
};

/** v4.63.20+ Categorias com label/icon pra UI dicionário */
export const PLACEHOLDER_CATEGORIES = {
  root:         { label: 'Raiz',                icon: '📌', order: 1 },
  branding:     { label: 'Branding da área',    icon: '🎨', order: 2 },
  cliente:      { label: 'Cliente',             icon: '👤', order: 3 },
  viagem:       { label: 'Viagem',              icon: '✈️', order: 4 },
  dias:         { label: 'Dia a dia',           icon: '📅', order: 5 },
  voos:         { label: 'Aéreo',               icon: '✈️', order: 6 },
  hoteis:       { label: 'Hospedagem',          icon: '🏨', order: 7 },
  precos:       { label: 'Valores',             icon: '💰', order: 8 },
  inclui:       { label: 'Inclui / Exclui',     icon: '✅', order: 9 },
  opcionais:    { label: 'Opcionais',           icon: '➕', order: 10 },
  pagamento:    { label: 'Pagamento',           icon: '💳', order: 11 },
  cancelamento: { label: 'Cancelamento',        icon: '❌', order: 12 },
  informacoes:  { label: 'Informações',         icon: 'ℹ️', order: 13 },
  destinos:     { label: 'Destinos',            icon: '🌍', order: 14 },
  segmentos:    { label: 'Segmentos',           icon: '🧩', order: 15 },
  web:          { label: 'Web Link (exclusive)', icon: '🌐', order: 16 },
};

/* ─── Helpers internos ──────────────────────────────────────────────── */

function uid() { return store.get('currentUser')?.uid || null; }

function canManageTemplates() {
  if (store.isMaster?.()) return true;
  // Tenta múltiplos paths de permissão (store API + role doc)
  return !!(store.can?.('templates_manage') || store.hasPermission?.('templates_manage'));
}

/* ─── CRUD ──────────────────────────────────────────────────────────── */

/**
 * Lista templates com filtros opcionais. Default: só status='active'.
 *
 * @param {Object} opts
 * @param {string} [opts.module]       'cotacoes' | 'portal' | 'banco-roteiros'
 * @param {string} [opts.format]       'html' | 'docx' | 'pptx'
 * @param {string} [opts.ownerId]      area id pra filtrar (ex: 'lazer')
 * @param {'active'|'archived'|'all'} [opts.status='active']
 */
export async function fetchTemplates(opts = {}) {
  const { module, format, ownerId, status = 'active' } = opts;
  // Firestore não permite múltiplos where com inequalities — fetch ampla + filtra client
  // (volume esperado <500 templates, performance OK)
  const snap = await getDocs(query(collection(db, COLLECTION), limit(500)));
  let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (status !== 'all') docs = docs.filter(d => (d.status || 'active') === status);
  if (module)  docs = docs.filter(d => d.module === module);
  if (format)  docs = docs.filter(d => d.format === format);
  if (ownerId) docs = docs.filter(d => d.ownerId === ownerId || d.ownerType === 'global');
  // Ordem: defaults primeiro, depois mais recentes
  return docs.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0);
  });
}

/**
 * Resolve UM template por id (pra render). Retorna null se não existir.
 */
export async function fetchTemplate(id) {
  if (!id) return null;
  try {
    const snap = await getDoc(doc(db, COLLECTION, id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  } catch (e) {
    console.warn('[templates] fetch falhou:', e?.message);
    return null;
  }
}

/**
 * Resolve o id do template HTML default GLOBAL de cotações.
 *
 * v4.63.83 — fundação pra "Template HTML universal" (decisão Renê 29/05/2026):
 * quando uma área NÃO tem `templateRefs.cotacoes.html` próprio, o gerador de
 * cotações cai pra ESTE template global (em vez do jsPDF legado, que tem bugs
 * de layout: header collision, tabela cortada, capa com scrim fraco).
 *
 * Busca o doc `isDefault=true` + `ownerType='global'` + module cotacoes/roteiros
 * + format html. Cacheado em memória pro resto da sessão (defaults mudam raro).
 *
 * @returns {Promise<string|null>} id do template ou null se nenhum default global.
 */
let _defaultCotacoesTplCache; // undefined = não resolvido; string|null = resolvido
export async function fetchDefaultCotacoesTemplate() {
  if (_defaultCotacoesTplCache !== undefined) return _defaultCotacoesTplCache;
  try {
    const snap = await getDocs(query(collection(db, COLLECTION), limit(500)));
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const candidates = docs.filter(d =>
         (d.status || 'active') === 'active'
      && d.format === 'html'
      && (d.module === 'cotacoes' || d.module === 'roteiros')
      && d.ownerType === 'global'
    );
    // Prioridade: isDefault=true primeiro, depois mais recente
    candidates.sort((a, b) => {
      if (!!a.isDefault !== !!b.isDefault) return a.isDefault ? -1 : 1;
      return (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0);
    });
    _defaultCotacoesTplCache = candidates[0]?.id || null;
  } catch (e) {
    console.warn('[templates] fetchDefaultCotacoesTemplate falhou:', e?.message);
    _defaultCotacoesTplCache = null;
  }
  return _defaultCotacoesTplCache;
}

/**
 * Cria entrada de template após upload do arquivo no Storage.
 * NOTA: o upload físico do arquivo é responsabilidade da CF `uploadTemplate`
 * (v4.63.1). Esta função apenas registra o doc no Firestore.
 *
 * @param {Object} data — { name, module, format, fileUrl, fileStoragePath,
 *                          fileSize, fileSha256, fileMime, ownerType, ownerId,
 *                          placeholders[], ... }
 */
export async function createTemplate(data) {
  if (!canManageTemplates()) throw new Error('Permissão negada (templates_manage).');

  const payload = {
    ...data,
    status: 'active',
    version: 1,
    parentTemplateId: null,
    versionHistory: [{
      version: 1,
      sha: data.fileSha256 || null,
      uploadedAt: new Date(), // serverTimestamp não funciona dentro de array
    }],
    isDefault: data.isDefault === true,
    uploadedAt: serverTimestamp(),
    uploadedBy: uid(),
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
  };

  const ref = await addDoc(collection(db, COLLECTION), payload);

  try {
    await auditLog('templates.create', 'templates', ref.id, {
      name: data.name, module: data.module, format: data.format, ownerId: data.ownerId,
    });
  } catch {}

  return ref.id;
}

/**
 * Atualiza metadata de template (nome, isDefault, etc.). NÃO sobe arquivo
 * novo — versionamento real fica pra v4.64+ (audit pós-sprint zumbi #3:
 * `createNewVersion()` foi prometido mas nunca implementado; pra subir
 * arquivo novo, hoje só fazendo upload novo + arquivar o antigo).
 */
export async function updateTemplate(id, patch) {
  if (!canManageTemplates()) throw new Error('Permissão negada (templates_manage).');
  if (!id) throw new Error('id obrigatório');

  await updateDoc(doc(db, COLLECTION, id), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
  });

  try {
    await auditLog('templates.update', 'templates', id, { patchKeys: Object.keys(patch) });
  } catch {}
}

/**
 * Soft-delete: marca status='archived'. Hard delete (Storage file + doc) só
 * via Admin SDK ou Cloud Function `deleteTemplate` (v4.63.10).
 */
export async function archiveTemplate(id) {
  if (!canManageTemplates()) throw new Error('Permissão negada (templates_manage).');
  await updateDoc(doc(db, COLLECTION, id), {
    status: 'archived',
    archivedAt: serverTimestamp(),
    archivedBy: uid(),
    updatedAt: serverTimestamp(),
  });
  try {
    await auditLog('templates.archive', 'templates', id, {}, { severity: 'warning' });
  } catch {}
}

/**
 * v4.63.27+ Reverte archive — restaura status='active'. Preserva archivedAt/By
 * pra rastro histórico (não nullifica). Fecha gap A13 da auditoria UX.
 */
export async function unarchiveTemplate(id) {
  if (!canManageTemplates()) throw new Error('Permissão negada (templates_manage).');
  await updateDoc(doc(db, COLLECTION, id), {
    status: 'active',
    unarchivedAt: serverTimestamp(),
    unarchivedBy: uid(),
    updatedAt: serverTimestamp(),
  });
  try {
    await auditLog('templates.unarchive', 'templates', id, {}, { severity: 'info' });
  } catch {}
}

/* ─── Helpers de UI ─────────────────────────────────────────────────── */

/**
 * Formata bytes pra display (1234567 → "1.2 MB").
 */
export function formatFileSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * v4.63.1+ Upload de template via Cloud Function uploadTemplate.
 *
 * Decodifica File pra base64 + chama CF que valida + faz upload pro R2 +
 * cria doc Firestore. Retorna { templateId, fileUrl, fileSha256, sizeBytes }.
 *
 * @param {File} file — File object do <input type="file">
 * @param {Object} meta — { name, module, format, ownerType, ownerId, isDefault }
 */
export async function uploadTemplate(file, meta) {
  if (!canManageTemplates()) throw new Error('Permissão negada (templates_manage).');
  const valid = validateTemplateFile(file, meta.format);
  if (!valid.ok) throw new Error(valid.error);

  // Lê arquivo como base64
  const fileBase64 = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      // result = "data:<mime>;base64,<data>" → pega só a parte base64
      const dataUrl = fr.result || '';
      const idx = dataUrl.indexOf(',');
      res(idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl);
    };
    fr.onerror = () => rej(fr.error || new Error('FileReader falhou'));
    fr.readAsDataURL(file);
  });

  // Chama CF
  const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
  const { app } = await import('../firebase.js');
  const fn = httpsCallable(getFunctions(app, 'us-central1'), 'uploadTemplate');

  const payload = {
    name: meta.name,
    module: meta.module,
    format: meta.format,
    ownerType: meta.ownerType || 'area',
    ownerId: meta.ownerId || null,
    isDefault: !!meta.isDefault,
    originalFilename: file.name || '',
    fileBase64,
  };
  const res = await fn(payload);
  return res.data; // { templateId, fileUrl, fileSha256, sizeBytes }
}

/**
 * v4.63.87+ Render template via CF STREAMING renderTemplateFile (onRequest).
 *
 * Substitui a antiga chamada onCall `renderTemplate` que tinha limite de
 * resposta ~10MB — PDF de cotação real (>7MB) estourava o base64 →
 * "Response size too large" → erro `internal` → cliente caía pro jsPDF.
 * O R2 fallback não resolvia (worker rejeita PDF 415 + pub-*.r2.dev sem CORS).
 *
 * Agora: POST pro endpoint onRequest (Cloud Run, ~32MiB) que renderiza +
 * streama o binário direto, com CORS. O domínio cloudfunctions.net já está
 * no connect-src do CSP. Auth via Bearer ID token.
 *
 * @param {string} templateId
 * @param {Object} data — payload pra interpolação (depende do schema do template)
 * @returns {Promise<{filename, sizeBytes, blob, mime, templateName, via}>}
 */
export async function renderTemplate(templateId, data = {}) {
  if (!templateId) throw new Error('templateId obrigatório');

  const { auth } = await import('../firebase.js');
  if (!auth.currentUser) throw new Error('Não autenticado.');
  const idToken = await auth.currentUser.getIdToken();

  const ENDPOINT = 'https://us-central1-gestor-de-tarefas-primetour.cloudfunctions.net/renderTemplateFile';

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ templateId, data }),
    });
  } catch (e) {
    throw new Error(`Falha de rede no render do template: ${e?.message || e}`);
  }

  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch {}
    throw new Error(`Render falhou (${res.status}): ${detail.slice(0, 200)}`);
  }

  const blob = await res.blob();
  const mime = blob.type || 'application/pdf';

  // filename do Content-Disposition (filename*=UTF-8'' tem prioridade)
  let filename = `${templateId}.pdf`;
  const cd = res.headers.get('content-disposition') || '';
  const mStar = cd.match(/filename\*=UTF-8''([^;]+)/i);
  const mPlain = cd.match(/filename="?([^";]+)"?/i);
  if (mStar) { try { filename = decodeURIComponent(mStar[1]); } catch {} }
  else if (mPlain) filename = mPlain[1];

  let templateName = '';
  try { templateName = decodeURIComponent(res.headers.get('x-template-name') || ''); } catch {}

  return { filename, sizeBytes: blob.size, mime, blob, templateName, via: 'stream' };
}

/**
 * v4.63.9+ Duplica template pra outra área (ou pra global).
 *
 * @param {string} sourceTemplateId
 * @param {Object} opts — { targetOwnerType: 'area'|'global', targetOwnerId, newName, isDefault }
 * @returns {Promise<{templateId, fileUrl, name, duplicatedFrom}>}
 */
export async function duplicateTemplate(sourceTemplateId, opts = {}) {
  if (!sourceTemplateId) throw new Error('sourceTemplateId obrigatório');
  if (!canManageTemplates()) throw new Error('Permissão negada (templates_manage).');

  const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
  const { app } = await import('../firebase.js');
  const fn = httpsCallable(getFunctions(app, 'us-central1'), 'duplicateTemplate');
  const res = await fn({
    sourceTemplateId,
    targetOwnerType: opts.targetOwnerType || 'area',
    targetOwnerId: opts.targetOwnerType === 'global' ? null : (opts.targetOwnerId || null),
    newName: opts.newName,
    isDefault: !!opts.isDefault,
  });
  return res.data;
}

/**
 * Trigger download de Blob no browser.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}

/**
 * Valida arquivo antes de upload (mime + size + extensão).
 * Retorna { ok: bool, error: string|null }.
 */
export function validateTemplateFile(file, format) {
  const fmt = FORMAT_MAP[format];
  if (!fmt) return { ok: false, error: `Formato desconhecido: ${format}` };
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!fmt.ext.includes(ext)) {
    return { ok: false, error: `Extensão .${ext} não aceita pra ${fmt.label}. Esperado: ${fmt.ext.map(e => '.' + e).join(', ')}` };
  }
  if (file.size > fmt.maxMB * 1024 * 1024) {
    return { ok: false, error: `Arquivo ${formatFileSize(file.size)} excede limite de ${fmt.maxMB}MB pra ${fmt.label}` };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: `Arquivo excede limite global de ${formatFileSize(MAX_FILE_SIZE_BYTES)}` };
  }
  return { ok: true, error: null };
}
