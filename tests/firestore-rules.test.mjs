/**
 * PRIMETOUR — Firestore Rules Regression Tests
 *
 * Roda contra Firestore Emulator. Garante que mudancas em
 * firestore.rules nao quebrem isolamento de dados sensiveis.
 *
 * Como rodar:
 *   1. npm i @firebase/rules-unit-testing
 *   2. firebase emulators:start --only firestore
 *   3. node --test tests/firestore-rules.test.mjs
 *
 * Categoria: cada teste cobre um vetor de attack:
 *   - Anonymous read of sensitive collections (system_secrets, ai_api_keys)
 *   - Cross-user write (user A modifica dado de user B)
 *   - Privilege escalation (member tenta virar admin)
 *   - Read of audit_logs by non-admin
 *   - Bypass de visibility scope em ai_knowledge
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { setDoc, getDoc, doc, setLogLevel } from 'firebase/firestore';

setLogLevel('error');

const PROJECT_ID = 'primetour-rules-test';
const RULES = readFileSync('./firestore.rules', 'utf8');

let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
  });
});

test.after(async () => {
  await testEnv?.cleanup();
});

// Helpers
function asUser(uid, claims = {}) {
  return testEnv.authenticatedContext(uid, claims).firestore();
}
function asAnon() { return testEnv.unauthenticatedContext().firestore(); }
async function seedUser(uid, role = 'member') {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/${uid}`), {
      email: `${uid}@primetour.com.br`,
      role,
      isMaster: role === 'master',
      createdAt: new Date(),
    });
  });
}

/* ─── Sensitive collections ────────────────────────────────── */

test('anon CANNOT read system_secrets', async () => {
  await assertFails(getDoc(doc(asAnon(), 'system_secrets/any')));
});

test('member CANNOT read system_secrets', async () => {
  await seedUser('member1', 'member');
  await assertFails(getDoc(doc(asUser('member1'), 'system_secrets/any')));
});

test('admin CANNOT read system_secrets (zero-trust)', async () => {
  await seedUser('admin1', 'admin');
  await assertFails(getDoc(doc(asUser('admin1'), 'system_secrets/any')));
});

test('master CANNOT read system_secrets (zero-trust)', async () => {
  await seedUser('master1', 'master');
  await assertFails(getDoc(doc(asUser('master1'), 'system_secrets/any')));
});

test('member CANNOT read ai_api_keys', async () => {
  await seedUser('member2', 'member');
  await assertFails(getDoc(doc(asUser('member2'), 'ai_api_keys/anthropic')));
});

test('admin CAN read ai_api_keys', async () => {
  await seedUser('admin2', 'admin');
  await assertSucceeds(getDoc(doc(asUser('admin2'), 'ai_api_keys/anthropic')));
});

test('member CANNOT read system_config', async () => {
  await seedUser('member3', 'member');
  await assertFails(getDoc(doc(asUser('member3'), 'system_config/global')));
});

/* ─── Rate limit collections (server-only) ──────────────────── */

test('user CANNOT read rate_limits (could clear counter)', async () => {
  await seedUser('user1', 'member');
  await assertFails(getDoc(doc(asUser('user1'), 'rate_limits/user1__callLLM')));
});

test('user CANNOT write rate_limits_ip', async () => {
  await seedUser('user2', 'member');
  await assertFails(setDoc(doc(asUser('user2'), 'rate_limits_ip/123_45_67_89__callLLM'), {
    calls: [],
  }));
});

/* ─── Privilege escalation ──────────────────────────────────── */

test('member CANNOT escalate own role to admin', async () => {
  await seedUser('escalator', 'member');
  await assertFails(setDoc(doc(asUser('escalator'), 'users/escalator'), {
    role: 'admin',  // tentativa de escalar
  }, { merge: true }));
});

test('admin CAN change other user role', async () => {
  await seedUser('admin3', 'admin');
  await seedUser('victim', 'member');
  await assertSucceeds(setDoc(doc(asUser('admin3'), 'users/victim'), {
    role: 'coordinator',
  }, { merge: true }));
});

/* ─── Cross-user data isolation ─────────────────────────────── */

test('user A CANNOT modify chat history of user B', async () => {
  await seedUser('userA', 'member');
  await seedUser('userB', 'member');
  // Seed a chat for userB
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'ai_chat_history/userB_msg1'), {
      userId: 'userB', message: 'private',
    });
  });
  await assertFails(setDoc(doc(asUser('userA'), 'ai_chat_history/userB_msg1'), {
    userId: 'userB', message: 'hacked',
  }, { merge: true }));
});

/* ─── Audit logs immutability ───────────────────────────────── */

test('member CANNOT write to audit_logs (only Cloud Functions can)', async () => {
  await seedUser('member4', 'member');
  await assertFails(setDoc(doc(asUser('member4'), 'audit_logs/fake'), {
    action: 'fake.event', userId: 'member4', timestamp: new Date(),
  }));
});

test('admin CANNOT update audit_logs (immutable)', async () => {
  await seedUser('admin4', 'admin');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'audit_logs/real'), {
      action: 'auth.login', userId: 'admin4', timestamp: new Date(),
    });
  });
  await assertFails(setDoc(doc(asUser('admin4'), 'audit_logs/real'), {
    action: 'auth.login.modified',
  }, { merge: true }));
});
