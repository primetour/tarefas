/**
 * PRIMETOUR — Dynamic Fields Component (Fase 1)
 * Renderiza campos customizados de um tipo de tarefa
 */

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ─── Renderizar HTML de um campo ────────────────────────── */
export function renderField(field, currentValue = null) {
  const id    = `cf-${field.key}`;
  const label = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
      <span class="form-label" style="margin:0;">${esc(field.label)}${field.required?' *':''}</span>
      ${field.info ? `<span title="${esc(field.info)}" style="cursor:help;color:var(--text-muted);font-size:0.75rem;">ℹ</span>` : ''}
    </div>
  `;

  switch (field.type) {
    case 'text':
      return `<div class="task-detail-field">
        ${label}
        <input type="text" class="form-input dynamic-field" id="${id}"
          data-field-key="${field.key}"
          value="${esc(currentValue||'')}"
          placeholder="${esc(field.placeholder||'')}"
          style="padding:8px 12px;" />
      </div>`;

    case 'textarea':
      return `<div class="task-detail-field">
        ${label}
        <textarea class="form-textarea dynamic-field" id="${id}"
          data-field-key="${field.key}"
          rows="2"
          placeholder="${esc(field.placeholder||'')}"
          style="font-size:0.875rem;">${esc(currentValue||'')}</textarea>
      </div>`;

    case 'checkbox':
      return `<div class="task-detail-field"
        style="display:flex;align-items:center;gap:10px;padding:6px 0;">
        <input type="checkbox" class="dynamic-field" id="${id}"
          data-field-key="${field.key}"
          ${currentValue ? 'checked' : ''}
          style="width:16px;height:16px;accent-color:var(--brand-gold);cursor:pointer;flex-shrink:0;" />
        <label for="${id}"
          style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.875rem;color:var(--text-secondary);">
          ${esc(field.label)}
          ${field.info ? `<span title="${esc(field.info)}" style="cursor:help;color:var(--text-muted);font-size:0.75rem;">ℹ</span>` : ''}
        </label>
      </div>`;

    case 'select':
      return `<div class="task-detail-field">
        ${label}
        <select class="form-select dynamic-field" id="${id}"
          data-field-key="${field.key}"
          style="padding:8px 32px 8px 12px;">
          <option value="">— Selecione —</option>
          ${(field.options||[]).map(opt =>
            `<option value="${esc(opt)}" ${currentValue===opt?'selected':''}>${esc(opt)}</option>`
          ).join('')}
        </select>
      </div>`;

    case 'multiselect': {
      const selected = Array.isArray(currentValue) ? currentValue : [];
      return `<div class="task-detail-field">
        ${label}
        <div style="display:flex;flex-wrap:wrap;gap:6px;padding:6px 0;"
          id="${id}-chips" data-field-key="${field.key}">
          ${(field.options||[]).map(opt => {
            const isSelected = selected.includes(opt);
            return `<label class="multiselect-chip ${isSelected?'active':''}"
              style="display:flex;align-items:center;gap:5px;cursor:pointer;
              padding:4px 10px;border-radius:var(--radius-full);font-size:0.8125rem;
              border:1px solid ${isSelected?'var(--brand-gold)':'var(--border-subtle)'};
              background:${isSelected?'rgba(212,168,67,0.12)':'var(--bg-surface)'};
              color:${isSelected?'var(--brand-gold)':'var(--text-secondary)'};
              transition:all 0.15s;">
              <input type="checkbox" value="${esc(opt)}"
                class="dynamic-field-ms" data-field-key="${field.key}"
                ${isSelected?'checked':''} style="display:none;" />
              ${esc(opt)}
            </label>`;
          }).join('')}
        </div>
      </div>`;
    }

    case 'number':
      return `<div class="task-detail-field">
        ${label}
        <input type="number" class="form-input dynamic-field" id="${id}"
          data-field-key="${field.key}"
          value="${currentValue ?? ''}"
          placeholder="0"
          style="padding:8px 12px;" />
      </div>`;

    case 'date':
      return `<div class="task-detail-field">
        ${label}
        <input type="date" class="form-input dynamic-field" id="${id}"
          data-field-key="${field.key}"
          value="${currentValue ? new Date(currentValue).toISOString().slice(0,10) : ''}"
          style="padding:8px 12px;" />
      </div>`;

    default:
      return '';
  }
}

/* ─── Renderizar todos os campos de um tipo ──────────────── */
export function renderTypeFields(taskType, customFields = {}) {
  if (!taskType?.fields?.length) return '';
  return taskType.fields
    .filter(f => !f.system) // exclude system-injected fields (currentStep etc)
    .map(f => renderField(f, customFields[f.key] ?? null))
    .join('');
}

/* ─── Coletar valores do DOM ─────────────────────────────── */
export function collectFieldValues(ctx = document) {
  const values = {};

  // Campos simples (text, textarea, select, number, date)
  ctx.querySelectorAll('.dynamic-field[data-field-key]').forEach(el => {
    const key = el.dataset.fieldKey;
    if (el.type === 'checkbox') {
      values[key] = el.checked;
    } else {
      values[key] = el.value || null;
    }
  });

  // Multiselect chips — agrupa por field-key
  const msGroups = {};
  ctx.querySelectorAll('.dynamic-field-ms[data-field-key]:checked').forEach(cb => {
    const key = cb.dataset.fieldKey;
    if (!msGroups[key]) msGroups[key] = [];
    msGroups[key].push(cb.value);
  });
  Object.assign(values, msGroups);

  // Limpar nulls e strings vazias opcionais
  Object.keys(values).forEach(k => {
    if (values[k] === '' || values[k] === null) delete values[k];
  });

  return values;
}

/* ─── Bind eventos de chips multiselect ─────────────────── */
export function bindDynamicFieldEvents(ctx = document) {
  ctx.querySelectorAll('.multiselect-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const cb      = chip.querySelector('.dynamic-field-ms');
      if (!cb) return;
      cb.checked        = !cb.checked;
      const isActive    = cb.checked;
      chip.style.borderColor = isActive ? 'var(--brand-gold)' : 'var(--border-subtle)';
      chip.style.background  = isActive ? 'rgba(212,168,67,0.12)' : 'var(--bg-surface)';
      chip.style.color       = isActive ? 'var(--brand-gold)'     : 'var(--text-secondary)';
    });
  });
}

/* ─── Validar campos obrigatórios ────────────────────────── */
export function validateRequiredFields(taskType, ctx = document) {
  if (!taskType?.fields) return [];
  const errors = [];
  taskType.fields.filter(f => f.required).forEach(f => {
    const id = `cf-${f.key}`;
    const el = ctx.querySelector(`#${id}, #${id}-chips`);
    if (!el) return;
    if (el.type === 'checkbox') return; // checkboxes não são required no sentido tradicional
    const val = collectFieldValues(ctx)[f.key];
    if (!val || (Array.isArray(val) && !val.length)) {
      errors.push({ key: f.key, label: f.label, message: `"${f.label}" é obrigatório.` });
    }
  });
  return errors;
}
