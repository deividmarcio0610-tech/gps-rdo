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
  // "Editar antes de gerar": TST e supervisor entram de segunda a sexta e podem sair num dia
  // em que eles não foram. O ajuste é guardado por dia (AAAA-MM-DD), no aparelho; o dia sem
  // ajuste usa o padrão (os dois ligados, supervisor "Tiago"). Vale para o próximo PDF.
  const AJUSTE_PADRAO = { tst: true, tstNome: '', supervisor: true, nome: 'Tiago' };
  const editar = { dias: {} };
  let painelDia = hoje();

  const ajusteDoDia = (d) => ({ ...AJUSTE_PADRAO, ...(editar.dias[d] || {}) });
  const guardarAjuste = (d, parcial) => { editar.dias[d] = { ...ajusteDoDia(d), ...parcial }; };

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

  /**
   * Dia com mais de um RDO vira um relatório só: as atividades de todos na ordem do número,
   * a equipe de todos (sem repetir pessoa) e o turno de cada um na coluna Equipe.
   */
  function juntarDoDia(rdos, data) {
    const lista = rdos.slice().sort((a, b) => String(a.number).localeCompare(String(b.number), 'pt-BR', { numeric: true }));
    const base = { ...lista[0] };
    const turnos = [...new Set(lista.map((r) => String(r.shift || '').trim()).filter(Boolean))];
    const pessoas = [];
    const vistos = new Set();
    lista.forEach((r) => (r.workforce || []).forEach((w) => {
      const chave = `${String(w?.name || '').trim().toLowerCase()}|${String(w?.role || '').trim().toLowerCase()}`;
      if (vistos.has(chave)) return;
      vistos.add(chave);
      pessoas.push(w);
    }));
    const tudo = (campo) => lista.flatMap((r) => (Array.isArray(r[campo]) ? r[campo] : []));
    const notas = lista.map((r) => String(r.notes || '').trim()).filter(Boolean);
    return {
      ...base,
      date: data || base.date,
      shift: turnos.join(' / '),
      workforce: pessoas,
      tasks: tudo('tasks'),
      occurrences: tudo('occurrences'),
      equipmentList: tudo('equipmentList'),
      stoppages: tudo('stoppages'),
      photos: tudo('photos'),
      notes: notas.join('  |  '),
      number: lista.map((r) => r.number).filter(Boolean).join('+'),
    };
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
      // dia com vários RDOs não repete folha: junta as atividades e a equipe num só relatório
      const paraPdfFinal = modo === 'dia' && rdos.length > 1 ? [juntarDoDia(rdos, dia)] : rdos;
      const ajustados = paraPdfFinal.map((r) => {
        // cada folha usa o ajuste do dia dela (importa no PDF por período)
        const a = ajusteDoDia(r.date);
        return {
          ...r,
          semTstPadrao: !a.tst,
          semSupervisorPadrao: !a.supervisor,
          supervisor: a.supervisor ? (String(r.supervisor || '').trim() || a.nome) : '',
          tst: a.tst ? (String(r.tst || '').trim() || a.tstNome) : '',
        };
      });
      const { doc } = await Pdf.montarVarios(ajustados, { nome, titulo });
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
        <div class="sub">${pronto.quantos} RDO(s) · ${kb(pronto.blob.size)} · PDF pronto</div>
      </div></div>
      <button class="btn primary block" data-act="baixar-pdf">${icon('download', 18)}<span>Baixar PDF para o telefone</span></button>
      <button class="btn block" data-act="email-pdf">${icon('mail', 18)}<span>Enviar por e-mail</span></button>
      <button class="btn block" data-act="zap-pdf" style="background:#25D366;color:#fff">${icon('whatsapp', 18)}<span>Enviar pelo WhatsApp</span></button>
      <p class="dica">E-mail e WhatsApp abrem o compartilhar do aparelho com o PDF anexado. No computador sem compartilhar, o PDF é baixado e você anexa à mão.</p>`;
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

        <div class="card"><div class="body" style="display:grid;gap:8px">
          <div class="name">${icon('text', 16)} Editar antes de gerar</div>
          <div class="field"><label for="e-painel-dia">Dia do ajuste</label>
            <input id="e-painel-dia" type="date" value="${esc(painelDia)}"></div>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px">
            <input type="checkbox" data-op="tst"${ajusteDoDia(painelDia).tst ? ' checked' : ''}> Técnico de Segurança neste dia
          </label>
          <div class="field"><label for="e-tst">Nome do técnico de segurança</label>
            <input id="e-tst" type="text" value="${esc(ajusteDoDia(painelDia).tstNome)}" placeholder="Em branco: usa o nome do RDO"${ajusteDoDia(painelDia).tst ? '' : ' disabled'}></div>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px">
            <input type="checkbox" data-op="supervisor"${ajusteDoDia(painelDia).supervisor ? ' checked' : ''}> Supervisor neste dia
          </label>
          <div class="field"><label for="e-supervisor">Nome do supervisor</label>
            <input id="e-supervisor" type="text" value="${esc(ajusteDoDia(painelDia).nome)}"${ajusteDoDia(painelDia).supervisor ? '' : ' disabled'}></div>
          <p class="dica">Escolha o dia e deixe marcado só o que teve naquele dia. O ajuste fica guardado por dia.</p>
        </div></div>

        <button class="btn primary block" data-act="gerar"${cache.lista.length && !gerando ? '' : ' disabled'}>
          ${icon('output', 18)}<span>${gerando ? 'Preparando...' : 'Gerar RDO'}</span></button>
        ${gerando ? `<p class="dica">${esc(avisoGerar || 'Preparando o arquivo...')}</p>` : ''}
        <p class="dica">Dia com mais de um RDO vira um relatório só, com as atividades e o turno de cada um.</p>
        ${prontoHtml()}`,
      bind(root) {
        root.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
          modo = b.dataset.modo;
          // o painel de ajuste começa no dia escolhido (ou no primeiro do período)
          painelDia = modo === 'dia' ? dia : (painelDia >= de && painelDia <= ate ? painelDia : de);
          pronto = null;
          app.render();
        }));
        root.querySelector('#e-dia')?.addEventListener('change', (e) => {
          if (!e.target.value) return;
          dia = e.target.value;
          painelDia = dia;
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

        root.querySelector('#e-painel-dia')?.addEventListener('change', (e) => {
          if (!e.target.value) return;
          painelDia = e.target.value;
          pronto = null;
          app.render();
        });
        root.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('change', () => {
          guardarAjuste(painelDia, { [b.dataset.op]: b.checked });
          pronto = null;
          app.render();
        }));
        root.querySelector('#e-tst')?.addEventListener('change', (e) => {
          guardarAjuste(painelDia, { tstNome: String(e.target.value || '').trim() });
          pronto = null;
          app.render();
        });
        root.querySelector('#e-supervisor')?.addEventListener('change', (e) => {
          guardarAjuste(painelDia, { nome: String(e.target.value || '').trim() || 'Tiago' });
          pronto = null;
          app.render();
        });

        root.querySelector('[data-act="gerar"]')?.addEventListener('click', () => gerar(app));

        const tituloPdf = modo === 'dia' ? `RDO ${fmtDate(dia)}` : `RDOs de ${fmtDate(de)} a ${fmtDate(ate)}`;

        root.querySelector('[data-act="baixar-pdf"]')?.addEventListener('click', async (ev) => {
          if (!pronto) return;
          const btn = ev.currentTarget;
          btn.disabled = true;
          try {
            const nativo = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins : null;
            if (nativo?.Filesystem) {
              try {
                await nativo.Filesystem.writeFile({
                  path: pronto.nome,
                  data: await UI.blobParaBase64(pronto.blob),
                  directory: 'DOCUMENTS',
                });
                toast(`PDF salvo em Documentos: ${pronto.nome}`);
                return;
              } catch {
                // sem acesso a Documentos: cai no compartilhar para salvar
              }
            }
            if (nativo?.Share) {
              const res = await UI.entregarArquivo(pronto.blob, pronto.nome, 'Salvar o PDF no telefone');
              if (res === 'compartilhado') toast('Escolha onde salvar o PDF.');
              return;
            }
            UI.baixar(pronto.blob, pronto.nome);
            toast('PDF baixado. No iPhone, use Compartilhar > Salvar em Arquivos.');
          } catch {
            toast('Não foi possível salvar o PDF.');
          } finally {
            btn.disabled = false;
          }
        });

        // O PDF já está montado: o compartilhar abre dentro do toque e leva o arquivo anexado.
        const compartilharPdf = async (titulo) => {
          if (!pronto) return;
          const res = await UI.entregarArquivo(pronto.blob, pronto.nome, titulo).catch(() => 'erro');
          if (res === 'compartilhado') return 'compartilhado';
          if (res === 'baixado') return 'baixado';
          if (res === 'erro') toast('Não foi possível abrir o compartilhar.');
          return res;
        };

        root.querySelector('[data-act="email-pdf"]')?.addEventListener('click', async () => {
          if (!pronto) return;
          const res = await compartilharPdf('Enviar por e-mail');
          if (res === 'compartilhado') {
            toast('Escolha o aplicativo de e-mail: o PDF vai anexado.');
            return;
          }
          if (res === 'baixado') {
            const assunto = encodeURIComponent(`${tituloPdf} - ${pronto.nome}`);
            const corpo = encodeURIComponent(`Segue o ${tituloPdf} em PDF (${pronto.quantos} RDO(s)).\nO arquivo ${pronto.nome} foi baixado neste aparelho; anexe-o ao e-mail.`);
            window.location.href = `mailto:?subject=${assunto}&body=${corpo}`;
            toast('PDF baixado. Anexe o arquivo no e-mail: este navegador não anexa sozinho.');
          }
        });

        root.querySelector('[data-act="zap-pdf"]')?.addEventListener('click', async () => {
          if (!pronto) return;
          const res = await compartilharPdf('Enviar pelo WhatsApp');
          if (res === 'compartilhado') toast('Escolha o WhatsApp: o PDF vai anexado.');
          if (res === 'baixado') toast('PDF baixado. Este navegador não anexa sozinho: anexe o arquivo na conversa do WhatsApp.');
        });
      },
    };
  }

  return { tela };
})();
