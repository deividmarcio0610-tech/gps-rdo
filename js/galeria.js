/*
 * Galeria de fotos da equipe (conta principal). Pedido de 17/11/2026: juntar as fotos que os
 * funcionários tiram nos RDOs num lugar só, organizadas por dia e por atividade, com a
 * descrição e quem tirou, e poder salvar cada uma no telefone.
 *
 * A lista vem dos RDOs do período (a descrição de cada foto está no próprio RDO); a imagem
 * só é baixada quando o grupo aparece na tela, um RDO por vez, para não puxar o mês inteiro.
 */
window.Galeria = (() => {
  'use strict';

  const { esc, toast, icon } = window.UI;
  const fmtDate = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
  const hojeIso = () => Store.todayIso();
  const diasAtras = (n) => {
    const d = new Date(); d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  let de = hojeIso();
  let ate = hojeIso();
  let pessoa = '';
  let cache = { chave: '', lista: [] };
  let carregando = false;
  let erro = '';
  const imagens = new Map(); // docId -> Promise<[dataUrl]>

  const quem = (x) => x.nome || x.json?.autor?.nome || x.email || 'sem nome';

  async function carregar(app) {
    const chave = `${de}|${ate}`;
    if (cache.chave === chave || carregando) return;
    carregando = true;
    erro = '';
    try {
      cache = { chave, lista: await Nuvem.todos(de, ate) };
    } catch (e) {
      erro = e.message || 'Não foi possível ler o banco.';
      cache = { chave, lista: [] };
    }
    carregando = false;
    app?.render?.();
  }

  /** Atividade da foto: a escolhida ao anexar; RDO com uma tarefa só fica com ela; senão "Geral". */
  function atividadeDa(foto, rdo) {
    const a = foto.atividade;
    if (a && (a.descricao || a.os || a.tag)) return a;
    const ts = (rdo.tasks || []).filter((t) => t && (t.description || t.os || t.tag));
    if (ts.length === 1) return { os: ts[0].os || '', tag: ts[0].tag || '', descricao: ts[0].description || '' };
    return null;
  }
  const rotuloAtividade = (a) => (a ? [a.os && `OS ${a.os}`, a.tag, a.descricao].filter(Boolean).join(' · ') : 'Geral (sem atividade)');

  /** Todas as fotos do período, já com dia, atividade, pessoa e posição no RDO. */
  function levantar(lista) {
    const fotos = [];
    lista.forEach((x) => {
      const r = x.json || {};
      (r.photos || []).forEach((p, i) => {
        if (!p) return;
        const atv = atividadeDa(p, r);
        fotos.push({
          docId: x.docId, idx: i, pessoa: quem(x), dia: p.date || r.date || '', hora: p.time || '',
          rdo: r.number || '', local: r.location || '', desc: String(p.desc || '').trim(),
          atividade: atv, grupo: rotuloAtividade(atv), gps: p.latitude != null,
        });
      });
    });
    return fotos.sort((a, b) => `${b.dia} ${b.hora}`.localeCompare(`${a.dia} ${a.hora}`));
  }

  /** Dia (mais novo primeiro) -> atividade (mais fotos primeiro) -> fotos. */
  function organizar(fotos) {
    const dias = new Map();
    fotos.forEach((f) => {
      if (!dias.has(f.dia)) dias.set(f.dia, new Map());
      const g = dias.get(f.dia);
      if (!g.has(f.grupo)) g.set(f.grupo, []);
      g.get(f.grupo).push(f);
    });
    return [...dias.entries()].sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dia, g]) => [dia, [...g.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))]);
  }

  function imagensDo(docId) {
    if (!imagens.has(docId)) imagens.set(docId, Nuvem.fotosDe(docId).catch(() => { imagens.delete(docId); return []; }));
    return imagens.get(docId);
  }

  const nomeArquivo = (f) => {
    const limpo = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w .-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return `${f.dia} ${limpo(f.atividade?.descricao || 'Geral').slice(0, 40)} - ${limpo(f.pessoa).slice(0, 30)} - ${f.idx + 1}.jpg`;
  };

  function tela(app) {
    carregar(app);
    let corpo;
    const fotosTodas = cache.chave === `${de}|${ate}` ? levantar(cache.lista) : [];
    const pessoas = [...new Set(fotosTodas.map((f) => f.pessoa))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const fotos = pessoa ? fotosTodas.filter((f) => f.pessoa === pessoa) : fotosTodas;
    if (carregando || cache.chave !== `${de}|${ate}`) corpo = '<div class="empty">Buscando os RDOs no banco...</div>';
    else if (erro) corpo = `<div class="aviso erro">${esc(erro)}</div>`;
    else if (!fotos.length) corpo = '<div class="empty">Nenhuma foto nos RDOs deste período.</div>';
    else {
      const grupos = organizar(fotos);
      corpo = `
        <div class="gal-resumo"><strong>${fotos.length}</strong> foto(s) · ${new Set(fotos.map((f) => f.docId)).size} RDO(s) ·
          ${grupos.length} dia(s)${pessoa ? '' : ` · ${pessoas.length} pessoa(s)`}</div>
        ${grupos.map(([dia, atvs]) => `
          <div class="section-label">${fmtDate(dia) || 'Sem data'} · ${atvs.reduce((s, [, l]) => s + l.length, 0)} foto(s)</div>
          ${atvs.map(([grupo, lista]) => `
            <div class="gal-grupo">
              <div class="gal-titulo">${esc(grupo)} <span>${lista.length}</span></div>
              <div class="photo-grid">${lista.map((f) => `
                <figure class="photo gal-foto" data-doc="${esc(f.docId)}" data-idx="${f.idx}">
                  <img alt="${esc(f.desc || f.grupo)}" loading="lazy">
                  ${f.gps ? `<span class="gps">${icon('gps', 9)} GPS</span>` : ''}
                  <button class="rm gal-salvar" data-salvar="${esc(f.docId)}|${f.idx}" aria-label="Salvar a foto">${icon('download', 13)}</button>
                  <figcaption class="cap">${esc(f.desc || '—')}<br><small>${esc(f.pessoa)} · ${esc(f.hora)} · RDO ${esc(f.rdo)}${f.local ? ` · ${esc(f.local)}` : ''}</small></figcaption>
                </figure>`).join('')}</div>
            </div>`).join('')}`).join('')}`;
    }
    return {
      titulo: 'Galeria de fotos',
      html: `
        <div class="form-grid">
          <div class="field"><label for="gal-de">De</label><input id="gal-de" type="date" value="${esc(de)}"></div>
          <div class="field"><label for="gal-ate">Até</label><input id="gal-ate" type="date" value="${esc(ate)}"></div>
        </div>
        <div class="btn-row">
          <button class="btn ghost" data-gal-periodo="hoje">Hoje</button>
          <button class="btn ghost" data-gal-periodo="7">7 dias</button>
          <button class="btn ghost" data-gal-periodo="30">30 dias</button>
          <button class="btn ghost" data-act="gal-atualizar">${icon('refresh', 14)}Atualizar</button>
        </div>
        ${pessoas.length > 1 ? `<div class="field"><label for="gal-pessoa">Quem tirou</label>
          <select id="gal-pessoa"><option value="">Todos</option>${pessoas.map((p) => `<option${p === pessoa ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></div>` : ''}
        ${corpo}
        <p class="dica">Fotos dos RDOs que já subiram, por dia e atividade. A atividade é a escolhida ao anexar a foto
          (RDO com uma tarefa só fica com ela). Toque em ${icon('download', 11)} para salvar no telefone.</p>`,
      bind(root) {
        const mudar = (a, b) => { de = a; ate = b; app.render(); };
        root.querySelector('#gal-de')?.addEventListener('change', (e) => { if (e.target.value) mudar(e.target.value, ate < e.target.value ? e.target.value : ate); });
        root.querySelector('#gal-ate')?.addEventListener('change', (e) => { if (e.target.value) mudar(de > e.target.value ? e.target.value : de, e.target.value); });
        root.querySelectorAll('[data-gal-periodo]').forEach((b) => b.addEventListener('click', () => {
          const p = b.dataset.galPeriodo;
          mudar(p === 'hoje' ? hojeIso() : diasAtras(Number(p) - 1), hojeIso());
        }));
        root.querySelector('#gal-pessoa')?.addEventListener('change', (e) => { pessoa = e.target.value; app.render(); });
        root.querySelector('[data-act="gal-atualizar"]')?.addEventListener('click', () => { cache = { ...cache, chave: '' }; imagens.clear(); app.render(); });

        // imagem só quando a foto chega perto da tela; um pedido por RDO
        const preencher = (fig) => {
          imagensDo(fig.dataset.doc).then((lista) => {
            const src = lista[Number(fig.dataset.idx)];
            const img = fig.querySelector('img');
            if (src && img && !img.src) img.src = src;
            else if (!src) fig.classList.add('gal-sem');
          });
        };
        const figs = [...root.querySelectorAll('.gal-foto')];
        if ('IntersectionObserver' in window) {
          const obs = new IntersectionObserver((itens) => itens.forEach((it) => {
            if (it.isIntersecting) { obs.unobserve(it.target); preencher(it.target); }
          }), { rootMargin: '300px' });
          figs.forEach((f) => obs.observe(f));
        } else figs.forEach(preencher);

        root.querySelectorAll('[data-salvar]').forEach((b) => b.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const [docId, idx] = b.dataset.salvar.split('|');
          const f = levantar(cache.lista).find((x) => x.docId === docId && String(x.idx) === idx);
          const src = (await imagensDo(docId))[Number(idx)];
          if (!f || !src) { toast('Foto ainda não carregou.'); return; }
          try {
            const blob = await (await fetch(src)).blob();
            const r = await UI.entregarArquivo(blob, nomeArquivo(f), 'Salvar a foto');
            if (r === 'baixado') toast('Foto baixada.');
          } catch (e) {
            toast(`Não foi possível salvar: ${e.message || e}`);
          }
        }));
      },
    };
  }

  function limpar() {
    cache = { chave: '', lista: [] };
    imagens.clear();
    pessoa = '';
  }

  function aoEntrar() {
    cache = { ...cache, chave: '' };
  }

  return { tela, limpar, aoEntrar, levantar, organizar, nomeArquivo };
})();
