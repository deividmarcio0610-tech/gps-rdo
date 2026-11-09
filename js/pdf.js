/* PDF A4 no formulário "RDO ADM" do cliente (modelo de 09/11/2026): jsPDF + autotable. */
window.Pdf = (() => {
  'use strict';

  const ORANGE = [255, 87, 34];
  const GRAY = [243, 243, 243];

  // formulário "RDO ADM": laranja do cliente, linhas pretas finas, texto preto
  const LARANJA = [247, 150, 70];
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

  /**
   * Rodapé do formulário em todas as páginas: empresa, CNPJ e, embaixo, de qual RDO é a
   * página. `paginas` liga cada página ao RDO dela (PDF de um dia ou de um período).
   */
  function rodapeFormulario(doc, paginas) {
    const larg = doc.internal.pageSize.getWidth();
    const alt = doc.internal.pageSize.getHeight();
    const total = doc.getNumberOfPages();
    const empresa = String(window.Store.config.companyName || '').trim();
    for (let p = 1; p <= total; p += 1) {
      doc.setPage(p);
      const info = paginas.find((x) => p >= x.de && p <= x.ate);
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.2);
      doc.line(10, alt - 16, larg - 10, alt - 16);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...TINTA);
      doc.text(empresa.toUpperCase(), 10, alt - 11.5);
      const cnpj = String(info?.rdo?.cnpj ?? window.Store.config.cnpj ?? '').trim();
      if (cnpj) doc.text(`CNPJ: ${cnpj}`, larg - 10, alt - 11.5, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(90, 90, 90);
      const linha = [info?.rdo?.number && `RDO ${info.rdo.number}`, info?.rdo?.date && fmtDate(info.rdo.date), total > 1 && `página ${p} de ${total}`]
        .filter(Boolean).join(' · ');
      if (linha) doc.text(linha, larg / 2, alt - 7.5, { align: 'center' });
    }
  }

  /** Documento A4 vazio (um RDO por PDF, ou vários RDOs no mesmo arquivo). */
  function novoDoc() {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  }

  /** Célula do formulário: quadro com borda, fundo opcional e texto que cabe na largura. */
  function celula(doc, x, y, w, h, texto, o = {}) {
    const size = o.size || 8;
    if (o.fill) {
      doc.setFillColor(...o.fill);
      doc.rect(x, y, w, h, 'F');
    }
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.18);
    doc.rect(x, y, w, h, 'S');
    const txt = texto == null ? '' : String(texto);
    if (!txt.trim()) return;
    doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...(o.color || TINTA));
    const linhas = doc.splitTextToSize(txt, Math.max(2, w - PAD * 2));
    const lh = size * 0.3528 * 1.15;
    const cabem = Math.max(1, Math.floor((h - PAD) / lh));
    if (linhas.length > cabem) throw new Error('Texto excede a altura da célula do PDF.');
    const desenhar = linhas;
    let base;
    if (o.valign === 'top') base = y + PAD + size * 0.3528 * 0.85;
    else base = y + h / 2 - ((desenhar.length - 1) * lh) / 2 + size * 0.3528 * 0.35;
    const tx = o.align === 'center' ? x + w / 2 : o.align === 'right' ? x + w - PAD : x + PAD;
    doc.text(desenhar, tx, base, { align: o.align || 'left' });
  }

  /**
   * Desenha um RDO inteiro no formulário do cliente, a partir da página atual
   * (ou de uma página nova). O PDF de um período chama esta função para cada RDO.
   */
  async function escrever(doc, rdo, { primeira = true } = {}) {
    // RDO antigo (ou vindo do banco): ganha as etapas e os campos do formulário
    rdo = Store.completo(rdo);
    const tasks = rdo.tasks || [];
    const equips = rdo.equipmentList || [];
    const paradas = rdo.stoppages || [];
    const ocorrencias = rdo.occurrences || [];
    const equipe = rdo.workforce || [];
    const fotos = rdo.photos || [];
    const larg = doc.internal.pageSize.getWidth();
    const alt = doc.internal.pageSize.getHeight();
    const margem = 10;
    const fim = alt - 20; // o rodapé do formulário ocupa os últimos 16 mm

    if (!primeira) doc.addPage();
    let y = 12;

    const rotulo = { fill: LARANJA, color: [255, 255, 255], bold: true, size: 8.5, align: 'center' };

    // O AutoTable quebra inclusive uma única célula longa entre páginas.
    // Campos vazios continuam vazios; supervisor é dado, não assinatura.
    const rows = [];
    const section = text => rows.push([{ content: text, colSpan: 3, styles: { fillColor: LARANJA, textColor: [0, 0, 0], fontStyle: 'bold' } }]);
    const row = (key, value) => rows.push([
      { content: String(key ?? ''), colSpan: 1 },
      { content: String(value ?? ''), colSpan: 2 },
    ]);
    section('RELATÓRIO DIÁRIO DE OBRA');
    section('Dados Contrato / Dados da Atividade');
    [['Contrato:', rdo.contractName], ['Cliente:', rdo.cliente], ['DATA', fmtDate(rdo.date)],
      ['Complexo', rdo.complexo], ['Gerência:', rdo.gerencia], ['EQUIPE/ COORDENAÇÃO:', rdo.equipeCoord],
      ['Objeto:', rdo.objeto], ['Local / Mina / Turno', [rdo.location, rdo.shift].filter(Boolean).join(' — ')],
      ['Supervisor In Haus:', rdo.supervisor]].forEach(v => row(...v));
    section('Registro de Execução de Atividades — REGISTRO DE HORAS');
    Store.ETAPAS.forEach((nome, i) => rows.push([
      { content: `${i + 1}. ${nome}`, colSpan: 2 },
      { content: `INÍCIO: ${rdo.etapas[i]?.inicio || ''}\nFIM: ${rdo.etapas[i]?.fim || ''}` },
    ]));
    section('OBSERVAÇÕES/DESVIOS/MOTIVO DA NÃO EXECUÇÃO DA ATIVIDADE');
    row('', rdo.notes);
    (tasks.length ? tasks : [{}]).forEach(t => {
      section('Nº OM / TÍTULO / LOCAL / DESCRIÇÃO DETALHADA :');
      row('OM / Tipo / Local', [t.os, t.maintenanceType, t.area].filter(Boolean).join(' — '));
      row('Descrição', t.description);
      const preenchido = t.progress != null && t.progress !== '';
      const p = Number(t.progress);
      const marca = v => v ? '( x )' : '(   )';
      row('STATUS OM', `CONCLUIDO ${marca(preenchido && p >= 100)} EM ANDAMENTO ${marca(preenchido && p > 0 && p < 100)} NÃO EXECUTADO ${marca(preenchido && p === 0)}`);
    });
    if (equips.length) section('EQUIPAMENTOS');
    equips.forEach(e => {
      row('Equipamento', e.name); row('Código / Status', [e.code, e.status].filter(Boolean).join(' — '));
      row('Horímetro', [e.hoursStart, e.hoursEnd].map(v => v == null || v === '' ? '' : `${v}h`).join(' a '));
    });
    if (paradas.length) section('HORAS PARADAS');
    paradas.forEach(p => {
      row('Motivo', p.reason); row('Início / Fim / Duração', [p.start, p.end, Store.fmtHoras(Store.minutosParada(p))].filter(Boolean).join(' — ')); row('Observação', p.note);
    });
    if (paradas.length) row('TOTAL PARADO', Store.fmtHoras(paradas.reduce((s, p) => s + (Store.minutosParada(p) || 0), 0)));
    section('OBSERVAÇÕES:');
    ocorrencias.forEach(o => row([o.time, o.type].filter(Boolean).join(' — '), [o.description, o.location].filter(Boolean).join(' — ')));
    if (equipe.length) section('Funcionário In Haus / Função / Equipe');
    equipe.forEach(w => rows.push([
      String(`${w.name || ''}${w.status === 'Falta' ? ' (falta)' : ''}`),
      String(w.role || ''), String(w.team || ''),
    ]));
    doc.autoTable({
      startY: y, margin: { top: 12, bottom: 20, left: margem, right: margem },
      body: rows, theme: 'grid', rowPageBreak: 'auto',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: PAD, overflow: 'linebreak', textColor: TINTA, lineColor: [0, 0, 0], lineWidth: 0.18 },
      columnStyles: { 0: { cellWidth: 65 }, 1: { cellWidth: 90 }, 2: { cellWidth: 35 } },
    });
    y = doc.lastAutoTable.finalY;

    // 9. registro fotográfico: as fotos vão junto no PDF, duas por linha, carimbo embaixo
    if (fotos.length) {
      const imagens = await Promise.all(fotos.map((p) => (window.Fotos ? window.Fotos.imagem(p) : (p.data || null))));
      const espaco = 6;
      const colL = (larg - margem * 2 - espaco) / 2;
      const fotoA = 64;
      const linhaA = fotoA + 15;
      const novaPagina = () => { doc.addPage(); y = 18; };
      if (y + 6 + linhaA > fim) novaPagina();
      celula(doc, margem, y, larg - margem * 2, 6.4, 'REGISTRO FOTOGRÁFICO', rotulo);
      y += 6.4;
      fotos.forEach((p, i) => {
        const coluna = i % 2;
        if (coluna === 0 && i > 0) y += linhaA;
        if (coluna === 0 && y + linhaA > fim) novaPagina();
        const x = margem + coluna * (colL + espaco);
        doc.setFillColor(...CINZA);
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.18);
        doc.rect(x, y, colL, fotoA, 'FD');
        try {
          const props = doc.getImageProperties(imagens[i]);
          const escala = Math.min(colL / props.width, fotoA / props.height);
          const w = props.width * escala;
          const h = props.height * escala;
          doc.addImage(imagens[i], props.fileType || 'JPEG', x + (colL - w) / 2, y + (fotoA - h) / 2, w, h);
        } catch {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(120, 120, 120);
          doc.text('Foto indisponível neste aparelho', x + colL / 2, y + fotoA / 2, { align: 'center' });
        }
        const gps = p.latitude != null && p.longitude != null
          ? `GPS ${Number(p.latitude).toFixed(6)}, ${Number(p.longitude).toFixed(6)}` : '';
        const legenda = [ `Foto ${i + 1}`, [p.date && fmtDate(p.date), p.time].filter(Boolean).join(' '), gps, p.desc].filter(Boolean).join(' · ');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(60, 60, 60);
        doc.text(doc.splitTextToSize(`Foto ${i + 1}`, colL), x, y + fotoA + 3.5);
      });
      y += linhaA + 3;
      // Legendas completas em tabela paginada, sem limite de três linhas.
      doc.autoTable({ startY: Math.min(y, fim), margin: { top: 12, bottom: 20, left: margem, right: margem },
        body: fotos.map((p, i) => [`Foto ${i + 1}`, [p.date && fmtDate(p.date), p.time,
          p.latitude != null && p.longitude != null ? `GPS ${Number(p.latitude).toFixed(6)}, ${Number(p.longitude).toFixed(6)}` : '', p.desc].filter(Boolean).join(' — ')]),
        theme: 'grid', styles: { fontSize: 8, cellPadding: PAD, overflow: 'linebreak' }, columnStyles: { 0: { cellWidth: 22 } } });
    }
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
      ['Horas paradas', window.Store.fmtHoras(r.minutosParados)],
      ['Ocorrências', String(r.ocorrencias)],
      ['Fotos', String(r.fotos)],
    ], { 0: { cellWidth: 110 }, 1: { halign: 'right' } });

    if (r.motivosParada.length) {
      tabelaResumo('HORAS PARADAS POR MOTIVO', ['Motivo', 'Tempo'],
        r.motivosParada.map(([motivo, min]) => [motivo, window.Store.fmtHoras(min)]), { 1: { halign: 'right', cellWidth: 30 } });
    }

    tabelaResumo('RDOs DO MÊS', ['Nº', 'Data', 'Tipo', 'Local / Mina', 'Tarefas', 'Parado', 'Situação'],
      rdos.map((x) => [
        x.number, fmtDate(x.date), x.maintenanceType || '—', x.location || '—', String(x.tasks.length),
        window.Store.fmtHoras((x.stoppages || []).reduce((s, p) => s + window.Store.minutosParada(p), 0)),
        x.status === 'final' ? 'Finalizado' : 'Aberto',
      ]),
      { 0: { cellWidth: 24 }, 1: { cellWidth: 20 }, 2: { cellWidth: 22 }, 4: { halign: 'right', cellWidth: 16 }, 5: { halign: 'right', cellWidth: 16 }, 6: { cellWidth: 20 } });

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

  return { gerar, preparar, gerarVarios, montarVarios, resumoMes, nomeMes };
})();
