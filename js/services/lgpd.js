/**
 * PRIMETOUR — LGPD Service
 *
 * Endpoints obrigatórios pela LGPD (Lei 13.709/2018):
 *  - Art. 18, IV: direito de anonimização ou eliminação dos dados
 *  - Art. 18, V: direito de portabilidade
 *  - Art. 18, VI: direito de informação sobre uso
 *
 * IMPORTANTE: estas operações são DESTRUTIVAS e auditadas.
 * Apenas o próprio usuário OU admin com justificativa escrita pode executar.
 *
 * Estratégia:
 *  - DELETE: apaga dados pessoais identificáveis
 *  - ANONIMIZA: substitui PII por hash em logs/auditoria (preserva métricas)
 *  - PRESERVE: dados obrigatórios por outras leis (CLT 5 anos, etc.) ficam
 */
import {
  collection, doc, getDoc, getDocs, query, where, deleteDoc, updateDoc,
  serverTimestamp, addDoc, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';
import { auditLog } from '../auth/audit.js';

/**
 * Apaga TODOS os dados pessoais de um usuário.
 * Anonimiza logs (preserva contadores agregados).
 *
 * @param {string} uid - User ID
 * @param {object} opts
 *   - reason: justificativa textual (obrigatória se não for o próprio user)
 *   - dryRun: se true, retorna preview sem apagar
 * @returns relatório com contagens
 */
export async function eraseUserData(uid, opts = {}) {
  if (!uid) throw new Error('uid obrigatório');
  const cu = store.get('currentUser');
  const isSelf = cu?.uid === uid;
  const isAdmin = store.isMaster() || store.can('system_manage_users');
  if (!isSelf && !isAdmin) {
    throw new Error('Sem permissão. Apenas o próprio usuário ou admin pode apagar.');
  }
  if (!isSelf && (!opts.reason || opts.reason.length < 10)) {
    throw new Error('Justificativa obrigatória (mín 10 chars) quando admin apaga dados de outro user.');
  }

  const report = {
    dryRun: !!opts.dryRun,
    uid,
    deleted: {},
    anonymized: {},
    preserved: {},
    errors: [],
    timestamp: new Date().toISOString(),
  };

  /* ─── Collections que APAGAM por completo ─── */
  const HARD_DELETE = [
    { col: 'notifications',         field: 'recipientId' },
    { col: 'notifications',         field: 'userId' },
    { col: 'desk_reservations',     field: 'userId' },
    { col: 'time_clock_requests',   field: 'userId' },
    { col: 'absences',              field: 'userId' },
    { col: 'vacation_requests',     field: 'userId' },
    { col: 'csat_surveys',          field: 'userId' },     // se aplicável
    { col: 'ai_skills_archive',     field: 'createdBy' },
    { col: 'ai_automations_archive',field: 'createdBy' },
  ];
  for (const { col, field } of HARD_DELETE) {
    try {
      const snap = await getDocs(query(collection(db, col), where(field, '==', uid), limit(500)));
      if (!opts.dryRun) {
        for (const d of snap.docs) await deleteDoc(d.ref);
      }
      report.deleted[col] = (report.deleted[col] || 0) + snap.docs.length;
    } catch (e) {
      report.errors.push(`delete ${col}/${field}: ${e.message}`);
    }
  }

  /* ─── Collections que ANONIMIZAM (preserva agregação) ─── */
  const ANONYM_HASH = 'anonymized-' + Math.random().toString(36).slice(2, 10);
  const ANONYMIZE = [
    { col: 'ai_usage_logs',     field: 'userId' },
    { col: 'audit_logs',        field: 'userId' },
    { col: 'ai_action_logs',    field: 'userId' },
    { col: 'time_clock',        field: 'userId' },         // CLT 5 anos
    { col: 'time_clock_audit',  field: 'userId' },         // CLT 5 anos
  ];
  for (const { col, field } of ANONYMIZE) {
    try {
      const snap = await getDocs(query(collection(db, col), where(field, '==', uid), limit(1000)));
      if (!opts.dryRun) {
        for (const d of snap.docs) {
          const updates = { [field]: ANONYM_HASH };
          // Se tem campos como userName/userEmail, anonimiza também
          const data = d.data();
          if (data.userName) updates.userName = '[anonimizado]';
          if (data.userEmail) updates.userEmail = '[anonimizado]';
          await updateDoc(d.ref, updates);
        }
      }
      report.anonymized[col] = (report.anonymized[col] || 0) + snap.docs.length;
    } catch (e) {
      report.errors.push(`anonymize ${col}/${field}: ${e.message}`);
    }
  }

  /* ─── Doc principal do usuário ─── */
  try {
    if (!opts.dryRun) {
      // Soft delete: marca deletado mas mantém uid pra integridade referencial
      await updateDoc(doc(db, 'users', uid), {
        active: false,
        deletedAt: serverTimestamp(),
        deletedBy: cu?.uid || null,
        deletedReason: opts.reason || 'Auto-exclusão LGPD',
        // Apaga PII
        name: '[Usuário removido]',
        email: `removed-${uid}@deleted.invalid`,
        phone: '',
        avatarColor: null,
        bio: '',
        admissionDate: null,
        // Preserva pra integridade: id, createdAt
      });
    }
    report.deleted['users (soft)'] = 1;
  } catch (e) {
    report.errors.push(`soft delete user: ${e.message}`);
  }

  /* ─── PRESERVADOS (lei exige guarda) ─── */
  report.preserved = {
    'time_clock': 'CLT — guarda 5 anos (anonimizado userId mas preserva horas)',
    'audit_logs': 'SOC2 — guarda 6 meses (anonimizado)',
    'ai_usage_logs': 'Métricas agregadas mantidas (anonimizado)',
  };

  /* ─── Audit log do erase ─── */
  if (!opts.dryRun) {
    await auditLog('lgpd.erase_user_data', 'user', uid, {
      executedBy: cu?.uid,
      isSelf,
      reason: opts.reason || (isSelf ? 'self-deletion' : 'admin-no-reason'),
      report,
    });
  }

  return report;
}

/**
 * Direito de portabilidade (Art. 18, V).
 * Exporta TODOS os dados do user em JSON.
 *
 * @param {string} uid
 * @returns objeto com todos os dados
 */
export async function exportUserData(uid) {
  if (!uid) throw new Error('uid obrigatório');
  const cu = store.get('currentUser');
  const isSelf = cu?.uid === uid;
  const isAdmin = store.isMaster() || store.can('system_manage_users');
  if (!isSelf && !isAdmin) throw new Error('Sem permissão.');

  const result = {
    exportedAt: new Date().toISOString(),
    uid,
    profile: null,
    data: {},
  };

  // Perfil
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) result.profile = snap.data();
  } catch (e) { result.errors = [e.message]; }

  // Collections relacionadas
  const COLLECTIONS = [
    { col: 'notifications',       field: 'recipientId' },
    { col: 'desk_reservations',   field: 'userId' },
    { col: 'time_clock',          field: 'userId' },
    { col: 'absences',            field: 'userId' },
    { col: 'vacation_requests',   field: 'userId' },
    { col: 'ai_usage_logs',       field: 'userId' },
  ];
  for (const { col, field } of COLLECTIONS) {
    try {
      const snap = await getDocs(query(collection(db, col), where(field, '==', uid), limit(2000)));
      result.data[col] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      result.data[col] = { error: e.message };
    }
  }

  await auditLog('lgpd.export_user_data', 'user', uid, { executedBy: cu?.uid, isSelf });
  return result;
}

/**
 * Direito de informação (Art. 18, VI).
 * Lista categorias de dados que coletamos sobre o user.
 */
export function getDataCategories() {
  return [
    { category: 'Identificação',     fields: ['name', 'email', 'phone', 'avatarColor'], purpose: 'Login + UI' },
    { category: 'Profissional',      fields: ['role', 'sector', 'admissionDate'],       purpose: 'Controle acesso + RH' },
    { category: 'Comportamental',    fields: ['ai_usage_logs', 'audit_logs'],           purpose: 'Métricas + auditoria SOC2' },
    { category: 'Operacional',       fields: ['time_clock', 'desk_reservations'],       purpose: 'Gestão diária + CLT' },
    { category: 'Comunicação',       fields: ['notifications'],                          purpose: 'Notificações app' },
  ];
}
