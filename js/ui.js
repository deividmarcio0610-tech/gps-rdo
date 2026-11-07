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
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    text: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.3"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
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
        // lista de marcar, em grupos (ex.: escolher da equipe); volta o array dos valores marcados
        if (f.type === 'checks') {
          return `<div class="checks" data-checks="${esc(f.key)}">${(f.grupos || []).map((g, gi) => `
            <div class="checks-grupo">
              <div class="checks-titulo"><span>${esc(g.titulo)}</span>
                <button type="button" class="btn ghost" data-act="todos" data-grupo="${gi}">Marcar todos</button></div>
              ${g.itens.map((it) => `
                <label class="check${it.disabled ? ' off' : ''}" data-grupo="${gi}">
                  <input type="checkbox" value="${esc(it.value)}"${it.checked ? ' checked' : ''}${it.disabled ? ' disabled' : ''}>
                  <span>${esc(it.label)}</span>${it.nota ? `<small>${esc(it.nota)}</small>` : ''}
                </label>`).join('')}
            </div>`).join('')}</div>`;
        }
        if (f.type === 'select') {
          const opts = (f.options || []).map((o) => {
            const val = typeof o === 'string' ? o : o.value;
            const lab = typeof o === 'string' ? o : o.label;
            return `<option value="${esc(val)}"${String(val) === String(f.value) ? ' selected' : ''}>${esc(lab)}</option>`;
          }).join('');
          return `<div class="field"><label for="${id}">${esc(f.label)}</label><select id="${id}" data-key="${esc(f.key)}">${opts}</select></div>`;
        }
        if (f.type === 'textarea') {
          return `<div class="field"><label for="${id}">${esc(f.label)}</label><textarea id="${id}" data-key="${esc(f.key)}" data-ditado placeholder="${esc(f.placeholder || '')}">${esc(f.value ?? '')}</textarea></div>`;
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
        const alvo = e.target.closest('[data-act]');
        const act = alvo?.dataset.act;
        if (act === 'cancel') fechar(null);
        if (act === 'todos') {
          // marca o grupo inteiro; se já estava tudo marcado, desmarca
          const caixas = [...scrim.querySelectorAll(`label.check[data-grupo="${alvo.dataset.grupo}"] input:not(:disabled)`)];
          const marcar = caixas.some((c) => !c.checked);
          caixas.forEach((c) => { c.checked = marcar; });
        }
        if (act === 'ok') {
          const valores = {};
          scrim.querySelectorAll('[data-key]').forEach((el) => {
            // número em branco volta '' (não 0): campo não preenchido fica sem valor
            if (el.type === 'number') valores[el.dataset.key] = el.value === '' ? '' : Number(el.value);
            else valores[el.dataset.key] = el.value.trim();
          });
          scrim.querySelectorAll('[data-checks]').forEach((bloco) => {
            valores[bloco.dataset.checks] = [...bloco.querySelectorAll('input:checked:not(:disabled)')].map((c) => c.value);
          });
          fechar(valores);
        }
      });
      document.body.appendChild(scrim);
      ligarDitado(scrim);
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

  // ditado por voz: só onde o navegador tem reconhecimento (Chrome, Safari). No APK e onde
  // não houver, o botão não aparece e vale o microfone do próprio teclado do celular.
  const Reconhecedor = window.SpeechRecognition || window.webkitSpeechRecognition;

  /** Põe o botão de microfone nos campos de texto marcados com data-ditado. */
  function ligarDitado(raiz) {
    if (!Reconhecedor || !raiz) return;
    raiz.querySelectorAll('textarea[data-ditado]:not([data-ditado-ok])').forEach((campo) => {
      campo.dataset.ditadoOk = '1';
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'mic';
      botao.setAttribute('aria-label', 'Ditar por voz');
      botao.innerHTML = icon('mic', 18);
      campo.parentElement.classList.add('com-ditado');
      campo.insertAdjacentElement('afterend', botao);
      let ouvindo = null;
      botao.addEventListener('click', () => {
        if (ouvindo) { ouvindo.stop(); return; }
        const rec = new Reconhecedor();
        rec.lang = 'pt-BR';
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        rec.onresult = (e) => {
          const texto = [...e.results].map((x) => x[0].transcript).join(' ').trim();
          if (texto) campo.value = campo.value ? `${campo.value.trimEnd()} ${texto}` : texto;
        };
        rec.onerror = (e) => toast(e.error === 'not-allowed'
          ? 'Permita o microfone para ditar.'
          : 'Não entendi. Tente de novo ou use o microfone do teclado.');
        rec.onend = () => { ouvindo = null; botao.classList.remove('ouvindo'); };
        try {
          rec.start();
          ouvindo = rec;
          botao.classList.add('ouvindo');
          toast('Pode falar... toque de novo para parar.');
        } catch {
          toast('Ditado indisponível neste aparelho.');
        }
      });
    });
  }

  function baixar(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  const blobParaBase64 = (blob) => new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).split(',')[1]);
    leitor.onerror = reject;
    leitor.readAsDataURL(blob);
  });

  /**
   * Entrega um arquivo pelo compartilhar do aparelho (Salvar em Arquivos, Drive, WhatsApp,
   * e-mail) ou, sem isso, baixa. No navegador tem de ser chamado direto no toque do botão:
   * o Safari só abre o compartilhar dentro do toque.
   * Devolve 'compartilhado', 'cancelado' ou 'baixado'.
   */
  function entregarArquivo(conteudo, nome, titulo = 'Salvar ou enviar') {
    const nativo = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins : null;
    if (nativo?.Filesystem && nativo?.Share) {
      return (async () => {
        const arq = await nativo.Filesystem.writeFile({ path: nome, data: await blobParaBase64(conteudo), directory: 'CACHE' });
        try {
          await nativo.Share.share({ title: nome, files: [arq.uri], dialogTitle: titulo });
          return 'compartilhado';
        } catch (err) {
          if (/cancel/i.test(String(err?.message || err))) return 'cancelado';
          throw err;
        }
      })();
    }
    const arquivo = new File([conteudo], nome, { type: conteudo.type || 'application/octet-stream' });
    if (navigator.canShare?.({ files: [arquivo] })) {
      return navigator.share({ files: [arquivo], title: nome }).then(() => 'compartilhado', (err) => {
        if (err?.name === 'AbortError') return 'cancelado';
        baixar(arquivo, nome);
        return 'baixado';
      });
    }
    baixar(arquivo, nome);
    return Promise.resolve('baixado');
  }

  /**
   * Botão em duas etapas para arquivo que demora a montar (PDF, cópia): 1º toque monta,
   * 2º toque entrega. No APK entrega direto no 1º toque (lá não há a regra do toque).
   */
  function botaoArquivo(botao, { rotulo, preparar, aoEntregar }) {
    const texto = botao.querySelector('span') || botao;
    let pronto = null;
    botao.addEventListener('click', async () => {
      if (pronto) {
        const p = pronto;
        pronto = null;
        texto.textContent = rotulo;
        entregarArquivo(p.blob, p.nome, p.titulo).then(aoEntregar, () => toast('Não foi possível entregar o arquivo.'));
        return;
      }
      botao.disabled = true;
      texto.textContent = 'Montando o arquivo...';
      try {
        const p = await preparar();
        if (window.Capacitor?.isNativePlatform?.()) {
          texto.textContent = rotulo;
          aoEntregar?.(await entregarArquivo(p.blob, p.nome, p.titulo));
        } else {
          pronto = p;
          texto.textContent = 'Pronto: toque para salvar/enviar';
        }
      } catch {
        texto.textContent = rotulo;
        toast('Não foi possível montar o arquivo.');
      } finally {
        botao.disabled = false;
      }
    });
  }

  return { icon, esc, fmtDate, fmtTime, nowTime, toast, sheet, confirmar, fecharFolhas, entregarArquivo, botaoArquivo, ligarDitado };
})();
