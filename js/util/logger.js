/**
 * PRIMETOUR — Central Logger
 *
 * Logger único pra substituir os 32+ console.log espalhados pelo codebase.
 *
 * MOTIVAÇÃO:
 * - console.log em prod vaza intent interno (debugging info)
 * - Sem central control: impossível desligar logs em prod
 * - Sem captura: erros de prod ficam invisíveis (sem Sentry)
 *
 * COMO USAR:
 *   import { logger } from '../util/logger.js';
 *   logger.debug('[auth]', 'tentativa de login', { email });
 *   logger.info('[csat]', 'survey enviada', surveyId);
 *   logger.warn('[firestore]', 'cache miss', e?.message);
 *   logger.error('[critical]', 'erro inesperado', err);
 *
 * NÍVEIS:
 *   debug — só em dev (localStorage.debug=true)
 *   info  — sempre, mas em prod só vai pra audit_logs (não console)
 *   warn  — sempre console + audit_logs
 *   error — sempre console + audit_logs + (futuro) Sentry
 *
 * CONFIG:
 *   localStorage.setItem('debug', 'true') → ativa logs de debug
 *   localStorage.setItem('debug', '')      → desativa
 */

const _isProd = !['localhost', '127.0.0.1', ''].includes(location.hostname);
const _isDebugEnabled = () => {
  try { return localStorage.getItem('debug') === 'true'; } catch { return false; }
};

function _shouldOutputConsole(level) {
  if (level === 'debug') return _isDebugEnabled();
  if (level === 'info')  return !_isProd; // info só em dev
  return true; // warn/error sempre
}

function _formatPrefix(level, scope) {
  const ts = new Date().toISOString().slice(11, 19);
  return `[${ts}] [${level.toUpperCase()}]${scope ? ' ' + scope : ''}`;
}

/**
 * Envia log crítico pro audit_logs (warn/error)
 * Fire-and-forget — não bloqueia caller.
 */
async function _persistToAudit(level, scope, message, meta) {
  // Apenas warn/error vão pra audit (info+debug ficam só client-side)
  if (level !== 'warn' && level !== 'error') return;
  try {
    const { auditLog } = await import('../auth/audit.js');
    await auditLog(`client.log_${level}`, 'log', null, {
      scope: scope || 'unknown',
      message: String(message).slice(0, 500),
      meta: meta ? JSON.stringify(meta).slice(0, 1000) : null,
      url: location.pathname + location.hash,
    });
  } catch {
    // Falha de audit não pode quebrar o fluxo
  }
}

export const logger = {
  debug(scope, message, ...args) {
    if (_shouldOutputConsole('debug')) {
      console.debug(_formatPrefix('debug', scope), message, ...args);
    }
  },

  info(scope, message, ...args) {
    if (_shouldOutputConsole('info')) {
      console.log(_formatPrefix('info', scope), message, ...args);
    }
  },

  warn(scope, message, ...args) {
    if (_shouldOutputConsole('warn')) {
      console.warn(_formatPrefix('warn', scope), message, ...args);
    }
    _persistToAudit('warn', scope, message, args[0]);
  },

  error(scope, message, ...args) {
    if (_shouldOutputConsole('error')) {
      console.error(_formatPrefix('error', scope), message, ...args);
    }
    _persistToAudit('error', scope, message, args[0]);
  },
};

export default logger;
