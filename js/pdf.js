/* PDF A4 no formulário "RDO ADM" do cliente (modelo de 09/11/2026): jsPDF + autotable. */
window.Pdf = (() => {
  'use strict';

  const ORANGE = [255, 87, 34];
  const GRAY = [243, 243, 243];

  // formulário "RDO ADM": laranja do cliente, linhas pretas finas, texto preto
  const LARANJA = [228, 108, 10];
  const CINZA = [242, 242, 242];
  const TINTA = [25, 25, 25];
  const PAD = 1.6;
  // larguras das colunas B..M do formulário, na escala A4 (190 mm de área útil)
  const COLUNAS = [6.66, 16.02, 21.19, 16.43, 14.8, 23.63, 11, 19.56, 14.8, 12.77, 16.57, 16.57];

  const fmtDate = (iso) => {
    const [a, m, d] = String(iso || '').slice(0, 10).split('-');
    return a ? `${d}/${m}/${a}` : '—';
  };

  /** Faixa laranja do topo com o título e a logo In-Haus (resumo do mês). */
  function faixa(doc, titulo, margem) {
    const larg = doc.internal.pageSize.getWidth();
    doc.setFillColor(...ORANGE);
    doc.rect(0, 0, larg, 25, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(titulo, larg / 2, 15.5, { align: 'center' });
    doc.setFontSize(8.5);
    doc.text(String(window.Store.config.companyName || '').toUpperCase(), larg / 2, 21, { align: 'center' });
    // logo In-Haus: a faixa é laranja e a logo também, então ela vai sobre um quadro branco
    if (window.Logo) {
      const caixaL = 30;
      const caixaA = 17;
      const x0 = larg - margem - caixaL;
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x0, 4, caixaL, caixaA, 1.5, 1.5, 'F');
      const altLogo = 13;
      const largLogo = altLogo * (window.Logo.largura / window.Logo.altura);
      doc.addImage(window.Logo.src, 'PNG', x0 + (caixaL - largLogo) / 2, 4 + (caixaA - altLogo) / 2, largLogo, altLogo);
    }
  }

  /** Rodapé em todas as páginas, com "página n de N" quando há mais de uma. */
  function rodape(doc, partes) {
    const larg = doc.internal.pageSize.getWidth();
    const alt = doc.internal.pageSize.getHeight();
    const paginas = doc.getNumberOfPages();
    for (let n = 1; n <= paginas; n += 1) {
      doc.setPage(n);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(140, 140, 140);
      doc.text([...partes, paginas > 1 && `página ${n} de ${paginas}`].filter(Boolean).join(' · '), larg / 2, alt - 8, { align: 'center' });
    }
  }

  // ---------------------------------------------------------------- formulário RDO ADM
  // Geometria da aba "RDO ADM" do modelo do cliente, na escala A4 (impressão a 66%):
  // colunas B..M e as 54 linhas, em mm. Cada folha do PDF é uma página do modelo.
  const LETRAS = 'BCDEFGHIJKLM';
  const XS = COLUNAS.reduce((a, w) => { a.push(a[a.length - 1] + w); return a; }, [10]);
  const ALTURAS = [
    8.72, 3.52, 6.21, 6.21, 10.57, 3.52, 3.52, // 1-7: cabeçalho
    ...Array(8).fill(4.19), 4.03, // 8-15: etapas, 16: observações/desvios
    ...Array(24).fill(5.58), // 17-40: quatro blocos de OM com seis linhas
    10.07, ...Array(8).fill(4.70), // 41: observações, 42-49: equipe
    5.03, 5.37, 5.70, 2.90, 4.53, // 50-54: supervisor, assinatura, faixa, rodapé
  ];
  const TOPO = 5;
  const YS = ALTURAS.reduce((a, h) => { a.push(a[a.length - 1] + h); return a; }, [TOPO]);
  const FINA = 0.15;
  const GROSSA = 0.5;
  const BRANCO = [255, 255, 255];
  /** Retângulo das colunas a..b nas linhas r1..r2 (como uma mescla do Excel). */
  const area = (a, b, r1, r2 = r1) => {
    const i = LETRAS.indexOf(a);
    const j = LETRAS.indexOf(b) + 1;
    return [XS[i], YS[r1 - 1], XS[j] - XS[i], YS[r2] - YS[r1 - 1]];
  };

  // Dados fixos impressos no modelo do cliente.
  const CONTRATO = '5900133256';
  const EMPRESA_RODAPE = 'IN-HAUS INDUSTRIAL  SERVIÇOS E LOGISTICA        CNPJ:  05.208.211/0008-04';
  const PREFIXO_OM = 'Nº OM / TÍTULO / LOCAL / DESCRIÇÃO DETALHADA : ';
  // horários da grade do modelo; valem quando a etapa não tem horário no RDO
  const HORAS_MODELO = window.Store?.HORAS_MODELO || [
    ['07:45', '08:00'], ['08:00', '08:05'], ['08:05', '08:15'], ['08:15', '09:25'],
    ['09:25', '09:27'], ['09:27', '09:30'], ['09:30', '15:30'], ['11:00', '12:00'],
  ];
  const OM_POR_FOLHA = 4;
  const PESSOAS_POR_FOLHA = 7;
  const LINHAS_NOTA_OM = 4;

  /**
   * Rodapé de controle em todas as páginas, abaixo da folha: de qual RDO é a página e
   * "página n de N". O texto da empresa e o CNPJ ficam na própria folha (linha 54).
   */
  function rodapeFormulario(doc, paginas) {
    const larg = doc.internal.pageSize.getWidth();
    const alt = doc.internal.pageSize.getHeight();
    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p += 1) {
      doc.setPage(p);
      const info = paginas.find((x) => p >= x.de && p <= x.ate);
      const linha = [info?.rdo?.number && `RDO ${info.rdo.number}`, info?.rdo?.date && fmtDate(info.rdo.date), total > 1 && `página ${p} de ${total}`]
        .filter(Boolean).join(' · ');
      if (!linha) continue;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6);
      doc.setTextColor(110, 110, 110);
      doc.text(linha, larg - 10, alt - 3, { align: 'right' });
    }
  }

  /** Documento A4 vazio (um RDO por PDF, ou vários RDOs no mesmo arquivo). */
  function novoDoc() {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  }

  /**
   * Célula do formulário: quadro com borda (opcional), fundo opcional e texto. O texto que
   * não cabe diminui a fonte até o mínimo e, se ainda assim não couber, é cortado com "…".
   * Devolve true quando cortou: quem chama manda o texto inteiro para a continuação.
   */
  function celula(doc, x, y, w, h, texto, o = {}) {
    if (o.fill) {
      doc.setFillColor(...o.fill);
      doc.rect(x, y, w, h, 'F');
    }
    if (o.borda !== false) {
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(FINA);
      doc.rect(x, y, w, h, 'S');
    }
    const txt = texto == null ? '' : String(texto).replace(/\r/g, '').trim();
    if (!txt) return false;
    const pad = o.pad ?? 0.9;
    const largura = Math.max(2, w - pad * 2);
    const cor = o.color || TINTA;
    doc.setFont(o.font || 'helvetica', o.bold ? 'bold' : 'normal');
    doc.setTextColor(...cor);
    // texto enorme nunca cabe: mede só o começo (o resto vai inteiro para a continuação)
    const amostra = txt.length > 6000 ? txt.slice(0, 6000) : txt;
    let size = o.size || 7;
    const minimo = Math.min(size, o.min || 5);
    let linhas;
    let lh;
    let cabem;
    for (;;) {
      doc.setFontSize(size);
      linhas = doc.splitTextToSize(amostra, largura);
      lh = size * 0.3528 * 1.12;
      cabem = Math.max(1, Math.floor((h - 0.3) / lh));
      if (linhas.length <= cabem || size - 0.25 < minimo) break;
      size -= 0.25;
    }
    let cortado = amostra !== txt;
    if (linhas.length > cabem || cortado) {
      cortado = true;
      linhas = linhas.slice(0, cabem);
      let ultima = linhas[linhas.length - 1] || '';
      while (ultima && doc.getTextWidth(`${ultima}…`) > largura) ultima = ultima.slice(0, -1);
      linhas[linhas.length - 1] = `${ultima.trimEnd()}…`;
    }
    const asc = size * 0.3528;
    const base = o.valign === 'top'
      ? y + pad * 0.5 + asc * 0.85
      : y + h / 2 - ((linhas.length - 1) * lh) / 2 + asc * 0.33;
    const align = o.align || 'left';
    const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w - pad : x + pad;
    linhas.forEach((l, i) => {
      const by = base + i * lh;
      doc.text(l, tx, by, { align });
      if (o.underline) {
        const lw = doc.getTextWidth(l);
        const x0 = align === 'center' ? tx - lw / 2 : align === 'right' ? tx - lw : tx;
        doc.setDrawColor(...cor);
        doc.setLineWidth(0.12);
        doc.line(x0, by + 0.45, x0 + lw, by + 0.45);
      }
    });
    return cortado;
  }

  /** Imagem (dataURL) dentro de um quadro, sem distorcer. false se não deu para desenhar. */
  function imagemNoQuadro(doc, src, x, y, w, h) {
    if (!src) return false;
    try {
      const props = doc.getImageProperties(src);
      const escala = Math.min(w / props.width, h / props.height);
      const iw = props.width * escala;
      const ih = props.height * escala;
      doc.addImage(src, props.fileType || 'PNG', x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
      return true;
    } catch {
      return false;
    }
  }

  /** Segunda a sexta, contando pelo dia do RDO (data local, sem fuso). */
  function diaUtil(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return false;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
    return d >= 1 && d <= 5;
  }

  /**
   * Padrões de segunda a sexta (pedido de 09/11/2026): o técnico de segurança aparece na
   * equipe e o supervisor vem preenchido com Tiago. O aparelho que gera o PDF pode desligar
   * cada um (`semTstPadrao` / `semSupervisorPadrao`), para os dias em que eles não foram.
   */
  const TST_PADRAO = { name: '', role: 'Técnico de Segurança', equipe: '' };
  function comPadroesDoDia(rdo) {
    const x = { ...rdo };
    if (!diaUtil(x.date)) return x;
    if (!x.semSupervisorPadrao && !String(x.supervisor || '').trim()) x.supervisor = 'Tiago';
    const equipe = Array.isArray(x.workforce) ? x.workforce.slice() : [];
    const temTst = equipe.some((w) => /seguran/i.test(String(w?.role || '')));
    // nome digitado no cabeçalho do RDO ou no painel do dia (pedido de 09/11/2026)
    if (!x.semTstPadrao && !temTst) equipe.push({ ...TST_PADRAO, name: String(x.tst || '').trim() });
    x.workforce = equipe;
    return x;
  }

  /** "STATUS OM" do modelo, com o x na situação que o progresso da tarefa indica. */
  function statusOm(t) {
    const preenchido = t && t.progress != null && t.progress !== '';
    const p = Number(t?.progress);
    const m = (v) => (v ? ' x' : '   ');
    return `STATUS OM: CONCLUIDO (${m(preenchido && p >= 100)}) EM ANDAMENTO (${m(preenchido && p > 0 && p < 100)}) NÃO EXECUTADO (${m(preenchido && p === 0)}) `;
  }

  /** Partes do campo OBSERVAÇÕES: nota do dia, local/turno, ocorrências, equipamentos e paradas. */
  function partesObservacoes(rdo) {
    const partes = [];
    // o turno vai na coluna Equipe dos funcionários; aqui fica só o local
    if (rdo.location) partes.push(['Local', rdo.location]);
    if (String(rdo.notes || '').trim()) partes.push(['Observações', String(rdo.notes).trim()]);
    (rdo.occurrences || []).forEach((o, i) => {
      const texto = [[o.time, o.type].filter(Boolean).join(' '), o.description, o.location].filter(Boolean).join(' — ');
      if (texto) partes.push([`Ocorrência ${i + 1}`, texto]);
    });
    (rdo.equipmentList || []).forEach((e, i) => {
      const horas = [e.hoursStart, e.hoursEnd].some((v) => v != null && v !== '')
        ? `horímetro ${[e.hoursStart, e.hoursEnd].map((v) => (v == null || v === '' ? '?' : `${v}h`)).join(' a ')}` : '';
      const texto = [e.name, e.code, e.status, horas].filter(Boolean).join(' — ');
      if (texto) partes.push([`Equipamento ${i + 1}`, texto]);
    });
    const paradas = rdo.stoppages || [];
    paradas.forEach((p, i) => {
      const dur = Store.fmtHoras(Store.minutosParada(p));
      const texto = [p.reason, [p.start, p.end].filter(Boolean).join(' a '), dur, p.note].filter(Boolean).join(' — ');
      if (texto) partes.push([`Parada ${i + 1}`, texto]);
    });
    if (paradas.length) partes.push(['Total parado', Store.fmtHoras(paradas.reduce((s, p) => s + (Store.minutosParada(p) || 0), 0))]);
    return partes;
  }

  /**
   * Geometria da folha. O RDO final (com bloqueio) ganha uma linha 9 na tabela de
   * execução: as 8 linhas de etapa encolhem um pouco e tudo o que vem abaixo fica
   * exatamente na mesma altura. Sem bloqueio, é a folha antiga, de 54 linhas.
   */
  function geometria(comBloqueio) {
    if (!comBloqueio) return { alturas: ALTURAS, ys: YS, linha: (n) => n };
    const corte = 4.19 / 8;
    const alturas = ALTURAS.slice();
    for (let i = 7; i < 15; i += 1) alturas[i] -= corte;
    alturas.splice(15, 0, 4.19);
    const ys = alturas.reduce((a, h) => { a.push(a[a.length - 1] + h); return a; }, [TOPO]);
    return { alturas, ys, linha: (n) => (n >= 16 ? n + 1 : n) };
  }

  /** Uma folha do RDO ADM na página atual. `k` é a folha (0 = primeira). */
  function folha(doc, rdo, k, nFolhas, resto) {
    const comBloqueio = Boolean(rdo.bloqueio && (rdo.bloqueio.inicio || rdo.bloqueio.fim));
    const { alturas, ys, linha } = geometria(comBloqueio);
    const areaAqui = (a, b, r1, r2 = r1) => {
      const i = LETRAS.indexOf(a);
      const j = LETRAS.indexOf(b) + 1;
      return [XS[i], ys[r1 - 1], XS[j] - XS[i], ys[r2] - ys[r1 - 1]];
    };
    const c = (a, b, r1, r2, texto, o) => celula(doc, ...areaAqui(a, b, r1, r2), texto, o);
    // texto cortado na folha: guarda o inteiro para a continuação (uma vez só)
    const guarda = (cortado, campo, texto) => {
      if (cortado && !resto.some((x) => x[0] === campo)) resto.push([campo, String(texto)]);
    };
    const rotulo = { font: 'helvetica', bold: true, size: 7, align: 'center' };
    const valor = { font: 'times', bold: true, size: 7, align: 'center' };
    const faixaLaranja = { fill: LARANJA, color: BRANCO, bold: true, align: 'center' };

    // 1: logos e título
    c('B', 'M', 1, 1, 'RELATÓRIO DIÁRIO DE OBRA', { font: 'helvetica', bold: true, size: 15, align: 'center', borda: false, min: 15 });
    const logos = window.LogosRdo || {};
    if (logos.inhaus) imagemNoQuadro(doc, logos.inhaus.src, 11.2, YS[0] + 0.6, 26, ALTURAS[0] - 1.2);
    if (logos.gps) imagemNoQuadro(doc, logos.gps.src, 182, YS[0] + 1.3, 16.5, ALTURAS[0] - 2.6);
    // 2: faixas
    c('B', 'G', 2, 2, 'Dados Contrato', { ...faixaLaranja, font: 'times', size: 7.6 });
    c('H', 'M', 2, 2, 'Dados da Atividade', { ...faixaLaranja, font: 'times', size: 7.6 });
    // 3-5: dados do contrato e da atividade
    c('B', 'C', 3, 3, 'Contrato:', rotulo);
    c('D', 'D', 3, 3, CONTRATO, rotulo);
    c('E', 'E', 3, 3, 'Cliente:', valor);
    guarda(c('F', 'G', 3, 3, rdo.cliente, valor), 'Cliente', rdo.cliente);
    c('H', 'I', 3, 3, 'DATA', valor);
    c('J', 'M', 3, 3, rdo.date ? fmtDate(rdo.date) : '', valor);
    c('B', 'C', 4, 4, 'Complexo', rotulo);
    guarda(c('D', 'D', 4, 4, rdo.complexo, rotulo), 'Complexo', rdo.complexo);
    c('E', 'E', 4, 4, 'Gerência:', valor);
    guarda(c('F', 'G', 4, 4, rdo.gerencia, { ...valor, size: 6.3 }), 'Gerência', rdo.gerencia);
    c('H', 'I', 4, 4, 'EQUIPE/ COORDENAÇÃO:', { ...valor, size: 6.3 });
    guarda(c('J', 'M', 4, 4, rdo.equipeCoord, valor), 'Equipe / Coordenação', rdo.equipeCoord);
    // Campo Objeto saiu do formulário (pedido de 09/11/2026): a linha só é desenhada
    // quando o RDO ainda tem o texto, para os antigos não perderem o dado.
    if (String(rdo.objeto || '').trim()) {
      c('B', 'C', 5, 5, 'Objeto:', valor);
      guarda(c('D', 'M', 5, 5, rdo.objeto, { font: 'times', bold: true, size: 7.6 }), 'Objeto', rdo.objeto);
    }

    // 6-15: registro de execução e horas
    c('B', 'K', 6, 7, 'Registro de Execução de Atividades', { ...faixaLaranja, font: 'times', size: 11.4 });
    c('L', 'M', 6, 6, 'REGISTRO DE HORAS', { ...valor, min: 5 });
    c('L', 'L', 7, 7, 'INÍCIO', { ...valor, size: 6.3 });
    c('M', 'M', 7, 7, 'FIM', { ...valor, size: 6.3 });
    Store.ETAPAS.forEach((nome, i) => {
      const r = 8 + i;
      const e = rdo.etapas?.[i] || {};
      const vazio = !e.inicio && !e.fim;
      c('B', 'B', r, r, String(i + 1), { font: 'times', size: 7, align: 'center' });
      c('C', 'K', r, r, nome, { font: 'times', size: 7 });
      c('L', 'L', r, r, vazio ? HORAS_MODELO[i][0] : e.inicio, { font: 'times', size: 7, align: 'right' });
      c('M', 'M', r, r, vazio ? HORAS_MODELO[i][1] : e.fim, { font: 'times', size: 7, align: 'right' });
    });
    // 16 (só no RDO final): o bloqueio do dia ocupa a linha 9 da tabela de execução
    if (comBloqueio) {
      const b = rdo.bloqueio;
      c('B', 'B', 16, 16, '9', { font: 'times', size: 7, align: 'center' });
      guarda(c('C', 'K', 16, 16, `BLOQUEIO:${b.motivo ? ` ${b.motivo}` : ''}`, { font: 'times', size: 7 }),
        'Bloqueio', b.motivo);
      c('L', 'L', 16, 16, b.inicio || '', { font: 'times', size: 7, align: 'right' });
      c('M', 'M', 16, 16, b.fim || '', { font: 'times', size: 7, align: 'right' });
    }
    c('B', 'M', linha(16), linha(16), 'OBSERVAÇÕES/DESVIOS/MOTIVO DA NÃO EXECUÇÃO DA ATIVIDADE:', { ...rotulo, size: 7.6 });

    // 17-40: quatro blocos de OM
    const tasks = rdo.tasks || [];
    for (let b = 0; b < OM_POR_FOLHA; b += 1) {
      const idx = k * OM_POR_FOLHA + b;
      const t = tasks[idx];
      const r0 = linha(17) + b * 6;
      for (let r = r0; r < r0 + 6; r += 1) c('B', 'M', r, r, '', {});
      // linha do bloco: OS, TAG do equipamento e área; com OM, as atividades começam na
      // parte de baixo da linha (pedido de 09/11/2026)
      const comOm = Boolean(t && (String(t.os || '').trim() || String(t.tag || '').trim()));
      // "Nº da OS" digitado como "OS-4472" não vira "OS OS-4472"
      const numeroOs = String(t?.os || '').trim().replace(/^(os|om)\s*[-–:]?\s*/i, '');
      const titulo = t ? [numeroOs && `OS ${numeroOs}`, t.tag && `TAG ${t.tag}`, t.area, comOm ? '' : t.description].filter(Boolean).join(' - ') : '';
      guarda(c('B', 'M', r0, r0, PREFIXO_OM + titulo, { bold: true, size: 7.6 }), `OM ${idx + 1} — título`, titulo);
      const atividades = t ? [comOm ? t.description : '', t.notes].filter(Boolean).join(' — ') : '';
      if (atividades) {
        guarda(c('B', 'M', r0 + 1, r0 + LINHAS_NOTA_OM, atividades, { bold: true, size: 7.6, valign: 'bottom', borda: false }),
          `OM ${idx + 1} — atividades`, atividades);
      }
      c('B', 'M', r0 + 5, r0 + 5, statusOm(t), { size: 7.6, underline: Boolean(t), borda: false });
    }

    // 41: observações (só na primeira folha; as outras dizem de onde continuam)
    const ROBS = linha(41);
    c('B', 'C', ROBS, ROBS, 'OBSERVAÇÕES:', valor);
    if (k === 0) {
      const partes = partesObservacoes(rdo);
      const texto = partes.map(([campo, v]) => (campo === 'Observações' ? v : `${campo}: ${v}`)).join('  |  ');
      if (c('D', 'M', ROBS, ROBS, texto, { size: 7, valign: 'top' })) {
        partes.forEach(([campo, v]) => guarda(true, campo, v));
      }
    } else {
      c('D', 'M', ROBS, ROBS, `Continuação do RDO — folha ${k + 1} de ${nFolhas}. Observações na folha 1.`, { size: 7 });
    }

    // 42-49: equipe
    c('B', 'F', linha(42), linha(42), 'Funcionário In Haus', { ...faixaLaranja, size: 7.6 });
    c('G', 'I', linha(42), linha(42), 'Função ', { ...faixaLaranja, size: 7.6 });
    c('J', 'M', linha(42), linha(42), 'Equipe', { ...faixaLaranja, size: 7.6 });
    const equipe = rdo.workforce || [];
    // coluna Equipe = turno escolhido no preenchimento do RDO (pedido de 09/11/2026);
    // sem turno, fica a equipe de cada pessoa
    const turno = String(rdo.shift || '').trim();
    for (let i = 0; i < PESSOAS_POR_FOLHA; i += 1) {
      const idx = k * PESSOAS_POR_FOLHA + i;
      const w = equipe[idx];
      const r = linha(43 + i);
      const nome = w ? `${w.name || ''}${w.status === 'Falta' ? ' (falta)' : ''}` : '';
      guarda(c('B', 'F', r, r, nome, { font: 'times', size: 6.3, align: 'center' }), `Funcionário ${idx + 1} — nome`, nome);
      guarda(c('G', 'I', r, r, w?.role, { font: 'times', size: 6.3, align: 'center' }), `Funcionário ${idx + 1} — função`, w?.role);
      const time = w ? (turno ? `Turno ${turno}` : w.team) : '';
      guarda(c('J', 'M', r, r, time, { font: 'times', size: 7.6, align: 'center' }), `Funcionário ${idx + 1} — equipe`, time);
    }

    // 50-53: supervisor, assinatura e responsável do cliente
    c('B', 'G', linha(50), linha(50), 'Supervisor  In Haus', { ...faixaLaranja, size: 7.6 });
    c('H', 'M', linha(50), linha(50), 'Responsável técnico  (Cliente Vale)', { ...faixaLaranja, size: 7.6 });
    // só o modelo: nome digitado nas linhas, sem foto nem assinatura desenhada (pedido de 09/11/2026).
    // O texto encolhe até caber, em vez de vazar da célula.
    const supervisor = String(rdo.supervisor || '').trim();
    const tst = String(rdo.tst || '').trim();
    guarda(c('B', 'D', linha(51), linha(51), `Nome:      ${supervisor}`, { bold: true, size: 6.3, min: 4.6 }), 'Supervisor', supervisor);
    guarda(c('E', 'G', linha(51), linha(51), tst ? `Téc. Segurança: ${tst}` : '', { bold: true, size: 6.3, min: 4.6 }), 'Técnico de Segurança', tst);
    c('H', 'M', linha(51), linha(51), 'Nome:', { bold: true, size: 6.3 });
    c('B', 'G', linha(52), linha(52), 'Ass:', { bold: true, size: 6.3 });
    c('H', 'M', linha(52), linha(52), 'Ass:', { bold: true, size: 6.3 });
    c('H', 'J', linha(52), linha(52), 'Ass:', { bold: true, size: 6.3 });
    c('K', 'M', linha(52), linha(52), 'Data:', { bold: true, size: 6.3 });
    c('B', 'M', linha(53), linha(53), '', { fill: LARANJA });
    // 54: empresa e CNPJ, fora da borda
    c('B', 'M', linha(54), linha(54), EMPRESA_RODAPE, { bold: true, size: 6.3, borda: false, min: 6.3 });

    // linhas grossas do modelo: contorno e divisões dos blocos
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(GROSSA);
    doc.rect(XS[0], ys[0], XS[12] - XS[0], ys[alturas.length - 2] - ys[0], 'S');
    const grossas = [2, 6];
    if (comBloqueio) grossas.push(16);
    [16, 17, 23, 29, 35, 41, 42, 50, 53].forEach((r) => grossas.push(linha(r)));
    grossas.forEach((r) => doc.line(XS[0], ys[r - 1], XS[12], ys[r - 1]));
  }

  /**
   * Desenha um RDO inteiro no formulário RDO ADM, a partir da página atual (ou de uma
   * página nova): uma folha a cada 4 OMs / 7 pessoas, depois a continuação com os textos
   * que não couberam, o registro fotográfico e a foto de quem preencheu.
   * O PDF de um período chama esta função para cada RDO.
   */
  async function escrever(doc, rdo, { primeira = true } = {}) {
    // RDO antigo (ou vindo do banco): ganha as etapas e os campos do formulário
    rdo = comPadroesDoDia(Store.completo(rdo));
    const fotos = rdo.photos || [];
    const larg = doc.internal.pageSize.getWidth();
    const alt = doc.internal.pageSize.getHeight();
    const margem = 10;
    const fim = alt - 10; // a linha de controle do rodapé fica nos últimos mm
    const rotulo = { fill: LARANJA, color: BRANCO, bold: true, size: 8.5, align: 'center' };

    const nFolhas = Math.max(1,
      Math.ceil((rdo.tasks || []).length / OM_POR_FOLHA),
      Math.ceil((rdo.workforce || []).length / PESSOAS_POR_FOLHA));
    const resto = [];
    for (let k = 0; k < nFolhas; k += 1) {
      if (k > 0 || !primeira) doc.addPage();
      folha(doc, rdo, k, nFolhas, resto);
    }
    let y = fim;

    // textos que não couberam nas células: inteiros, numa tabela que pagina sozinha
    if (resto.length) {
      doc.addPage();
      y = 12;
      celula(doc, margem, y, larg - margem * 2, 6.4, `CONTINUAÇÃO — TEXTOS COMPLETOS DO RDO ${rdo.number || ''}`.trim(), rotulo);
      doc.autoTable({
        startY: y + 6.4, margin: { top: 12, bottom: 12, left: margem, right: margem },
        head: [['Campo do RDO', 'Texto completo']], body: resto, theme: 'grid', rowPageBreak: 'auto',
        styles: { font: 'helvetica', fontSize: 8, cellPadding: PAD, overflow: 'linebreak', textColor: TINTA, lineColor: [0, 0, 0], lineWidth: FINA },
        headStyles: { fillColor: LARANJA, textColor: BRANCO, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 42, fontStyle: 'bold' } },
      });
      y = doc.lastAutoTable.finalY + 4;
    }

    // registro fotográfico: as fotos vão junto no PDF, duas por linha
    if (fotos.length) {
      const imagens = await Promise.all(fotos.map((p) => (window.Fotos ? window.Fotos.imagem(p) : (p.data || null))));
      const espaco = 6;
      const colL = (larg - margem * 2 - espaco) / 2;
      const fotoA = 64;
      const linhaA = fotoA + 8;
      const novaPagina = () => { doc.addPage(); y = 12; };
      if (y + 6.4 + linhaA > fim) novaPagina();
      celula(doc, margem, y, larg - margem * 2, 6.4, 'REGISTRO FOTOGRÁFICO', rotulo);
      y += 6.4 + 2;
      fotos.forEach((p, i) => {
        const coluna = i % 2;
        if (coluna === 0 && i > 0) y += linhaA;
        if (coluna === 0 && y + linhaA > fim) novaPagina();
        const x = margem + coluna * (colL + espaco);
        doc.setFillColor(...CINZA);
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(FINA);
        doc.rect(x, y, colL, fotoA, 'FD');
        if (!imagemNoQuadro(doc, imagens[i], x, y, colL, fotoA)) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(120, 120, 120);
          doc.text('Foto indisponível neste aparelho', x + colL / 2, y + fotoA / 2, { align: 'center' });
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(60, 60, 60);
        doc.text(`Foto ${i + 1}`, x, y + fotoA + 3.5);
      });
      y += linhaA + 2;
      // legendas completas (data, hora, GPS e descrição) em tabela paginada
      doc.autoTable({
        startY: Math.min(y, fim - 10), margin: { top: 12, bottom: 12, left: margem, right: margem },
        body: fotos.map((p, i) => [`Foto ${i + 1}`, [p.date && fmtDate(p.date), p.time,
          p.latitude != null && p.longitude != null ? `GPS ${Number(p.latitude).toFixed(6)}, ${Number(p.longitude).toFixed(6)}` : '', p.desc].filter(Boolean).join(' — ')]),
        theme: 'grid', styles: { fontSize: 8, cellPadding: PAD, overflow: 'linebreak', lineColor: [0, 0, 0], lineWidth: FINA },
        columnStyles: { 0: { cellWidth: 22, fontStyle: 'bold' } },
      });
      y = doc.lastAutoTable.finalY + 4;
    }

    // Só o modelo (pedido de 09/11/2026): a foto do rosto e a assinatura desenhada do
    // cadastro não entram no PDF: o bloco antigo de quem preencheu saiu junto.
  }

  /** Monta o PDF de um RDO (com as fotos) e devolve o documento e o nome do arquivo. */
  async function montar(rdo) {
    const doc = novoDoc();
    await escrever(doc, rdo);
    rodapeFormulario(doc, [{ de: 1, ate: doc.getNumberOfPages(), rdo }]);
    return { doc, nome: `RDO_${rdo.number}.pdf` };
  }

  /**
   * PDF de vários RDOs num arquivo só (dia com mais de um RDO, ou período): um RDO por
   * página inicial, na ordem recebida, com o rodapé do formulário em cada página.
   */
  async function montarVarios(rdos, { titulo = 'RDOs', nome } = {}) {
    const doc = novoDoc();
    const lista = Array.isArray(rdos) ? rdos.filter(Boolean) : [];
    if (!lista.length) throw new Error('Nenhum RDO para gerar.');
    const paginas = [];
    for (let i = 0; i < lista.length; i += 1) {
      const de = doc.getNumberOfPages() + (i === 0 ? 0 : 1);
      await escrever(doc, lista[i], { primeira: i === 0 });
      paginas.push({ de, ate: doc.getNumberOfPages(), rdo: lista[i] });
    }
    rodapeFormulario(doc, paginas);
    return { doc, nome: nome || `${String(titulo || 'RDOs').replace(/[^\w\-]+/g, '_')}.pdf` };
  }

  /** PDF de vários RDOs baixado (navegador) ou entregue ao compartilhar (APK). */
  async function gerarVarios(rdos, opcoes) {
    const { doc, nome } = await montarVarios(rdos, opcoes);
    if (nativo()?.Filesystem && nativo()?.Share) return compartilharNativo(doc, nome, 'Salvar ou enviar o PDF');
    doc.save(nome);
    return 'baixado';
  }

  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const nomeMes = (mes) => {
    const [a, m] = String(mes).split('-');
    return `${MESES[Number(m) - 1] || m}/${a}`;
  };

  /** Resumo do mês ("2026-11"): números do mês e a lista dos RDOs, para mandar ao gestor. */
  function resumoMes(mes, rdos) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const margem = 14;
    const r = window.Store.resumo(rdos);
    faixa(doc, 'RESUMO DO MÊS', margem);
    let y = 33;
    doc.setTextColor(30, 30, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`${nomeMes(mes)} · ${r.total} RDO(s)`, margem, y);
    y += 5;

    const tabelaResumo = (titulo, cabecalho, corpo, estilos = {}) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...ORANGE);
      doc.text(titulo, margem, y + 4);
      doc.autoTable({
        startY: y + 6,
        margin: { left: margem, right: margem },
        head: [cabecalho],
        body: corpo,
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2, textColor: [40, 40, 40], lineColor: [220, 220, 220], lineWidth: 0.15 },
        headStyles: { fillColor: ORANGE, textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: GRAY },
        columnStyles: estilos,
      });
      y = doc.lastAutoTable.finalY + 4;
    };

    tabelaResumo('NÚMEROS DO MÊS', ['Indicador', 'Valor'], [
      ['RDOs no mês', String(r.total)],
      ['RDOs finalizados', String(r.finalizados)],
      ['Preventiva / Corretiva / Backlog (RDO)', `${r.porTipo.Preventiva} / ${r.porTipo.Corretiva} / ${r.porTipo.Backlog}`],
      ['Tarefas (concluídas de total)', `${r.concluidas} de ${r.tarefas}`],
      ['Tarefas Preventiva / Corretiva / Backlog', `${r.tarefasPorTipo.Preventiva} / ${r.tarefasPorTipo.Corretiva} / ${r.tarefasPorTipo.Backlog}`],
      ['Backlog ainda aberto (abaixo de 100%)', String(r.backlogAberto)],
      ['Horas de equipe (presentes)', `${r.horasEquipe}h`],
      ['Ocorrências', String(r.ocorrencias)],
      ['Fotos', String(r.fotos)],
    ], { 0: { cellWidth: 110 }, 1: { halign: 'right' } });

    tabelaResumo('RDOs DO MÊS', ['Nº', 'Data', 'Tipo', 'Local / Mina', 'Tarefas', 'Situação'],
      rdos.map((x) => [
        x.number, fmtDate(x.date), x.maintenanceType || '—', x.location || '—', String(x.tasks.length),
        x.status === 'final' ? 'Finalizado' : 'Aberto',
      ]),
      { 0: { cellWidth: 24 }, 1: { cellWidth: 20 }, 2: { cellWidth: 22 }, 4: { halign: 'right', cellWidth: 16 }, 5: { cellWidth: 20 } });

    rodape(doc, [window.Store.config.companyName, `Resumo ${nomeMes(mes)}`, `gerado em ${fmtDate(window.Store.todayIso())}`]);
    return { doc, nome: `Resumo_RDO_${mes}.pdf` };
  }

  const nativo = () => (window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins : null);

  /** No APK o WebView não baixa blob: grava no cache e abre o compartilhar do Android. */
  async function compartilharNativo(doc, nome, titulo, texto) {
    const plugins = nativo();
    const base64 = doc.output('datauristring').split(',')[1];
    const arq = await plugins.Filesystem.writeFile({ path: nome, data: base64, directory: 'CACHE' });
    try {
      await plugins.Share.share({ title: nome, text: texto, files: [arq.uri], dialogTitle: titulo });
      return 'compartilhado';
    } catch (err) {
      if (/cancel/i.test(String(err?.message || err))) return 'cancelado';
      throw err;
    }
  }

  /**
   * Abrir o PDF no visualizador, sem baixar.
   * No computador abre o PDF numa aba nova (visualizador do próprio navegador).
   * No APK, se houver FileOpener, entrega ao visualizador do Android; senão usa o
   * compartilhar (o WebView não desenha PDF sozinho).
   */
  async function abrir(rdo, janelaAberta) {
    const { doc, nome } = await montar(rdo);
    const plugins = nativo();
    if (plugins?.Filesystem) {
      const base64 = doc.output('datauristring').split(',')[1];
      const arq = await plugins.Filesystem.writeFile({ path: nome, data: base64, directory: 'CACHE' });
      if (plugins.FileOpener) {
        try {
          await plugins.FileOpener.open({ filePath: arq.uri, contentType: 'application/pdf' });
          return 'aberto';
        } catch { /* sem visualizador instalado: cai no compartilhar */ }
      }
      if (plugins.Share) {
        try {
          await plugins.Share.share({ title: nome, files: [arq.uri], dialogTitle: 'Abrir o PDF' });
          return 'compartilhado';
        } catch (err) {
          if (/cancel/i.test(String(err?.message || err))) return 'cancelado';
          throw err;
        }
      }
      return 'salvo';
    }
    const url = doc.output('bloburl');
    // a aba já foi aberta no toque (o navegador bloqueia abrir depois do await):
    // basta mandar a aba para o PDF
    if (janelaAberta && !janelaAberta.closed) {
      janelaAberta.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 300000);
      return 'aberto';
    }
    const janela = window.open(url, '_blank');
    if (!janela) {
      // Safari/PWA pode bloquear a aba aberta depois do await: entrega o arquivo
      doc.save(nome);
      return 'baixado';
    }
    // a aba já pegou o arquivo; libera a memória depois, sem cortar a leitura
    setTimeout(() => URL.revokeObjectURL(url), 300000);
    return 'aberto';
  }

  /** Baixar PDF: no navegador salva o arquivo; no APK abre o compartilhar (salvar ou enviar). */
  async function gerar(rdo) {
    const { doc, nome } = await montar(rdo);
    if (nativo()?.Filesystem && nativo()?.Share) return compartilharNativo(doc, nome, 'Salvar ou enviar o PDF');
    doc.save(nome);
    return 'baixado';
  }

  /**
   * PDF pronto para mandar pelo WhatsApp (ou outro app) com as fotos dentro.
   * `enviar` precisa ser chamado direto no toque do botão: o Safari só abre o
   * compartilhar dentro do toque, por isso o PDF é montado antes.
   */
  async function preparar(rdo) {
    const { doc, nome } = await montar(rdo);
    return {
      nome,
      enviar(texto) {
        if (nativo()?.Filesystem && nativo()?.Share) return compartilharNativo(doc, nome, 'Enviar o PDF', texto);
        const arquivo = new File([doc.output('blob')], nome, { type: 'application/pdf' });
        if (navigator.canShare?.({ files: [arquivo] })) {
          return navigator.share({ files: [arquivo], title: nome, text: texto }).then(
            () => 'compartilhado',
            (err) => {
              if (err?.name === 'AbortError') return 'cancelado';
              doc.save(nome);
              return 'baixado';
            },
          );
        }
        // navegador sem compartilhar arquivo (computador): baixa para anexar à mão
        doc.save(nome);
        return Promise.resolve('baixado');
      },
    };
  }

  return { abrir, gerar, preparar, gerarVarios, montarVarios, resumoMes, nomeMes };
})();
