/* Componentes de interface: ícones, modais, avisos e helpers de DOM. */
window.UI = (() => {
  'use strict';

  const paths = {
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    truck: '<path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
    clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="m9 14 2 2 4-4"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3"/>',
    output: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3"/>',
    trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    gps: '<path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
    whatsapp: '<path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Z"/><path d="M8.5 8.2c.2-.4.3-.5.6-.5h.5c.2 0 .4 0 .5.4l.7 1.6c.1.2 0 .4-.1.5l-.4.4c-.1.2-.3.3-.1.6a8 8 0 0 0 3.2 2.8c.3.1.4 0 .6-.1l.5-.6c.2-.2.3-.2.5-.1l1.6.8c.3.1.4.2.4.3 0 .2 0 .9-.4 1.4-.4.5-1 .8-1.5.8-1.5 0-3.7-.9-5.2-2.4s-2.4-3.6-2.4-5.1c0-.6.3-1.2.5-1.4Z"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    install: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2"/>',
  };

  function icon(name, size = 26) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? ''}</svg>`;
  }

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtDate = (iso) => {
    if (!iso) return '—';
    const [a, m, d] = String(iso).slice(0, 10).split('-');
    return a ? `${d}/${m}/${a}` : String(iso);
  };

  const fmtTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const nowTime = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // folhas abertas: o voltar do aparelho fecha a folha antes de trocar de tela
  const abertas = new Set();

  /** Fecha (como Cancelar) toda folha aberta; devolve true se havia alguma. */
  function fecharFolhas() {
    if (!abertas.size) return false;
    [...abertas].forEach((cancelar) => cancelar());
    return true;
  }

  let toastTimer = null;
  function toast(msg) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2600);
  }

  /**
   * Modal em folha inferior. `campos` vira formulário; resolve com os valores
   * ou null quando cancela. Sem usar prompt()/confirm() do navegador.
   */
  function sheet({ title, fields = [], text, submit = 'Salvar', danger = false, onOpen }) {
    return new Promise((resolve) => {
      const scrim = document.createElement('div');
      scrim.className = 'scrim';
      const campos = fields.map((f, i) => {
        const id = `f_${i}`;
        if (f.type === 'select') {
          const opts = (f.options || []).map((o) => {
            const val = typeof o === 'string' ? o : o.value;
            const lab = typeof o === 'string' ? o : o.label;
            return `<option value="${esc(val)}"${String(val) === String(f.value) ? ' selected' : ''}>${esc(lab)}</option>`;
          }).join('');
          return `<div class="field"><label for="${id}">${esc(f.label)}</label><select id="${id}" data-key="${esc(f.key)}">${opts}</select></div>`;
        }
        if (f.type === 'textarea') {
          return `<div class="field"><label for="${id}">${esc(f.label)}</label><textarea id="${id}" data-key="${esc(f.key)}" placeholder="${esc(f.placeholder || '')}">${esc(f.value ?? '')}</textarea></div>`;
        }
        const tipo = f.type || 'text';
        const extra = tipo === 'number' ? ' min="0" max="100" step="1" inputmode="numeric"' : '';
        return `<div class="field"><label for="${id}">${esc(f.label)}</label><input id="${id}" data-key="${esc(f.key)}" type="${tipo}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}"${extra}${f.readonly ? ' readonly' : ''}></div>`;
      }).join('');

      scrim.innerHTML = `
        <div class="sheet" role="dialog" aria-modal="true">
          <h2>${esc(title)}</h2>
          ${text ? `<div style="font-size:13px;line-height:1.5;color:var(--text-soft)">${esc(text)}</div>` : ''}
          ${campos}
          <div class="sheet-actions">
            <button class="btn ghost" data-act="cancel">Cancelar</button>
            <button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${esc(submit)}</button>
          </div>
        </div>`;

      const cancelar = () => fechar(null);
      const fechar = (valor) => { abertas.delete(cancelar); scrim.remove(); resolve(valor); };
      abertas.add(cancelar);
      scrim.addEventListener('click', (e) => {
        if (e.target === scrim) fechar(null);
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'cancel') fechar(null);
        if (act === 'ok') {
          const valores = {};
          scrim.querySelectorAll('[data-key]').forEach((el) => {
            // número em branco volta '' (não 0): campo não preenchido fica sem valor
            if (el.type === 'number') valores[el.dataset.key] = el.value === '' ? '' : Number(el.value);
            else valores[el.dataset.key] = el.value.trim();
          });
          fechar(valores);
        }
      });
      document.body.appendChild(scrim);
      onOpen?.(scrim);
      const primeiro = scrim.querySelector('input, select, textarea');
      if (!primeiro?.readOnly) primeiro?.focus();
    });
  }

  function confirmar(titulo, texto, rotulo = 'Excluir') {
    return new Promise((resolve) => {
      const scrim = document.createElement('div');
      scrim.className = 'scrim';
      scrim.innerHTML = `
        <div class="sheet" role="dialog" aria-modal="true">
          <h2>${esc(titulo)}</h2>
          <div style="font-size:13px;line-height:1.5;color:var(--text-soft)">${esc(texto)}</div>
          <div class="sheet-actions">
            <button class="btn ghost" data-act="nao">Cancelar</button>
            <button class="btn danger" data-act="sim">${esc(rotulo)}</button>
          </div>
        </div>`;
      const cancelar = () => fechar(false);
      const fechar = (valor) => { abertas.delete(cancelar); scrim.remove(); resolve(valor); };
      abertas.add(cancelar);
      scrim.addEventListener('click', (e) => {
        if (e.target === scrim) fechar(false);
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'nao') fechar(false);
        if (act === 'sim') fechar(true);
      });
      document.body.appendChild(scrim);
    });
  }

  return { icon, esc, fmtDate, fmtTime, nowTime, toast, sheet, confirmar, fecharFolhas };
})();
