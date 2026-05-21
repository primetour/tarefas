/**
 * Form app compartilhado entre /nova-oferta/ e /ofertas/editar/.
 *
 * Modos:
 *   - 'create' (default): rascunho em localStorage, saveOferta() no final,
 *     reseta + volta pra splash após publicar.
 *   - 'edit': carrega oferta por ID, updateOferta() no final, redireciona
 *     pra /btg/dashboard/ofertas/ após salvar.
 *
 * Uso:
 *   import { mount } from '/btg/dashboard/_shared/form-app.js';
 *   mount({ mode: 'create' });
 *   // ou
 *   mount({ mode: 'edit', ofertaId: 'abc123' });
 */

import { createFormStore, defaultFormValues } from '/btg/shared/form/form-store.js';
import { renderTipoSelector } from '/btg/shared/form/tipo-selector.js';
import { renderStepShell, renderStepFields, setStepMessage } from '/btg/shared/form/step-shell.js';
import { renderLivePreview } from '/btg/shared/form/live-preview.js';
import { bindFormEvents } from '/btg/shared/form/form-inputs.js';
import { getStepsForType, getQuestionsForStep } from '/btg/shared/form/form-steps.js';
import { saveOferta, updateOferta, getOfertaById, getOfertasSource } from '/btg/shared/btg-ofertas-service.js';

export function mount(opts = {}) {
  const mode = opts.mode || 'create';
  const ofertaId = opts.ofertaId || null;
  const root = opts.root || document.getElementById('root');

  const DRAFT_KEY = mode === 'edit'
    ? `btg-edit-draft-${ofertaId}`
    : 'btg-lab-nova-oferta-draft-v1';
  const TIPO_KEY  = mode === 'edit'
    ? null  // edit não permite trocar tipo
    : 'btg-lab-nova-oferta-tipo-v1';

  const store = createFormStore(defaultFormValues());
  const state = {
    tipo: null,
    currentStepIdx: 0,
    completedSteps: new Set(),
    previewMode: 'card',
    activeTargets: [],
    imageUrl: null,
    steps: [],
    loadedId: null,    // só usado em edit
    loadedSlug: null,  // pra mostrar URL pública
  };

  // ─── BOOTSTRAP ──────────────────────────────────────────

  async function bootstrap() {
    if (mode === 'edit') {
      // Carrega oferta do Firestore
      if (!ofertaId) {
        renderError('ID da oferta não informado na URL (?id=...).');
        return;
      }
      try {
        const oferta = await getOfertaById(ofertaId);
        if (!oferta) {
          renderError(`Oferta ${ofertaId} não encontrada.`);
          return;
        }
        state.loadedId = oferta.id;
        state.loadedSlug = oferta.slug;
        state.tipo = oferta.tipo_oferta;
        state.steps = getStepsForType(state.tipo);
        // Preenche store com valores existentes (sobrescreve defaults)
        store.reset({ ...defaultFormValues(), ...oferta });
        // Migra legado: oferta antiga só tem `incluso_no_pacote` (texto livre).
        // Auto-popula 1 bloco em `inclusoes` pra que o editor de blocos
        // mostre o conteúdo existente em vez de form vazio.
        const v = store.values();
        if (
          (!Array.isArray(v.inclusoes) || v.inclusoes.length === 0) &&
          (v.incluso_no_pacote || '').trim()
        ) {
          store.set('inclusoes', [
            { subtitulo: '', topicos: v.incluso_no_pacote, valor: '' },
          ]);
        }
        // Em edit, draft é por-id (evita conflitar com create)
        try {
          const cachedDraft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
          if (cachedDraft) {
            if (confirm('Há um rascunho de edição não salvo dessa oferta. Carregar?')) {
              store.reset(cachedDraft);
            } else {
              localStorage.removeItem(DRAFT_KEY);
            }
          }
        } catch {}
        renderShell();
      } catch (err) {
        renderError(`Erro ao carregar oferta: ${err.message}`);
      }
    } else {
      // mode = create — comportamento original
      try {
        const stored = localStorage.getItem(TIPO_KEY);
        if (stored) state.tipo = stored;
        const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
        if (draft) store.reset(draft);
      } catch {}
      if (state.tipo) {
        state.steps = getStepsForType(state.tipo);
        renderShell();
      } else {
        renderSplash();
      }
    }
  }

  // Auto-save de rascunho
  store.subscribe(() => {
    try {
      const v = store.values();
      const draft = { ...v };
      delete draft.imagem_file;
      delete draft.galeria_files;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {}
    const previewEl = document.getElementById('step-preview');
    if (previewEl) {
      renderLivePreview(previewEl, {
        tipo: state.tipo, values: store.values(), mode: state.previewMode,
        activeTargets: state.activeTargets, imageUrl: state.imageUrl,
      });
    }
  });

  // Image URL pro preview
  store.subscribe((field) => {
    if (field !== 'imagem_file' && field !== 'imagem_url') return;
    const url = store.get('imagem_url') || '';
    const f = store.get('imagem_file');
    if (state.imageUrl && state.imageUrl.startsWith('blob:')) {
      URL.revokeObjectURL(state.imageUrl);
    }
    if (url) state.imageUrl = url;
    else if (f instanceof File) state.imageUrl = URL.createObjectURL(f);
    else state.imageUrl = null;
  });

  // ─── HANDLERS ───────────────────────────────────────────

  function chooseTipo(tipo) {
    state.tipo = tipo;
    state.currentStepIdx = 0;
    state.completedSteps = new Set();
    state.steps = getStepsForType(tipo);
    store.set('tipo_oferta', tipo);
    if (TIPO_KEY) {
      try { localStorage.setItem(TIPO_KEY, tipo); } catch {}
    }
    renderShell();
  }

  function resetTipo() {
    if (mode === 'edit') {
      if (confirm('Voltar pra lista? Mudanças não salvas serão perdidas.')) {
        location.href = '/btg/dashboard/ofertas/';
      }
      return;
    }
    if (!confirm('Trocar de tipo? Os dados preenchidos serão mantidos.')) return;
    state.tipo = null;
    state.currentStepIdx = 0;
    if (TIPO_KEY) {
      try { localStorage.removeItem(TIPO_KEY); } catch {}
    }
    renderSplash();
  }

  function gotoStep(idx) {
    if (idx < 0 || idx >= state.steps.length) return;
    state.currentStepIdx = idx;
    renderCurrentStep();
  }

  function nextStep() {
    const step = state.steps[state.currentStepIdx];
    const qs = getQuestionsForStep(state.tipo, step.id);
    const values = store.values();
    const visible = qs.filter((q) => !q.visibleWhen || q.visibleWhen(values));
    const required = visible.filter((q) => !q.optional);
    const missing = required.filter((q) =>
      q.fields.some((f) => {
        const v = values[f];
        if (Array.isArray(v)) return v.length === 0;
        if (typeof v === 'boolean') return false;
        return !v || String(v).trim() === '';
      })
    );
    if (missing.length > 0) {
      setStepMessage(root, `Preencha os campos obrigatórios: ${missing.map((m) => m.title).join(', ')}`, 'error');
      return;
    }
    setStepMessage(root, '', '');
    state.completedSteps.add(state.currentStepIdx);
    if (state.currentStepIdx < state.steps.length - 1) {
      state.currentStepIdx++;
      renderCurrentStep();
    } else {
      publicar();
    }
  }

  function prevStep() {
    if (state.currentStepIdx > 0) {
      state.currentStepIdx--;
      renderCurrentStep();
    }
  }

  function saveAndClose() {
    setStepMessage(root, 'Rascunho salvo. Você pode voltar quando quiser.', 'success');
    setTimeout(() => setStepMessage(root, '', ''), 4000);
  }

  function importFile() {
    location.href = '/btg/dashboard/import/';
  }

  async function publicar() {
    const values = store.values();
    const verb = mode === 'edit' ? 'Salvando' : 'Publicando';
    setStepMessage(root, `${verb}…`, 'success');
    try {
      let result;
      if (mode === 'edit') {
        result = await updateOferta(state.loadedId, values);
      } else {
        result = await saveOferta(values);
      }
      const verbDone = mode === 'edit' ? 'salva' : 'publicada';
      setStepMessage(
        root,
        `Oferta ${verbDone} com sucesso! ${result.slug ? `(slug: ${result.slug})` : ''}`,
        'success',
      );
      localStorage.removeItem(DRAFT_KEY);
      if (mode === 'create' && TIPO_KEY) localStorage.removeItem(TIPO_KEY);
      setTimeout(() => {
        if (mode === 'edit') {
          location.href = '/btg/dashboard/ofertas/';
        } else {
          state.tipo = null;
          state.currentStepIdx = 0;
          state.completedSteps = new Set();
          store.reset(defaultFormValues());
          renderSplash();
        }
      }, 2000);
    } catch (err) {
      console.error('[btg-form] erro ao publicar:', err);
      setStepMessage(root, `Erro: ${err.message}`, 'error');
    }
  }

  // ─── RENDER ─────────────────────────────────────────────

  function renderError(msg) {
    root.innerHTML = `
      <div style="max-width:600px;margin:80px auto;padding:24px;text-align:center;font-family:-apple-system,system-ui,sans-serif;">
        <h2 style="color:#b91c1c;font-size:18px;margin:0 0 12px">Erro</h2>
        <p style="color:#4b5563;font-size:14px">${msg}</p>
        <a href="/btg/dashboard/ofertas/" style="display:inline-block;margin-top:16px;color:#05132a;text-decoration:underline;font-size:13px">← Voltar pra lista de ofertas</a>
      </div>
    `;
  }

  function renderSplash() {
    renderTipoSelector(root, chooseTipo, importFile);
  }

  function renderShell() {
    renderStepShell(root, state, {
      onChangeType: resetTipo,
      onSaveAndClose: saveAndClose,
      onImport: importFile,
      onPrev: prevStep,
      onNext: nextStep,
      onGotoStep: gotoStep,
    });
    renderCurrentStep();
  }

  function renderCurrentStep() {
    const step = state.steps[state.currentStepIdx];
    const qs = getQuestionsForStep(state.tipo, step.id);
    const values = store.values();
    const targets = new Set();
    qs.forEach((q) => {
      if (q.visibleWhen && !q.visibleWhen(values)) return;
      (q.previewTargets || []).forEach((t) => targets.add(t));
    });
    state.activeTargets = Array.from(targets);
    renderStepShell(root, state, {
      onChangeType: resetTipo,
      onSaveAndClose: saveAndClose,
      onImport: importFile,
      onPrev: prevStep,
      onNext: nextStep,
      onGotoStep: gotoStep,
    });
    const fields = document.getElementById('step-fields');
    const refreshFields = () => {
      renderStepFields(fields, step, qs, store);
      bindFormEvents(fields, store, { onButtonChange: refreshFields });
    };
    refreshFields();
    const previewEl = document.getElementById('step-preview');
    renderLivePreview(previewEl, {
      tipo: state.tipo, values: store.values(), mode: state.previewMode,
      activeTargets: state.activeTargets, imageUrl: state.imageUrl,
    });
    previewEl.addEventListener('change-mode', (e) => {
      state.previewMode = e.detail;
      renderLivePreview(previewEl, {
        tipo: state.tipo, values: store.values(), mode: state.previewMode,
        activeTargets: state.activeTargets, imageUrl: state.imageUrl,
      });
    });
  }

  // Badge canto superior
  getOfertasSource().then((info) => {
    const badge = document.createElement('div');
    badge.style.cssText =
      'position:fixed;top:8px;right:8px;z-index:1000;' +
      'padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;' +
      'letter-spacing:.06em;text-transform:uppercase;' +
      (info.source === 'firestore'
        ? 'background:#dcfce7;color:#15803d;'
        : 'background:#fef3c7;color:#92400e;');
    badge.textContent =
      info.source === 'firestore'
        ? `Firestore${mode === 'edit' ? ' · editando' : ''}`
        : 'Modo local';
    document.body.appendChild(badge);
  });

  bootstrap();
}
