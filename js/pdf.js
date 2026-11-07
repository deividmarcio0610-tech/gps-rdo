/* PDF A4 conforme item 4 da especificação: jsPDF + autotable, laranja e cinza. */
window.Pdf = (() => {
  'use strict';

  const ORANGE = [255, 87, 34];
  const GRAY = [243, 243, 243];

  const fmtDate = (iso) => {
    const [a, m, d] = String(iso || '').slice(0, 10).split('-');
    return a ? `${d}/${m}/${a}` : '—';
  };

  /** Faixa laranja do topo com o título e a logo In-Haus (RDO e resumo do mês). */
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

  /** Monta o PDF inteiro (com as fotos) e devolve o documento e o nome do arquivo. */
  async function montar(rdo) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const larg = doc.internal.pageSize.getWidth();
    const alt = doc.internal.pageSize.getHeight();
    const margem = 14;
    let y = 0;

    // 1. faixa laranja no topo
    faixa(doc, 'RELATÓRIO DIÁRIO DE OBRA', margem);
    y = 33;

    // 2. identificação
    doc.setTextColor(30, 30, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    // só entra o que foi preenchido: campo vazio não vira texto inventado no PDF
    const juntar = (partes, sep = '  ·  ') => partes.filter(Boolean).join(sep);
    doc.text(juntar([`RDO Nº ${rdo.number}`, fmtDate(rdo.date), rdo.shift && `Turno ${rdo.shift}`, rdo.maintenanceType]), margem, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(90, 90, 90);
    const linhas = [
      // local / mina digitado à mão: pode ser longo, quebra na largura da página
      juntar([rdo.location && `Local: ${rdo.location}`, rdo.weather && `Clima: ${rdo.weather}`]),
      juntar([
        rdo.supervisor && `Supervisor: ${rdo.supervisor}`,
        (rdo.startTime || rdo.endTime) && `${rdo.startTime || '—'} às ${rdo.endTime || '—'}`,
      ], '   ·   '),
    ].filter(Boolean);
    for (const linha of linhas) {
      for (const parte of doc.splitTextToSize(linha, larg - margem * 2)) {
        doc.text(parte, margem, y);
        y += 3.5;
      }
    }
    doc.setDrawColor(...ORANGE);
    doc.setLineWidth(0.7);
    doc.line(margem, y + 1, larg - margem, y + 1);
    y += 7;

    const tabela = (titulo, cols, corpo, opts = {}) => {
      if (!corpo.length) return;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...(opts.headColor || ORANGE));
      doc.text(titulo, margem, y);
      y += 2.5;
      doc.autoTable({
        startY: y,
        margin: { left: margem, right: margem },
        head: [cols],
        body: corpo,
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2, textColor: [40, 40, 40], lineColor: [220, 220, 220], lineWidth: 0.15 },
        headStyles: { fillColor: opts.headColor || ORANGE, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
        alternateRowStyles: { fillColor: GRAY },
        columnStyles: opts.columnStyles || {},
        didParseCell: (data) => {
          if (data.section === 'body' && opts.colorir) {
            const cor = opts.colorir(data.row.index, data.column.index, data.cell);
            if (cor) { data.cell.styles.textColor = cor.texto; data.cell.styles.fontStyle = 'bold'; }
          }
        },
      });
      y = doc.lastAutoTable.finalY + 7;
    };

    // 3. mão de obra
    tabela(
      '1. MÃO DE OBRA',
      ['Nome', 'Função', 'Equipe', 'Status'],
      rdo.workforce.map((w) => [w.name, w.role || '—', w.team || '—', w.status]),
      {
        columnStyles: { 0: { cellWidth: 62 }, 1: { cellWidth: 45 }, 2: { cellWidth: 45 } },
        colorir: (linha, coluna, cell) => {
          if (coluna !== 3 || cell.text[0] !== 'Falta') return null;
          return { texto: [198, 40, 40] };
        },
      },
    );

    // 4. equipamentos
    tabela(
      '2. EQUIPAMENTOS',
      ['Equipamento', 'Código', 'Status', 'Horímetro'],
      rdo.equipmentList.map((e) => {
        const h = (v) => (v == null || v === '' ? '—' : `${v}h`);
        return [e.name, e.code || '—', e.status || '—', `${h(e.hoursStart)} - ${h(e.hoursEnd)}`];
      }),
      { columnStyles: { 0: { cellWidth: 62 }, 3: { halign: 'right', cellWidth: 34 } } },
    );

    // 5. atividades
    tabela(
      '3. ATIVIDADES REALIZADAS',
      ['OS', 'Tipo', 'Descrição', 'Progresso', 'Status'],
      rdo.tasks.map((t) => [t.os || '—', t.maintenanceType || '—', t.description, `${Number(t.progress) || 0}%`, t.status || '—']),
      {
        columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 24 }, 2: { cellWidth: 72 }, 3: { halign: 'right', cellWidth: 20 } },
        colorir: (linha, coluna, cell) => {
          if (coluna !== 4) return null;
          return cell.text[0] === 'Concluído' ? { texto: [46, 125, 50] } : { texto: [178, 106, 0] };
        },
      },
    );

    // 6. ocorrências — cabeçalho vermelho, omitida quando vazia
    tabela(
      '4. OCORRÊNCIAS',
      ['Tipo', 'Descrição', 'Hora'],
      rdo.occurrences.map((o) => [o.type, o.description, o.time || '—']),
      {
        headColor: [198, 40, 40],
        columnStyles: { 0: { cellWidth: 32 }, 2: { halign: 'right', cellWidth: 20 } },
      },
    );

    // horas paradas, com o total do dia na última linha (omitida quando vazia)
    const paradas = rdo.stoppages || [];
    const minutos = (p) => window.Store.minutosParada?.(p) ?? 0;
    const horas = (m) => window.Store.fmtHoras?.(m) ?? `${m} min`;
    const totalParado = paradas.reduce((s, p) => s + minutos(p), 0);
    tabela(
      '5. HORAS PARADAS',
      ['Motivo', 'Início', 'Fim', 'Duração', 'Observação'],
      paradas.length
        ? [...paradas.map((p) => [p.reason, p.start, p.end, horas(minutos(p)), p.note || '—']), ['TOTAL PARADO', '', '', horas(totalParado), '']]
        : [],
      {
        headColor: [178, 106, 0],
        columnStyles: { 0: { cellWidth: 44 }, 1: { cellWidth: 18 }, 2: { cellWidth: 18 }, 3: { halign: 'right', cellWidth: 22 } },
        colorir: (linha, coluna, cell) => (linha === paradas.length ? { texto: [178, 106, 0] } : null),
      },
    );

    // 6. registro fotográfico: as fotos vão junto no PDF, duas por linha, carimbo embaixo
    if (rdo.photos.length) {
      const imagens = await Promise.all(rdo.photos.map((p) => (window.Fotos ? window.Fotos.imagem(p) : (p.data || null))));
      const espaco = 6;
      const colL = (larg - margem * 2 - espaco) / 2;
      const fotoA = 64;
      const linhaA = fotoA + 15;
      const novaPagina = () => { doc.addPage(); y = 18; };
      if (y + 6 + linhaA > alt - 18) novaPagina();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...ORANGE);
      doc.text('6. REGISTRO FOTOGRÁFICO', margem, y);
      y += 3;
      rdo.photos.forEach((p, i) => {
        const coluna = i % 2;
        if (coluna === 0 && i > 0) y += linhaA;
        if (coluna === 0 && y + linhaA > alt - 18) novaPagina();
        const x = margem + coluna * (colL + espaco);
        doc.setFillColor(...GRAY);
        doc.rect(x, y, colL, fotoA, 'F');
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
        const legenda = juntar([`Foto ${i + 1}`, juntar([p.date && fmtDate(p.date), p.time], ' '), gps, p.desc], ' · ');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(60, 60, 60);
        doc.text(doc.splitTextToSize(legenda, colL).slice(0, 3), x, y + fotoA + 3.5);
      });
      y += linhaA + 3;
    }

    // sem linhas de assinatura (pedido do usuário em 07/11/2026): o PDF termina nas fotos

    // rodapé em todas as páginas: número do RDO, data e página
    rodape(doc, [window.Store.config.companyName, `RDO ${rdo.number}`, fmtDate(rdo.date), rdo.status === 'final' && 'finalizado']);

    return { doc, nome: `RDO_${rdo.number}.pdf` };
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

  return { gerar, preparar, resumoMes, nomeMes };
})();
