/*
 * Tela da conta principal (Tiago): todos os RDOs que chegaram no banco, por dia ou por
 * período. Embaixo da lista fica o botão "Gerar RDO": ele monta o arquivo no mesmo formato
 * do relatório (um RDO por página) e o arquivo aparece ali para baixar. Por período, todos
 * os RDOs saem num PDF só.
 *
 * Tocar num RDO abre ele para corrigir; a correção é gravada no documento do dono, e o
 * aparelho dele recebe a versão nova na próxima vez que abrir o app.
 */
window.Mestre = (() => {
  'use strict';

  const { icon, esc, fmtDate, toast } = UI;
  const hoje = () => Store.todayIso();

  let modo = 'dia';                 // dia | periodo
  let dia = hoje();
  let de = `${hoje().slice(0, 8)}01`;
  let ate = hoje();
  let cache = { chave: '', lista: [] };
  let carregando = false;
  let erro = '';
  let pronto = null;                // { nome, blob, quantos }
  let gerando = false;
  let avisoGerar = '';

  const intervalo = () => (modo === 'dia' ? { de: dia, ate: dia } : { de, ate });
  const chaveDe = () => {
    const { de: a, ate: b } = intervalo();
    return `${a}|${b}`;
  };

  async function carregar(app) {
    const chave = chaveDe();
    if (cache.chave === chave || carregando) return;
    carregando = true;
    erro = '';
    try {
      cache = { chave, lista: await Nuvem.todos(intervalo().de, intervalo().ate) };
    } catch (e) {
      erro = e.message;
      cache = { chave, lista: [] };
    }
    carregando = false;
    app?.render?.();
  }

  /** RDO do banco pronto para o PDF: o JSON mais as fotos baixadas na hora. */
  async function paraPdf(registro) {
    const rdo = { stoppages: [], ...registro.json };
    const metas = Array.isArray(rdo.photos) ? rdo.photos : [];
    const imagens = await Nuvem.fotosDe(registro.docId).catch(() => []);
    if (imagens.length) {
      rdo.photos = imagens.map((dados, i) => ({ ...(metas[i] || {}), data: dados }));
    }
    return rdo;
  }

  async function gerar(app) {
    if (gerando) return;
    const lista = cache.lista.slice();
    if (!lista.length) { toast('Nenhum RDO neste intervalo.'); return; }
    gerando = true;
    avisoGerar = '';
    app?.render?.();
    try {
      const rdos = [];
      for (let i = 0; i < lista.length; i += 1) {
        avisoGerar = `Baixando as fotos do RDO ${lista[i].json.number} (${i + 1} de ${lista.length})...`;
        app?.render?.();
        rdos.push(await paraPdf(lista[i]));
      }
      avisoGerar = 'Montando o PDF...';
      app?.render?.();
      const nome = modo === 'dia' ? `RDO_${dia}.pdf` : `RDO_${de}_a_${ate}.pdf`;
      const titulo = modo === 'dia' ? `RDO ${fmtDate(dia)}` : `RDOs de ${fmtDate(de)} a ${fmtDate(ate)}`;
      const { doc } = await Pdf.montarVarios(rdos, { nome, titulo });
      pronto = { nome, blob: doc.output('blob'), quantos: rdos.length };
      toast(`PDF pronto: ${rdos.length} RDO(s).`);
    } catch (e) {
      toast(e.message || 'Não foi possível montar o PDF.');
    } finally {
      gerando = false;
      avisoGerar = '';
      app?.render?.();
    }
  }

  const kb = (bytes) => `${Math.max(1, Math.round(Number(bytes || 0) / 1024))} KB`;

  function listaHtml() {
    if (carregando) return '<div class="empty">Buscando os RDOs no banco...</div>';
    if (erro) return `<div class="aviso erro">${esc(erro)}</div>`;
    if (!cache.lista.length) return '<div class="empty">Nenhum RDO neste intervalo.</div>';
    const dias = new Map();
    cache.lista.forEach((x) => {
      const d = String(x.json.date || '');
      if (!dias.has(d)) dias.set(d, []);
      dias.get(d).push(x);
    });
    return [...dias.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([d, itens]) => `
      <div class="section-label">${fmtDate(d)} · ${itens.length} RDO(s)</div>
      <div class="lista-cartoes">${itens.map((x) => `
        <button class="card linha-rdo" data-abrir="${esc(x.docId)}">
          <div class="body">
            <div class="name">RDO ${esc(x.json.number)}</div>
            <div class="sub">${esc(x.nome || x.email || 'sem nome')} · ${esc(x.json.location || 'sem local')}
              ${x.json.status === 'final' ? ' · finalizado' : ''}</div>
          </div>
          <span class="arrow">${icon('chevron', 16)}</span>
        </button>`).join('')}</div>`).join('');
  }

  function prontoHtml() {
    if (!pronto) return '';
    return `
      <div class="card"><div class="body">
        <div class="name">${icon('file', 16)} ${esc(pronto.nome)}</div>
        <div class="sub">${pronto.quantos} RDO(s) · ${kb(pronto.blob.size)} · pronto para baixar</div>
      </div></div>
      <button class="btn primary block" data-act="baixar-pdf">${icon('download', 18)}<span>Baixar / compartilhar o PDF</span></button>`;
  }

  function tela(app) {
    carregar(app);
    return {
      titulo: 'RDOs da Equipe',
      html: `
        <div class="abas">
          <button type="button" class="aba${modo === 'dia' ? ' ativa' : ''}" data-modo="dia">Por dia</button>
          <button type="button" class="aba${modo === 'periodo' ? ' ativa' : ''}" data-modo="periodo">Por período</button>
        </div>
        ${modo === 'dia' ? `
          <div class="field"><label for="e-dia">Dia</label>
            <input id="e-dia" type="date" value="${esc(dia)}"></div>`
        : `
          <div class="field"><label for="e-de">De</label>
            <input id="e-de" type="date" value="${esc(de)}"></div>
          <div class="field"><label for="e-ate">Até</label>
            <input id="e-ate" type="date" value="${esc(ate)}"></div>`}

        <div class="section-label">RDOs no banco${cache.lista.length ? ` · ${cache.lista.length}` : ''}</div>
        <div id="lista-equipe">${listaHtml()}</div>

        <button class="btn primary block" data-act="gerar"${cache.lista.length && !gerando ? '' : ' disabled'}>
          ${icon('output', 18)}<span>${gerando ? 'Preparando...' : 'Gerar RDO'}</span></button>
        ${gerando ? `<p class="dica">${esc(avisoGerar || 'Preparando o arquivo...')}</p>` : ''}
        <p class="dica">Um RDO por página, no formato do relatório. Por período, todos vão num PDF só.</p>
        ${prontoHtml()}`,
      bind(root) {
        root.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
          modo = b.dataset.modo;
          pronto = null;
          app.render();
        }));
        root.querySelector('#e-dia')?.addEventListener('change', (e) => {
          if (!e.target.value) return;
          dia = e.target.value;
          pronto = null;
          app.render();
        });
        root.querySelector('#e-de')?.addEventListener('change', (e) => {
          if (!e.target.value) return;
          de = e.target.value;
          if (ate < de) ate = de;
          pronto = null;
          app.render();
        });
        root.querySelector('#e-ate')?.addEventListener('change', (e) => {
          if (!e.target.value) return;
          ate = e.target.value;
          if (de > ate) de = ate;
          pronto = null;
          app.render();
        });

        root.querySelectorAll('[data-abrir]').forEach((b) => b.addEventListener('click', async () => {
          const item = cache.lista.find((x) => x.docId === b.dataset.abrir);
          if (!item) return;
          b.disabled = true;
          try {
            const id = await Conta.abrirDoBanco(item);
            if (id) app.abrir(id);
            else toast('Não foi possível abrir este RDO.');
          } catch (e) { toast(e.message); }
          b.disabled = false;
        }));

        root.querySelector('[data-act="gerar"]')?.addEventListener('click', () => gerar(app));

        root.querySelector('[data-act="baixar-pdf"]')?.addEventListener('click', async () => {
          if (!pronto) return;
          const res = await UI.entregarArquivo(pronto.blob, pronto.nome, 'Salvar ou enviar o PDF')
            .catch(() => 'erro');
          if (res === 'baixado') toast('PDF baixado.');
          if (res === 'compartilhado') toast('PDF entregue para o compartilhar.');
          if (res === 'erro') toast('Não foi possível entregar o arquivo.');
        });
      },
    };
  }

  return { tela };
})();
