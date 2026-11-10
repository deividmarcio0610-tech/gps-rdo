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
  // (O bloqueio do dia saiu deste painel em 10/11/2026: é lançado em Etapas do Dia, dentro
  // do RDO, e o desconto na execução é calculado sozinho em Store.contaDoBloqueio.)
  const AJUSTE_PADRAO = { tst: true, tstNome: '', supervisor: true, nome: 'Tiago' };
  /*
   * Pedido de 10/11/2026: o técnico de segurança é posto pelo supervisor e vai fixo, como o
   * supervisor; no dia em que não foi, tira-se escolhendo o dia. Por isso os NOMES valem para
   * todo dia até serem trocados (`fixos`) e só o "teve / não teve" é por dia (`dias`). Os dois
   * ficam guardados no aparelho, por conta: antes sumiam ao fechar o app e o nome do técnico
   * tinha de ser digitado de novo a cada dia.
   */
  const editar = { fixos: {}, dias: {} };
  const CHAVE_AJUSTE = 'gps_rdo_ajuste_mestre_v1';
  const chaveAjuste = () => `${CHAVE_AJUSTE}:${window.Conta?.usuario?.()?.id || ''}`;
  let ajusteDe = null;   // de qual conta são os ajustes que estão na memória
  function ajustes() {
    const chave = chaveAjuste();
    if (ajusteDe !== chave) {
      ajusteDe = chave;
      let guardado = {};
      try { guardado = JSON.parse(localStorage.getItem(chave) || '{}') || {}; } catch { guardado = {}; }
      editar.fixos = { ...(guardado.fixos || {}) };
      editar.dias = { ...(guardado.dias || {}) };
    }
    return editar;
  }
  const gravarAjustes = () => {
    try { localStorage.setItem(chaveAjuste(), JSON.stringify({ fixos: editar.fixos, dias: editar.dias })); } catch { /* sem espaço: vale só nesta abertura */ }
  };
  let painelDia = hoje();

  const ajusteDoDia = (d) => {
    const e = ajustes();
    const doDia = e.dias[d] || {};
    return { ...AJUSTE_PADRAO, ...e.fixos, tst: doDia.tst !== false, supervisor: doDia.supervisor !== false };
  };
  /** "Teve / não teve" de um dia. Dia que volta ao normal (os dois ligados) sai da lista. */
  const guardarDia = (d, parcial) => {
    const e = ajustes();
    const novo = { ...(e.dias[d] || {}), ...parcial };
    if (novo.tst !== false && novo.supervisor !== false) delete e.dias[d];
    else e.dias[d] = { tst: novo.tst !== false, supervisor: novo.supervisor !== false };
    gravarAjustes();
  };
  /** Nome que vale para todo dia (supervisor ou técnico de segurança). */
  const guardarFixo = (parcial) => {
    const e = ajustes();
    e.fixos = { ...e.fixos, ...parcial };
    gravarAjustes();
  };

  const intervalo = () => (modo === 'dia' ? { de: dia, ate: dia } : { de, ate });
  const chaveDe = () => {
    const { de: a, ate: b } = intervalo();
    return `${a}|${b}`;
  };

  /**
   * Busca os RDOs do intervalo no banco. A lista é relida quando o intervalo muda, quando o
   * supervisor entra na tela (`aoEntrar`), no botão Atualizar e antes de gerar o PDF. Antes
   * só relia ao mudar a data: RDO que chegasse depois, ou a correção que ele mesmo acabara
   * de fazer, não entrava no PDF.
   */
  async function carregar(app, { quieto = false } = {}) {
    const chave = chaveDe();
    if (cache.chave === chave || carregando) return;
    carregando = true;
    erro = '';
    const { de: a, ate: b } = intervalo();
    try {
      const lista = await Nuvem.todos(a, b);
      cache = { chave, lista, doServidor: lista.doServidor !== false, em: Date.now() };
    } catch (e) {
      erro = e.message;
      cache = { chave, lista: [], doServidor: false, em: 0 };
    }
    carregando = false;
    if (!quieto) app?.render?.();
  }

  /** O supervisor chegou na tela: a lista do banco é relida (não a cada redesenho da tela). */
  function aoEntrar(tela) {
    if (tela === 'equipe' && !carregando) cache = { ...cache, chave: '' };
    if (tela === 'controle' && !carregandoCtl) ctl = { ...ctl, chave: '' };
  }

  /** Sai da conta: lista, PDF montado e ajustes do dia não ficam para quem entrar depois. */
  function limpar() {
    cache = { chave: '', lista: [] };
    ctl = { chave: '', usuarios: [], rdos: [] };
    pronto = null;
    erro = '';
    erroCtl = '';
    // só a memória: os ajustes guardados no aparelho são da conta e voltam quando ela entrar
    editar.fixos = {};
    editar.dias = {};
    ajusteDe = null;
  }

  /**
   * RDO do banco pronto para o PDF: o JSON mais as fotos baixadas na hora. Cada imagem vai
   * para a foto da posição dela; a lista de fotos do RDO é quem manda (imagem a mais no
   * banco não entra, foto sem imagem aparece como indisponível, com a legenda certa).
   */
  async function paraPdf(registro) {
    const rdo = { stoppages: [], ...registro.json };
    const metas = Array.isArray(rdo.photos) ? rdo.photos : [];
    if (!metas.length) return rdo;
    const imagens = await Nuvem.fotosDe(registro.docId);
    rdo.photos = metas.map((meta, i) => {
      const foto = { ...meta };
      // o id guardado é do aparelho de quem tirou a foto: aqui só vale a imagem que veio do banco
      delete foto.foto;
      delete foto.data;
      if (imagens[i]) foto.data = imagens[i];
      return foto;
    });
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
    // Bloqueio (lançado em Etapas do Dia, dentro de cada RDO): a folha tem uma linha 9 só.
    // Vale o do primeiro RDO que tiver, JUNTO com as etapas desse mesmo RDO, para a conta
    // do desconto bater com as horas de quem lançou. Bloqueio de outro RDO do dia não some:
    // entra como frase nas observações.
    const comBloqueio = lista.filter((r) => Store.bloqueioDoRdo(r));
    const dono = comBloqueio[0] || null;
    const contaDoDono = dono ? Store.bloqueioDoRdo(dono) : null;
    comBloqueio.slice(1).forEach((r) => {
      const conta = Store.bloqueioDoRdo(r);
      // a mesma parada lançada por duas equipes é uma parada só: não entra de novo
      if (conta.inicio === contaDoDono.inicio && conta.fim === contaDoDono.fim) return;
      notas.push(`RDO ${r.number}: ${Store.fraseDoBloqueio(conta)}`);
    });
    return {
      ...base,
      date: data || base.date,
      shift: turnos.join(' / '),
      etapas: (dono || base).etapas,
      bloqueio: dono ? dono.bloqueio : null,
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
    if (!cache.lista.length) { toast('Nenhum RDO neste intervalo.'); return; }
    gerando = true;
    avisoGerar = 'Conferindo o banco...';
    app?.render?.();
    try {
      // O PDF sai do que está no banco AGORA: primeiro sobe a correção que acabou de ser feita
      // neste aparelho, depois relê a lista. Antes saía da lista lida ao abrir a tela.
      if (navigator.onLine !== false) {
        await window.Conta?.sincronizar?.({ silencioso: true, completo: false }).catch(() => {});
        cache = { ...cache, chave: '' };
        await carregar(app, { quieto: true });
        if (erro) throw new Error(erro);
      }
      const lista = cache.lista.slice();
      if (!lista.length) throw new Error('Nenhum RDO neste intervalo.');
      const rdos = [];
      for (let i = 0; i < lista.length; i += 1) {
        avisoGerar = `Baixando as fotos do RDO ${lista[i].json.number} (${i + 1} de ${lista.length})...`;
        app?.render?.();
        try {
          rdos.push(await paraPdf(lista[i]));
        } catch {
          // PDF final sem as fotos de um RDO, sem avisar, é pior do que não gerar
          throw new Error(`Não foi possível baixar as fotos do RDO ${lista[i].json.number}. Tente de novo com sinal melhor.`);
        }
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
        // O bloqueio vem de dentro do RDO (Etapas do Dia). A linha 9, o desconto no fim da
        // execução e a frase da observação são feitos pelo PDF, uma vez só (js/pdf.js).
        return {
          ...r,
          semTstPadrao: !a.tst,
          semSupervisorPadrao: !a.supervisor,
          supervisor: a.supervisor ? (String(r.supervisor || '').trim() || a.nome) : '',
          // o nome do painel vence: o técnico é posto pelo supervisor, e RDO antigo pode ter um
          // nome digitado no cabeçalho (campo que não existe mais) sem ter onde corrigir
          tst: a.tst ? (a.tstNome || String(r.tst || '').trim()) : '',
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
        <button class="btn ghost" data-act="atualizar-lista" style="font-size:12.5px"${carregando ? ' disabled' : ''}>${icon('refresh', 15)}Atualizar a lista</button>
        ${cache.doServidor === false && !carregando && !erro
          ? '<div class="aviso erro">Sem sinal: esta é a última lista que o aparelho guardou e pode estar desatualizada.</div>' : ''}
        <div id="lista-equipe">${listaHtml()}</div>

        <div class="card"><div class="body" style="display:grid;gap:8px">
          <div class="name">${icon('text', 16)} Editar antes de gerar</div>
          <div class="field"><label for="e-painel-dia">Dia do ajuste</label>
            <input id="e-painel-dia" type="date" value="${esc(painelDia)}"></div>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px">
            <input type="checkbox" data-op="tst"${ajusteDoDia(painelDia).tst ? ' checked' : ''}> Técnico de Segurança neste dia
          </label>
          <div class="field"><label for="e-tst">Nome do técnico de segurança</label>
            <input id="e-tst" type="text" value="${esc(ajusteDoDia(painelDia).tstNome)}" placeholder="Fica guardado para os próximos dias"${ajusteDoDia(painelDia).tst ? '' : ' disabled'}></div>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px">
            <input type="checkbox" data-op="supervisor"${ajusteDoDia(painelDia).supervisor ? ' checked' : ''}> Supervisor neste dia
          </label>
          <div class="field"><label for="e-supervisor">Nome do supervisor</label>
            <input id="e-supervisor" type="text" value="${esc(ajusteDoDia(painelDia).nome)}"${ajusteDoDia(painelDia).supervisor ? '' : ' disabled'}></div>
          <p class="dica">O técnico de segurança e o supervisor já entram sozinhos no RDO Final, de segunda a sexta, com os nomes acima (os nomes ficam guardados).
            No dia em que um deles não foi, escolha o dia e desmarque: vale só para aquele dia.
            O bloqueio agora é lançado em <strong>Etapas do Dia</strong>, dentro do RDO (toque no RDO na lista acima): o tempo parado sai sozinho do fim da execução.</p>
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

        root.querySelector('[data-act="atualizar-lista"]')?.addEventListener('click', () => {
          cache = { ...cache, chave: '' };
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
          guardarDia(painelDia, { [b.dataset.op]: b.checked });
          pronto = null;
          app.render();
        }));
        root.querySelector('#e-tst')?.addEventListener('change', (e) => {
          guardarFixo({ tstNome: String(e.target.value || '').trim() });
          pronto = null;
          app.render();
        });
        root.querySelector('#e-supervisor')?.addEventListener('change', (e) => {
          guardarFixo({ nome: String(e.target.value || '').trim() || 'Tiago' });
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

  // ------------------------------------------------------------ controle do dia
  // Pedido de 09/11/2026: quem fez o RDO no dia escolhido (verde) e quem não fez (vermelho).
  // Abre numa aba própria, como o Gerar Relatório. A lista vem das contas cadastradas.
  const diaDaUrl = new URLSearchParams(location.search).get('dia');
  let diaCtl = /^\d{4}-\d{2}-\d{2}$/.test(String(diaDaUrl || '')) ? diaDaUrl : hoje();
  let ctl = { chave: '', usuarios: [], rdos: [] };
  let carregandoCtl = false;
  let erroCtl = '';

  async function carregarControle(app) {
    const chave = diaCtl;
    if (ctl.chave === chave || carregandoCtl) return;
    carregandoCtl = true;
    erroCtl = '';
    try {
      // aba nova: a sessão guardada demora um instante para voltar do banco
      await Nuvem.sessaoPronta();
      const [usuarios, rdos] = await Promise.all([Nuvem.usuarios(), Nuvem.todos(chave, chave)]);
      ctl = { chave, usuarios, rdos };
    } catch (e) {
      erroCtl = e.message;
      ctl = { chave, usuarios: [], rdos: [] };
    }
    carregandoCtl = false;
    app?.render?.();
  }

  /**
   * O RDO tem alguma coisa lançada? RDO em branco não conta como feito: entrar numa seção
   * (e, até a v28, só abrir o app) já cria um RDO vazio com a data do dia, que sobe para o
   * banco e deixava a pessoa verde sem ela ter preenchido nada.
   */
  function temConteudo(j) {
    if (!j) return false;
    if (['workforce', 'equipmentList', 'tasks', 'occurrences', 'photos', 'stoppages'].some((k) => Array.isArray(j[k]) && j[k].length)) return true;
    // etapa igual ao horário fixo do modelo não conta: a tela já abre com ele, e só tocar em
    // Salvar Etapas não é preencher o RDO
    if ((Array.isArray(j.etapas) ? j.etapas : []).some((e, i) => e && (e.inicio || e.fim)
      && (e.inicio !== Store.HORAS_MODELO[i]?.[0] || e.fim !== Store.HORAS_MODELO[i]?.[1]))) return true;
    if (j.bloqueio && (j.bloqueio.inicio || j.bloqueio.fim)) return true;
    return ['location', 'notes', 'supervisor', 'tst', 'maintenanceType', 'shift', 'weather', 'startTime', 'endTime', 'cliente', 'complexo', 'gerencia', 'equipeCoord']
      .some((k) => String(j[k] || '').trim());
  }

  /** Cada conta (sem a do supervisor) com os RDOs dela no dia; quem mandou e saiu da lista também aparece. */
  function situacao() {
    const porDono = new Map();
    ctl.rdos.forEach((r) => {
      if (!porDono.has(r.dono)) porDono.set(r.dono, []);
      porDono.get(r.dono).push(r);
    });
    const comRdos = (u, rdos) => ({ ...u, rdos, preenchidos: rdos.filter((r) => temConteudo(r.json)) });
    const pessoas = ctl.usuarios.filter((u) => !u.mestre).map((u) => comRdos(u, porDono.get(u.id) || []));
    const conhecidos = new Set(ctl.usuarios.map((u) => u.id));
    porDono.forEach((rdos, dono) => {
      if (conhecidos.has(dono)) return;
      pessoas.push(comRdos({ id: dono, nome: rdos[0].nome || rdos[0].email || 'sem nome', email: rdos[0].email || '', funcao: '' }, rdos));
    });
    const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
    return {
      fez: pessoas.filter((p) => p.preenchidos.length).sort(porNome),
      naoFez: pessoas.filter((p) => !p.preenchidos.length).sort(porNome),
    };
  }

  function pessoaHtml(p, fez) {
    const sub = [p.funcao, p.email].filter(Boolean).map(esc).join(' · ')
      + (!fez && p.rdos.length ? `${p.funcao || p.email ? ' · ' : ''}só RDO em branco no dia` : '');
    const rdos = p.rdos.map((r) => `
      <button class="btn ghost" data-abrir-ctl="${esc(r.docId)}" style="padding:4px 10px;font-size:12px">
        RDO ${esc(r.json.number)}${r.json.status === 'final' ? ' · finalizado' : ''}</button>`).join('');
    return `
      <div class="card ctl-pessoa" data-situacao="${fez ? 'fez' : 'nao-fez'}"
        style="border-left:5px solid var(${fez ? '--green' : '--red'});background:var(${fez ? '--green-soft' : '--red-soft'})">
        <div class="body">
          <div class="name" style="display:flex;justify-content:space-between;gap:8px;align-items:center">
            <span>${esc(p.nome)}</span>
            <span class="badge ${fez ? 'green' : 'red'}">${fez ? 'Fez' : 'Não fez'}</span>
          </div>
          ${sub ? `<div class="sub">${sub}</div>` : ''}
          ${rdos ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${rdos}</div>` : ''}
        </div>
      </div>`;
  }

  function controle(app) {
    carregarControle(app);
    let corpo;
    if (carregandoCtl || ctl.chave !== diaCtl) corpo = '<div class="empty">Buscando as contas e os RDOs no banco...</div>';
    else if (erroCtl) corpo = `<div class="aviso erro">${esc(erroCtl)}</div>`;
    else {
      const { fez, naoFez } = situacao();
      corpo = !fez.length && !naoFez.length
        ? '<div class="empty">Nenhuma conta de funcionário cadastrada.</div>'
        : `
          <div style="display:flex;gap:8px">
            <span class="badge green" id="ctl-fez">${fez.length} fizeram</span>
            <span class="badge red" id="ctl-nao-fez">${naoFez.length} não fizeram</span>
          </div>
          <div class="section-label">Não fizeram · ${naoFez.length}</div>
          <div class="lista-cartoes">${naoFez.map((p) => pessoaHtml(p, false)).join('') || '<div class="empty">Todos fizeram.</div>'}</div>
          <div class="section-label">Fizeram · ${fez.length}</div>
          <div class="lista-cartoes">${fez.map((p) => pessoaHtml(p, true)).join('') || '<div class="empty">Ninguém mandou RDO neste dia.</div>'}</div>`;
    }
    return {
      titulo: 'Controle de RDO',
      html: `
        <div class="field"><label for="ctl-dia">Dia</label>
          <input id="ctl-dia" type="date" value="${esc(diaCtl)}"></div>
        <button class="btn ghost" data-act="ctl-atualizar" style="font-size:12.5px">Atualizar</button>
        <div class="section-label">${fmtDate(diaCtl)}</div>
        ${corpo}
        <p class="dica">Verde: a pessoa tem RDO preenchido com a data escolhida no banco. Vermelho: não tem, ou só tem RDO em branco. RDO feito sem internet só conta depois que subir.</p>`,
      bind(root) {
        root.querySelector('#ctl-dia')?.addEventListener('change', (e) => {
          if (!e.target.value) return;
          diaCtl = e.target.value;
          app.render();
        });
        root.querySelector('[data-act="ctl-atualizar"]')?.addEventListener('click', () => {
          ctl = { chave: '', usuarios: [], rdos: [] };
          app.render();
        });
        root.querySelectorAll('[data-abrir-ctl]').forEach((b) => b.addEventListener('click', async () => {
          const item = ctl.rdos.find((x) => x.docId === b.dataset.abrirCtl);
          if (!item) return;
          b.disabled = true;
          try {
            const id = await Conta.abrirDoBanco(item);
            if (id) app.abrir(id);
            else toast('Não foi possível abrir este RDO.');
          } catch (e) { toast(e.message); }
          b.disabled = false;
        }));
      },
    };
  }

  return { tela, controle, aoEntrar, limpar, juntarDoDia, ajusteDoDia, guardarDia, guardarFixo, temConteudo };
})();
