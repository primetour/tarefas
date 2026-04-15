#!/usr/bin/env node
/**
 * Fix-acentos — corrige palavras portuguesas sem acento.
 *
 * Estratégia: state-machine char-by-char no JS. Só transforma
 * conteúdo que está dentro de strings '...' ou "..." em nível top —
 * NUNCA dentro de template literals (backticks), comentários, regex
 * ou código. Em HTML, transforma texto visível e atributos seguros
 * (title/alt/placeholder/aria-label/etc), ignorando script/style.
 *
 * Uso:
 *   node scripts/fix-acentos.js          # dry-run
 *   node scripts/fix-acentos.js --apply  # grava
 */

const fs   = require('fs');
const path = require('path');

const ROOT  = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');

// Exclui chaves Firestore do projeto (titulo, descricao, area, periodo,
// usuario, etc) pra não quebrar item.titulo / payload.area.
const PAIRS = [
  ['tambem','também'],
  ['voces','vocês'],['voce','você'],
  ['porem','porém'],
  ['alem','além'],
  ['atraves','através'],
  ['apos','após'],
  ['atras','atrás'],
  ['nao','não'],
  ['serao','serão'],

  ['responsaveis','responsáveis'],['responsavel','responsável'],
  ['disponiveis','disponíveis'],['disponivel','disponível'],
  ['obrigatorias','obrigatórias'],['obrigatorios','obrigatórios'],
  ['obrigatoria','obrigatória'],['obrigatorio','obrigatório'],
  ['necessarias','necessárias'],['necessarios','necessários'],
  ['necessaria','necessária'],['necessario','necessário'],
  ['ultimos','últimos'],['ultimas','últimas'],
  ['ultima','última'],['ultimo','último'],
  ['proximos','próximos'],['proximas','próximas'],
  ['proxima','próxima'],['proximo','próximo'],
  ['unicos','únicos'],['unicas','únicas'],
  ['unica','única'],['unico','único'],
  ['paginas','páginas'],['pagina','página'],
  ['rapidas','rápidas'],['rapidos','rápidos'],
  ['rapida','rápida'],['rapido','rápido'],
  ['maxima','máxima'],['maximo','máximo'],
  ['minima','mínima'],['minimo','mínimo'],
  ['uteis','úteis'],['util','útil'],
  ['dificil','difícil'],['facil','fácil'],
  ['proprios','próprios'],['proprias','próprias'],
  ['proprio','próprio'],['propria','própria'],
  ['basicos','básicos'],['basicas','básicas'],
  ['basica','básica'],['basico','básico'],
  ['ingles','inglês'],['portugues','português'],

  // -ção / -são
  ['atencao','atenção'],
  ['producao','produção'],
  ['execucao','execução'],
  ['exclusao','exclusão'],
  ['inclusao','inclusão'],
  ['conclusao','conclusão'],
  ['conversao','conversão'],
  ['extensao','extensão'],
  ['revisoes','revisões'],['revisao','revisão'],
  ['decisoes','decisões'],['decisao','decisão'],
  ['versoes','versões'],['versao','versão'],
  ['integracoes','integrações'],['integracao','integração'],
  ['permissoes','permissões'],['permissao','permissão'],
  ['atribuicoes','atribuições'],['atribuicao','atribuição'],
  ['autorizacoes','autorizações'],['autorizacao','autorização'],
  ['confirmacoes','confirmações'],['confirmacao','confirmação'],
  ['declaracoes','declarações'],['declaracao','declaração'],
  ['avaliacoes','avaliações'],['avaliacao','avaliação'],
  ['aprovacoes','aprovações'],['aprovacao','aprovação'],
  ['situacoes','situações'],['situacao','situação'],
  ['classificacoes','classificações'],['classificacao','classificação'],
  ['relacoes','relações'],['relacao','relação'],

  // -ência / -ância
  ['experiencias','experiências'],['experiencia','experiência'],
  ['referencias','referências'],['referencia','referência'],
  ['preferencias','preferências'],['preferencia','preferência'],
  ['tendencias','tendências'],['tendencia','tendência'],
  ['ocorrencias','ocorrências'],['ocorrencia','ocorrência'],
  ['conferencias','conferências'],['conferencia','conferência'],
  ['ciencias','ciências'],['ciencia','ciência'],
  ['urgencias','urgências'],['urgencia','urgência'],
  ['importancia','importância'],
  ['distancia','distância'],
  ['instancia','instância'],
  ['diferenca','diferença'],

  // adjetivos/substantivos
  ['automaticas','automáticas'],['automaticos','automáticos'],
  ['automatica','automática'],['automatico','automático'],
  ['graficos','gráficos'],['grafico','gráfico'],
  ['metricas','métricas'],['metrica','métrica'],
  ['relatorios','relatórios'],
  ['historicos','históricos'],
  ['estrategicos','estratégicos'],['estrategicas','estratégicas'],
  ['estrategico','estratégico'],
  ['estrategias','estratégias'],['estrategia','estratégia'],
  ['topicos','tópicos'],['topico','tópico'],
  ['criterios','critérios'],['criterio','critério'],
  ['territorios','territórios'],['territorio','território'],
  ['orcamentos','orçamentos'],['orcamento','orçamento'],
];

function applyCase(original, replacement) {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

// Lookbehind/lookahead rejeita hífen, underscore, dígito, letra.
const RULES = PAIRS.map(([f, t]) => [new RegExp(`(?<![-_\\w])${f}(?![-_\\w])`, 'gi'), t]);

function applyInText(text) {
  let out = text;
  for (const [re, rep] of RULES) {
    out = out.replace(re, (m) => applyCase(m, rep));
  }
  return out;
}

function looksLikeIdentifier(s) {
  if (s.length === 0) return true;
  if (/\s/.test(s)) return false;
  if (s.length > 30) return false;
  if (/^[\w\-.#:/]+$/.test(s)) return true;
  return false;
}

function transformStringLiteral(inner) {
  if (looksLikeIdentifier(inner)) return inner;
  return applyInText(inner);
}

/* ─── JS processor (state machine) ─────────────────────────
 * Estados:
 *   CODE — fora de string/comentário/template
 *   LINE_COMMENT — até \n
 *   BLOCK_COMMENT — até *∕
 *   SQUOTE / DQUOTE — strings simples/duplas (processadas)
 *   TEMPLATE — backtick (NUNCA processado; pode conter ${…} com
 *              sub-expressões que têm suas próprias strings — essas
 *              sub-strings tamém NÃO são processadas, por conservadorismo)
 * Só strings SQUOTE/DQUOTE em CONTEXT CODE (profundidade template=0)
 * são transformadas.
 */
function processJs(src) {
  let out = '';
  let i = 0;
  const N = src.length;

  // Pilha de contextos template: cada entrada representa profundidade
  // dentro de um template. Enquanto houver entradas, strings dentro de
  // ${…} também são deixadas intactas (via flag inTemplate).
  const tmplStack = []; // cada item: { braceDepth: number }

  const inTemplate = () => tmplStack.length > 0;

  // Heurística simples para detectar contexto de regex literal:
  // considera `/` como regex se o último token não-branco for operador,
  // keyword de início-expressão, ou '('.
  function prevSignificantChar() {
    for (let k = out.length - 1; k >= 0; k--) {
      const c = out[k];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') continue;
      return c;
    }
    return '';
  }
  function isRegexContext() {
    const c = prevSignificantChar();
    if (!c) return true;
    // Chars que tipicamente precedem regex
    if ('([{,;=!&|?:+-*/%^~<>'.includes(c)) return true;
    // keywords (rudimentar): olha últimos ≤8 chars word
    const tail = out.slice(-10);
    return /\b(return|typeof|in|of|instanceof|new|delete|void|throw|case|do|else)\s*$/.test(tail);
  }

  while (i < N) {
    const c = src[i];
    const c2 = src[i+1];

    // Dentro de template literal (topo da pilha)
    if (inTemplate()) {
      const frame = tmplStack[tmplStack.length - 1];
      if (frame.braceDepth === 0) {
        // Dentro do próprio template (não em ${…})
        if (c === '\\') { out += src.slice(i, i+2); i += 2; continue; }
        if (c === '`') { out += c; tmplStack.pop(); i++; continue; }
        if (c === '$' && c2 === '{') {
          out += '${'; frame.braceDepth = 1; i += 2; continue;
        }
        out += c; i++; continue;
      } else {
        // Dentro de ${…} — é código, mas permanece marcado como template
        // Tratamos como CODE, só ajustando braceDepth. Strings aqui NÃO
        // são processadas (conservador).
        if (c === '\\') { out += src.slice(i, i+2); i += 2; continue; }
        if (c === '{') { out += c; frame.braceDepth++; i++; continue; }
        if (c === '}') {
          frame.braceDepth--;
          out += c; i++; continue;
        }
        // Strings dentro de ${…}: copia sem processar
        if (c === "'" || c === '"') {
          const q = c;
          let j = i + 1;
          while (j < N) {
            if (src[j] === '\\') { j += 2; continue; }
            if (src[j] === q) { j++; break; }
            if (src[j] === '\n') break;
            j++;
          }
          out += src.slice(i, j);
          i = j;
          continue;
        }
        // Backtick aninhado: entra novo frame
        if (c === '`') { out += '`'; tmplStack.push({ braceDepth: 0 }); i++; continue; }
        // Comentários dentro de ${…}
        if (c === '/' && c2 === '/') {
          const nl = src.indexOf('\n', i);
          const end = nl === -1 ? N : nl;
          out += src.slice(i, end);
          i = end;
          continue;
        }
        if (c === '/' && c2 === '*') {
          const close = src.indexOf('*/', i + 2);
          const end = close === -1 ? N : close + 2;
          out += src.slice(i, end);
          i = end;
          continue;
        }
        out += c; i++; continue;
      }
    }

    // CODE (fora de template)
    // Line comment
    if (c === '/' && c2 === '/') {
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? N : nl;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    // Block comment
    if (c === '/' && c2 === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? N : close + 2;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    // Template literal start
    if (c === '`') {
      out += c;
      tmplStack.push({ braceDepth: 0 });
      i++;
      continue;
    }
    // Single/double quoted strings — PROCESS
    if (c === "'" || c === '"') {
      const q = c;
      let j = i + 1;
      while (j < N) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === q) { break; }
        if (src[j] === '\n') break;
        j++;
      }
      const hasClose = src[j] === q;
      const inner = src.slice(i + 1, j);
      const transformed = transformStringLiteral(inner);
      out += q + transformed + (hasClose ? q : '');
      i = j + (hasClose ? 1 : 0);
      continue;
    }
    // Regex literal — detecta e pula sem processar
    if (c === '/' && isRegexContext()) {
      let j = i + 1;
      let inClass = false;
      while (j < N) {
        const cc = src[j];
        if (cc === '\\') { j += 2; continue; }
        if (cc === '[') { inClass = true; j++; continue; }
        if (cc === ']') { inClass = false; j++; continue; }
        if (cc === '/' && !inClass) { j++; break; }
        if (cc === '\n') break;
        j++;
      }
      // pula flags
      while (j < N && /[a-z]/i.test(src[j])) j++;
      out += src.slice(i, j);
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/* ─── HTML: ignora <script>/<style>, processa texto e atributos ── */
function processHtml(src) {
  const SAFE_ATTRS = new Set(['title', 'alt', 'placeholder', 'aria-label', 'aria-describedby', 'label']);
  let out = '';
  let i = 0;
  const N = src.length;

  while (i < N) {
    // <script>…</script>
    const mScript = /^<script\b[^>]*>/i.exec(src.slice(i));
    if (mScript) {
      const start = i + mScript[0].length;
      const close = src.toLowerCase().indexOf('</script>', start);
      const end = close === -1 ? N : close + '</script>'.length;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    // <style>…</style>
    const mStyle = /^<style\b[^>]*>/i.exec(src.slice(i));
    if (mStyle) {
      const start = i + mStyle[0].length;
      const close = src.toLowerCase().indexOf('</style>', start);
      const end = close === -1 ? N : close + '</style>'.length;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    // <!-- comment -->
    if (src.startsWith('<!--', i)) {
      const close = src.indexOf('-->', i + 4);
      const end = close === -1 ? N : close + 3;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    // Tag
    if (src[i] === '<') {
      const close = src.indexOf('>', i);
      const end = close === -1 ? N : close + 1;
      const tag = src.slice(i, end);
      // Processa atributos seguros dentro da tag
      const newTag = tag.replace(
        /([\w-]+)\s*=\s*(["'])((?:\\.|(?!\2).)*)\2/g,
        (full, name, q, content) => {
          if (SAFE_ATTRS.has(name.toLowerCase())) {
            return `${name}=${q}${transformStringLiteral(content)}${q}`;
          }
          return full;
        }
      );
      out += newTag;
      i = end;
      continue;
    }
    // Texto até próxima tag
    const next = src.indexOf('<', i);
    const end = next === -1 ? N : next;
    out += applyInText(src.slice(i, end));
    i = end;
  }
  return out;
}

/* ─── Walk & Main ────────────────────────────────────────── */
const SKIP_DIRS = new Set(['node_modules', '.git', '.github', 'scripts', 'docs', 'docs_antigos']);
const EXTS = new Set(['.js', '.html']);

function walk(dir, out=[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else {
      const ext = path.extname(entry.name).toLowerCase();
      if (EXTS.has(ext)) out.push(full);
    }
  }
  return out;
}

function processFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = file.endsWith('.html') ? processHtml(src) : processJs(src);
  return { src, out, changed: src !== out };
}

const files = walk(ROOT);
let totalLines = 0;
const changed = [];

for (const f of files) {
  try {
    const { src, out, changed: didChange } = processFile(f);
    if (didChange) {
      const a = src.split('\n'), b = out.split('\n');
      let lines = 0;
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] || '') !== (b[i] || '')) lines++;
      }
      changed.push({ file: path.relative(ROOT, f), lines });
      totalLines += lines;
      if (APPLY) fs.writeFileSync(f, out, 'utf8');
    }
  } catch (e) {
    console.error('Erro em', f, e.message);
  }
}

console.log('');
console.log('─'.repeat(60));
if (APPLY) {
  console.log(`✓ Aplicado em ${changed.length} arquivos (${totalLines} linhas)`);
} else {
  console.log(`Dry-run: ${changed.length} arquivos, ${totalLines} linhas afetadas.`);
  console.log(`Use --apply pra gravar.`);
}
console.log('─'.repeat(60));
for (const c of changed.slice(0, 60)) {
  console.log(`  ${c.file.padEnd(55)} ${c.lines} linhas`);
}
if (changed.length > 60) console.log(`  … e mais ${changed.length - 60}`);
