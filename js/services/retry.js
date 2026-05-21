/**
 * PRIMETOUR — Write Retry Helper (v4.49.61+)
 *
 * Wraps writes críticos (updateDoc/addDoc/setDoc) com retry exponential
 * backoff em caso de erro de rede transitório.
 *
 * NÃO faz retry em:
 *   - permission-denied (rules) — não vai melhorar com retry
 *   - failed-precondition (índice ausente) — idem
 *   - invalid-argument (validação) — idem
 *
 * Retry em:
 *   - unavailable, aborted, deadline-exceeded, internal — transientes
 *   - fetch/network errors (offline temporário)
 *
 * Sinaliza connection.markNetworkError em falhas detectadas pra que o
 * indicador UI mostre status reconectando ao user.
 *
 * Uso:
 *   import { withRetry } from '../services/retry.js';
 *   await withRetry(
 *     () => updateDoc(ref, { status: 'done' }),
 *     { label: 'task.update', maxAttempts: 3 }
 *   );
 */

import { markNetworkError, markNetworkOk, isFirestoreError } from './connection.js';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 800;
const NON_RETRIABLE = new Set([
  'permission-denied',
  'failed-precondition',
  'invalid-argument',
  'not-found',
  'already-exists',
  'unauthenticated',
  'data-loss',
  'out-of-range',
]);

function _isRetriable(err) {
  if (!err) return false;
  const code = String(err.code || '').toLowerCase();
  if (NON_RETRIABLE.has(code)) return false;
  return isFirestoreError(err);
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Executa `fn` com retry em erros transientes.
 *
 * @param {() => Promise<T>} fn - Função que faz o write. Deve lançar em erro.
 * @param {object} [opts]
 * @param {string} [opts.label] - Identificador pra logs/telemetria (ex: 'task.update.requesterEdit').
 * @param {number} [opts.maxAttempts] - default 3 (1 original + 2 retries).
 * @param {number} [opts.baseDelayMs] - default 800. Backoff: base × 2^(attempt-1).
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts = {}) {
  const label = opts.label || 'unknown';
  const maxAttempts = Math.max(1, opts.maxAttempts || DEFAULT_MAX_ATTEMPTS);
  const baseDelay = opts.baseDelayMs || DEFAULT_BASE_DELAY_MS;

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      // Sucesso — se estava em reconnecting, sobe pra online.
      markNetworkOk();
      return result;
    } catch (err) {
      lastErr = err;
      const retriable = _isRetriable(err);
      console.warn(`[retry:${label}] attempt ${attempt}/${maxAttempts} failed:`,
        err?.code || err?.message || err);

      // Sinaliza erro de rede pro indicador (só se for transiente)
      if (isFirestoreError(err)) {
        markNetworkError(label, err);
      }

      if (!retriable || attempt >= maxAttempts) {
        throw err;
      }
      // Backoff exponential com jitter (±20%)
      const baseMs = baseDelay * Math.pow(2, attempt - 1);
      const jitter = baseMs * (0.8 + Math.random() * 0.4);
      await _sleep(Math.round(jitter));
    }
  }
  throw lastErr;
}

/**
 * Wrapper de conveniência pra writes que precisam de toast pro user.
 * Retorna { ok: true, value } OU { ok: false, error }, NUNCA lança.
 *
 * Uso típico em handlers de UI:
 *   const result = await withRetryToast(
 *     () => updateDoc(ref, { ... }),
 *     { label: '...', successMsg: 'Salvo!', errorMsg: 'Falha ao salvar' }
 *   );
 *   if (!result.ok) return;  // toast já mostrado
 */
export async function withRetryToast(fn, opts = {}) {
  const { successMsg, errorMsg, label, maxAttempts, baseDelayMs } = opts;
  try {
    const value = await withRetry(fn, { label, maxAttempts, baseDelayMs });
    if (successMsg) {
      const { toast } = await import('../components/toast.js');
      toast.success(successMsg);
    }
    return { ok: true, value };
  } catch (error) {
    const { toast } = await import('../components/toast.js');
    const code = String(error?.code || '');
    const friendly = code === 'permission-denied'
      ? 'Sem permissão pra esta ação.'
      : isFirestoreError(error)
      ? 'Falha de conexão após várias tentativas. Verifique sua internet e tente novamente.'
      : (errorMsg || ('Erro: ' + (error?.message || error)));
    toast.error(friendly, { duration: 7000 });
    return { ok: false, error };
  }
}
