/*
 * Análise dos RDOs (pedido de 17/11/2026): painel tipo BI da conta principal, com o
 * levantamento de todos os RDOs da equipe no banco num período — números de RDOs, tarefas
 * executadas e em andamento, equipamentos parados, horas paradas, ocorrências, por pessoa e
 * por dia — e exportação para Excel (uma planilha por assunto).
 *
 * Só lê: não muda nenhum RDO. Os números saem do que está no banco; RDO feito sem internet
 * só entra depois que sobe.
 */
window.Analise = (() => {
  'use strict';

  const { esc, toast, icon } = window.UI;
  const fmtDate = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

  const hojeIso = () => Store.todayIso();
  const inicioDoMes = () => `${hojeIso().slice(0, 8)}01`;

  let de = inicioDoMes();
  let ate = hojeIso();
  let cache = { chave: '', lista: [], doServidor: true };
  let carregando = false;
  let erro = '';

  const chave = () => `${de}|${ate}`;

  async function carregar(app) {
    if (cache.chave === chave() || carregando) return;
    carregando = true;
    erro = '';
    try {
      const lista = await Nuvem.todos(de, ate);
      cache = { chave: chave(), lista, doServidor: lista.doServidor !== false };
    } catch (e) {
      erro = e.message || 'Não foi possível ler o banco.';
      cache = { chave: chave(), lista: [], doServidor: false };
    }
    carregando = false;
    app?.render?.();
  }

  const quem = (x) => x.nome || x.json?.autor?.nome || x.email || 'sem nome';
  const pct = (n) => Math.max(0, Math.min(100, Number(n) || 0));
  const chaveTarefa = (t) => [t.os, t.tag, t.description].map((v) => String(v || '').trim().toLowerCase()).join('|');

  /** Todo o levantamento do período, a partir da lista do banco. */
  function levantar(lista) {
    const ordenada = lista.slice().sort((a, b) => `${a.json.date}|${a.json.number}`.localeCompare(`${b.json.date}|${b.json.number}`));
    const rdos = [];
    const tarefas = [];
    const equipamentos = [];
    const paradas = [];
    const ocorrencias = [];
    const pessoas = new Map();
    const dias = new Map();
    const maoDeObra = [];

    for (const x of ordenada) {
      const r = x.json;
      const nome = quem(x);
      const base = { data: r.date, rdo: r.number, pessoa: nome, local: r.location || '' };
      const ts = (r.tasks || []).map((t) => ({ ...base, os: t.os || '', tag: t.tag || '', descricao: t.description || '', tipo: t.maintenanceType || r.maintenanceType || '', area: t.area || '', execucao: pct(t.progress), chave: chaveTarefa(t) }));
      const eqs = (r.equipmentList || []).map((e) => ({ ...base, equipamento: e.name || '', status: e.status || 'Sem status', horimetroIni: e.hoursStart ?? '', horimetroFim: e.hoursEnd ?? '' }));
      const ps = (r.stoppages || []).map((p) => ({ ...base, inicio: p.start || '', fim: p.end || '', motivo: p.reason || 'Sem motivo', obs: p.note || '', minutos: Store.minutosParada(p) }));
      // desvios (pedido de 24/11/2026: "Ocorrências" viraram "Desvios"; o dado continua em occurrences)
      const ocs = (r.occurrences || []).map((o) => ({ ...base, tipo: o.type || 'Sem tipo', descricao: o.description || '', hora: o.time || '', onde: o.location || '' }));
      (r.workforce || []).forEach((w) => {
        if (!w || !String(w.name || '').trim() || w.status === 'Falta') return;
        maoDeObra.push({ ...base, nome: String(w.name).trim(), funcao: String(w.role || '').trim(), equipe: String(w.team || '').trim(), horas: w.hours || '' });
      });
      tarefas.push(...ts);
      equipamentos.push(...eqs);
      paradas.push(...ps);
      ocorrencias.push(...ocs);
      const minParados = ps.reduce((s, p) => s + p.minutos, 0);
      rdos.push({
        ...base, status: r.status === 'final' ? 'Finalizado' : 'Rascunho', tipo: r.maintenanceType || '', turno: r.shift || '',
        tarefas: ts.length, executadas: ts.filter((t) => t.execucao >= 100).length,
        equipParados: eqs.filter((e) => e.status !== 'Operando').length, minParados, ocorrencias: ocs.length,
        pessoasNoRdo: (r.workforce || []).length,
      });
      const p = pessoas.get(nome) || { pessoa: nome, rdos: 0, tarefas: 0, executadas: 0, emAndamento: 0, minParados: 0, ultimo: '' };
      p.rdos += 1;
      p.tarefas += ts.length;
      p.executadas += ts.filter((t) => t.execucao >= 100).length;
      p.emAndamento += ts.filter((t) => t.execucao < 100).length;
      p.minParados += minParados;
      p.ultimo = r.date > p.ultimo ? r.date : p.ultimo;
      pessoas.set(nome, p);
      dias.set(r.date, (dias.get(r.date) || 0) + 1);
    }

    // a mesma tarefa (OS/TAG/descrição) volta nos RDOs seguintes até fechar: vale a última
    const ultimaPorTarefa = new Map();
    tarefas.forEach((t) => ultimaPorTarefa.set(t.chave, t));
    const unicas = [...ultimaPorTarefa.values()];
    const executadas = unicas.filter((t) => t.execucao >= 100);
    const emAndamento = unicas.filter((t) => t.execucao > 0 && t.execucao < 100);
    const naoIniciadas = unicas.filter((t) => t.execucao === 0);

    // equipamento: o último status de cada um no período
    const ultimoEquip = new Map();
    equipamentos.forEach((e) => ultimoEquip.set(String(e.equipamento).trim().toLowerCase(), e));
    const equipAtual = [...ultimoEquip.values()];

    const contar = (itens, campo) => {
      const m = new Map();
      itens.forEach((i) => m.set(i[campo], (m.get(i[campo]) || 0) + 1));
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const minutosPorMotivo = new Map();
    paradas.forEach((p) => minutosPorMotivo.set(p.motivo, (minutosPorMotivo.get(p.motivo) || 0) + p.minutos));

    // ---- destaques (pedido de 17/11/2026, no estilo do painel do LubControl)
    const contarTexto = (itens, pegar) => {
      const m = new Map();
      itens.forEach((i) => {
        const bruto = String(pegar(i) || '').trim().replace(/\s+/g, ' ');
        if (!bruto) return;
        const k = bruto.toLowerCase();
        const atual = m.get(k) || [bruto, 0];
        atual[1] += 1;
        m.set(k, atual);
      });
      return [...m.values()].sort((a, b) => b[1] - a[1]);
    };
    // atividade: cada lançamento de tarefa conta (é o que se repete no dia a dia)
    const atividades = contarTexto(tarefas, (t) => t.descricao);
    // preventiva x corretiva pelo tipo de cada lançamento de tarefa
    const tipoDe = (t) => {
      const x = String(t.tipo || '').toLowerCase();
      if (x.includes('prevent')) return 'Preventiva';
      if (x.includes('corret')) return 'Corretiva';
      if (x.includes('predit')) return 'Preditiva';
      return x ? 'Outras' : 'Sem tipo';
    };
    const prevCorr = contarTexto(tarefas, tipoDe);
    // equipamento mais atendido: TAG da tarefa; sem TAG, o equipamento da lista do RDO
    const alvos = contarTexto([...tarefas.map((t) => t.tag), ...equipamentos.map((e) => e.equipamento)], (x) => x);
    // mão de obra presente no dia mais recente do período
    const diaMaoDeObra = maoDeObra.reduce((m, w) => (w.data > m ? w.data : m), '');
    const maoDoDia = maoDeObra.filter((w) => w.data === diaMaoDeObra);
    const maoPorLocal = contarTexto(maoDoDia, (w) => w.local || 'Sem local');
    const maoPorEquipe = contarTexto(maoDoDia, (w) => w.equipe || 'Sem equipe');
    const maoPorFuncao = contarTexto(maoDoDia, (w) => w.funcao || 'Sem função');

    return {
      atividades, prevCorr, alvos, maoDeObra, diaMaoDeObra, maoDoDia, maoPorLocal, maoPorEquipe, maoPorFuncao,
      rdos, tarefas, equipamentos, paradas, ocorrencias,
      pessoas: [...pessoas.values()].sort((a, b) => b.rdos - a.rdos || a.pessoa.localeCompare(b.pessoa)),
      dias: [...dias.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      unicas, executadas, emAndamento, naoIniciadas, equipAtual,
      equipParados: equipAtual.filter((e) => e.status === 'Parado'),
      equipManutencao: equipAtual.filter((e) => e.status === 'Manutenção'),
      equipOperando: equipAtual.filter((e) => e.status === 'Operando'),
      porTipo: contar(unicas, 'tipo'),
      ocorrenciasPorTipo: contar(ocorrencias, 'tipo'),
      minutosPorMotivo: [...minutosPorMotivo.entries()].sort((a, b) => b[1] - a[1]),
      minParados: paradas.reduce((s, p) => s + p.minutos, 0),
      finalizados: rdos.filter((r) => r.status === 'Finalizado').length,
      mediaExecucao: unicas.length ? Math.round(unicas.reduce((s, t) => s + t.execucao, 0) / unicas.length) : 0,
    };
  }

  // ------------------------------------------------------------------ tela

  const cartao = (rotulo, valor, cor = '', sub = '') => `
    <div class="bi-card${cor ? ` bi-${cor}` : ''}"><div class="bi-valor">${esc(String(valor))}</div>
      <div class="bi-rotulo">${esc(rotulo)}</div>${sub ? `<div class="bi-sub">${esc(sub)}</div>` : ''}</div>`;

  // ---------------- gráficos no estilo do painel do LubControl (SVG, sem biblioteca)
  const CORES = ['#e8693a', '#2f7bd6', '#1f9d74', '#e0a419', '#e3709f', '#9a9a9a', '#6a4fc2', '#1a8f2e'];
  const fmtNum = (n) => Number(n).toLocaleString('pt-BR');
  const vazio = (titulo) => `<div class="bi-painel"><div class="bi-titulo">${esc(titulo)}</div><div class="empty">Nada no período.</div></div>`;

  /** Rosca com o total no meio e a tabela de legenda ao lado (quantidade e %). */
  function rosca(titulo, pares, rotuloTotal, cores = CORES) {
    const itens = pares.filter(([, v]) => v > 0);
    const total = itens.reduce((s, [, v]) => s + v, 0);
    if (!total) return vazio(titulo);
    const R = 80; const r = 50; const cx = 100; const cy = 100;
    let ang = -Math.PI / 2;
    const fatias = itens.map(([, v], i) => {
      const cor = cores[i % cores.length];
      const frac = v / total;
      const meioR = (R + r) / 2;
      if (frac >= 0.9999) {
        return `<circle cx="${cx}" cy="${cy}" r="${meioR}" fill="none" stroke="${cor}" stroke-width="${R - r}"/>`
          + `<text x="${cx}" y="${cy - meioR}" class="bi-fatia">100%</text>`;
      }
      const a0 = ang; const a1 = ang + frac * Math.PI * 2; ang = a1;
      const p = (rad, raio) => `${(cx + raio * Math.cos(rad)).toFixed(2)} ${(cy + raio * Math.sin(rad)).toFixed(2)}`;
      const grande = a1 - a0 > Math.PI ? 1 : 0;
      const meio = (a0 + a1) / 2;
      const txt = frac >= 0.06
        ? `<text x="${(cx + meioR * Math.cos(meio)).toFixed(1)}" y="${(cy + meioR * Math.sin(meio)).toFixed(1)}" class="bi-fatia">${Math.round(frac * 100)}%</text>` : '';
      return `<path d="M ${p(a0, R)} A ${R} ${R} 0 ${grande} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${grande} 0 ${p(a0, r)} Z" fill="${cor}" stroke="#fff" stroke-width="2"/>${txt}`;
    }).join('');
    return `<div class="bi-painel"><div class="bi-titulo">${esc(titulo)}</div>
      <div class="bi-rosca">
        <svg viewBox="0 0 200 200" role="img" aria-label="${esc(titulo)}">${fatias}
          <text x="100" y="100" class="bi-total">${fmtNum(total)}</text>
          <text x="100" y="121" class="bi-total-rot">${esc(rotuloTotal.toUpperCase())}</text></svg>
        <table class="bi-legenda"><thead><tr><th></th><th>QTD.</th><th>%</th></tr></thead><tbody>
          ${itens.map(([k, v], i) => `<tr><td><span class="bi-ponto" style="background:${cores[i % cores.length]}"></span>${esc((k || '(não informado)').toUpperCase())}</td>
            <td><strong>${fmtNum(v)}</strong></td><td>${(v / total * 100).toFixed(1).replace('.', ',')}%</td></tr>`).join('')}
        </tbody></table>
      </div></div>`;
  }

  /** Barras deitadas: rótulo à esquerda, valor na ponta; as 4 maiores em cor cheia. */
  function barrasH(titulo, pares, formatar = fmtNum) {
    if (!pares.length) return vazio(titulo);
    const max = Math.max(1, ...pares.map(([, v]) => v));
    return `<div class="bi-painel"><div class="bi-titulo">${esc(titulo)}</div><div class="bi-hbar">
      ${pares.map(([k, v], i) => `<div class="bi-hlin${i < 4 ? ' forte' : ''}"><span class="bi-hnome">${esc((k || '—').toUpperCase())}</span>
        <span class="bi-htrilho"><span style="width:${Math.max(1, (v / max) * 70).toFixed(1)}%"></span><b>${esc(String(formatar(v)))}</b></span></div>`).join('')}
    </div></div>`;
  }

  /** Colunas por dia com o valor em cima e a linha tracejada da média (rola para o lado). */
  function colunasDia(titulo, pares, unidade) {
    if (!pares.length) return vazio(titulo);
    const max = Math.max(1, ...pares.map(([, v]) => v));
    const media = pares.reduce((s, [, v]) => s + v, 0) / pares.length;
    const L = 36; const H = 170; const topo = 24; const larg = Math.max(320, pares.length * L + 10);
    const y = (v) => topo + H - (v / max) * H;
    const cols = pares.map(([k, v], i) => {
      const x = 5 + i * L;
      return `<rect x="${x + 5}" y="${y(v).toFixed(1)}" width="${L - 10}" height="${(topo + H - y(v)).toFixed(1)}" fill="#e8693a" rx="2"/>`
        + `<text x="${x + L / 2}" y="${(y(v) - 5).toFixed(1)}" class="bi-cval">${fmtNum(v)}</text>`
        + `<text x="${x + L / 2}" y="${topo + H + 16}" class="bi-cdia">${esc(k)}</text>`;
    }).join('');
    return `<div class="bi-painel"><div class="bi-titulo">${esc(titulo)}</div>
      <div class="bi-sublegenda"><span class="bi-ponto" style="background:#e8693a"></span>${esc(unidade)} no dia
        <span class="bi-tracejado"></span>média do período (${media.toFixed(1).replace('.', ',')})</div>
      <div class="bi-rolar"><svg width="${larg}" height="${topo + H + 26}" role="img" aria-label="${esc(titulo)}">
        <line x1="0" x2="${larg}" y1="${topo + H}" y2="${topo + H}" stroke="#ccc"/>
        ${cols}
        <line x1="0" x2="${larg}" y1="${y(media).toFixed(1)}" y2="${y(media).toFixed(1)}" stroke="#444" stroke-dasharray="6 4"/>
      </svg></div></div>`;
  }

  /** O resumo em tópicos curtos: o mesmo texto vai para a tela e para o PDF. */
  function topicos(a) {
    const h = Store.fmtHoras;
    const t = [
      { texto: `${a.rdos.length} RDO(s) · ${a.pessoas.length} pessoa(s) · ${a.dias.length} dia(s)` },
      { texto: `Tarefas: ${a.executadas.length} exec. · ${a.emAndamento.length} andam. · ${a.naoIniciadas.length} não inic.` },
      { texto: `Exec. média: ${a.mediaExecucao}%` },
      a.equipParados.length
        ? { texto: `Equip. parados: ${a.equipParados.length} (${a.equipParados.slice(0, 3).map((e) => e.equipamento).join(', ')}${a.equipParados.length > 3 ? '…' : ''})`, critico: true }
        : { texto: 'Equip. parados: nenhum' },
      { texto: `H. paradas: ${h(a.minParados)}${a.minutosPorMotivo[0] ? ` · maior motivo: ${a.minutosPorMotivo[0][0]} (${h(a.minutosPorMotivo[0][1])})` : ''}` },
    ];
    if (a.atividades[0]) t.push({ texto: `Ativ. + rotineira: ${a.atividades[0][0]} (${a.atividades[0][1]}x)` });
    const totalTipos = a.prevCorr.reduce((x, [, v]) => x + v, 0);
    if (totalTipos) t.push({ texto: `Tipo: ${a.prevCorr.slice(0, 3).map(([k, v]) => `${k} ${Math.round(v / totalTipos * 100)}%`).join(' · ')}` });
    if (a.alvos[0]) t.push({ texto: `Equip. + atendido: ${a.alvos[0][0]} (${a.alvos[0][1]}x)` });
    if (a.maoDoDia.length) {
      t.push({ texto: `Mão de obra ${fmtDate(a.diaMaoDeObra).slice(0, 5)}: ${a.maoDoDia.length} pres. · + em ${a.maoPorLocal[0][0]} (${a.maoPorLocal[0][1]})` });
    }
    if (a.ocorrencias.length) t.push({ texto: `Desvios: ${a.ocorrencias.length}${a.ocorrenciasPorTipo[0] ? ` · + comum: ${a.ocorrenciasPorTipo[0][0]}` : ''}` });
    if (a.pessoas[0]) t.push({ texto: `Mais RDOs: ${a.pessoas[0].pessoa} (${a.pessoas[0].rdos})` });
    return t;
  }

  /** PDF A4 só com o resumo: tópicos, números e as listas que pedem atenção (curtas). */
  function pdfResumo(a) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const h = Store.fmtHoras;
    const laranja = [232, 105, 58];
    const larg = doc.internal.pageSize.getWidth();
    doc.setFillColor(...laranja); doc.rect(0, 0, larg, 18, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('Análise dos RDOs - resumo', 12, 11.5);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text(`${fmtDate(de)} a ${fmtDate(ate)}`, larg - 12, 11.5, { align: 'right' });
    doc.setTextColor(30);
    let y = 26;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Resumo', 12, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    topicos(a).forEach((t) => {
      const linhas = doc.splitTextToSize(`•  ${t.texto}`, larg - 24);
      doc.setTextColor(...(t.critico ? [200, 40, 40] : [30, 30, 30]));
      doc.text(linhas, 12, y); y += linhas.length * 5;
    });
    doc.setTextColor(30);
    const tab = (titulo, cabeca, linhas, max = 10) => {
      if (!linhas.length) return;
      const corte = linhas.slice(0, max);
      doc.autoTable({
        startY: y + 4, head: [[{ content: titulo + (linhas.length > max ? ` (${max} de ${linhas.length})` : ''), colSpan: cabeca.length }], cabeca],
        body: corte, theme: 'grid', margin: { left: 12, right: 12 },
        styles: { fontSize: 8.5, cellPadding: 1.6, overflow: 'ellipsize' },
        headStyles: { fillColor: laranja, textColor: 255, fontStyle: 'bold' },
      });
      y = doc.lastAutoTable.finalY;
    };
    tab('Números', ['RDOs', 'Pessoas', 'Exec.', 'Andam.', 'Não inic.', 'Exec. méd.', 'Eq. par.', 'Manut.', 'H. par.', 'Desv.'],
      [[a.rdos.length, a.pessoas.length, a.executadas.length, a.emAndamento.length, a.naoIniciadas.length, `${a.mediaExecucao}%`,
        a.equipParados.length, a.equipManutencao.length, h(a.minParados), a.ocorrencias.length]]);
    tab('Ativ. mais rotineiras', ['Atividade', 'Vezes'], a.atividades.map(([k, v]) => [k, v]), 8);
    tab('Preventiva x corretiva', ['Tipo', 'Lançam.', '%'], a.prevCorr.map(([k, v]) => [k, v, `${Math.round(v / Math.max(1, a.tarefas.length) * 100)}%`]));
    tab('Equip./TAG mais atendidos', ['Equip./TAG', 'Vezes'], a.alvos.map(([k, v]) => [k, v]), 8);
    if (a.maoDoDia.length) tab(`Mão de obra ${fmtDate(a.diaMaoDeObra)} por local`, ['Local', 'Pessoas'], a.maoPorLocal.map(([k, v]) => [k, v]), 8);
    tab('Por pessoa', ['Pessoa', 'RDOs', 'Tar.', 'Exec.', 'Andam.', 'H. par.', 'Últ. RDO'],
      a.pessoas.map((p) => [p.pessoa, p.rdos, p.tarefas, p.executadas, p.emAndamento, h(p.minParados), fmtDate(p.ultimo)]), 15);
    tab('Equip. parados/manut.', ['Equip.', 'Status', 'Data', 'Quem'],
      [...a.equipParados, ...a.equipManutencao].map((e) => [e.equipamento, e.status, fmtDate(e.data), e.pessoa]));
    tab('H. paradas por motivo', ['Motivo', 'Horas'], a.minutosPorMotivo.map(([m, v]) => [m, h(v)]), 8);
    tab('Em andamento (menor %)', ['OS', 'TAG', 'Desc.', '%', 'Quem'],
      a.emAndamento.slice().sort((x, z) => x.execucao - z.execucao).map((t) => [t.os, t.tag, t.descricao, `${t.execucao}%`, t.pessoa]));
    const paginas = doc.getNumberOfPages();
    for (let i = 1; i <= paginas; i += 1) {
      doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(130);
      doc.text(`GPS-RDO · gerado em ${new Date().toLocaleString('pt-BR')} · pág. ${i}/${paginas}`, 12, doc.internal.pageSize.getHeight() - 6);
    }
    return doc.output('blob');
  }

  const barras = (pares, formatar = (v) => v) => {
    const max = Math.max(1, ...pares.map(([, v]) => v));
    return pares.length ? `<div class="bi-barras">${pares.map(([k, v]) => `
      <div class="bi-barra"><span class="bi-nome">${esc(k || '—')}</span>
        <span class="bi-trilho"><span style="width:${Math.max(2, Math.round((v / max) * 100))}%"></span></span>
        <span class="bi-num">${esc(String(formatar(v)))}</span></div>`).join('')}</div>` : '<div class="empty">Nada no período.</div>';
  };

  const tabela = (cabecalho, linhas) => (linhas.length ? `
    <div class="bi-tabela"><table><thead><tr>${cabecalho.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${linhas.map((l) => `<tr>${l.map((c) => `<td>${esc(String(c ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Nada no período.</div>');

  function tela(app) {
    carregar(app);
    let corpo;
    if (carregando || cache.chave !== chave()) corpo = '<div class="empty">Levantando os RDOs da equipe no banco...</div>';
    else if (erro) corpo = `<div class="aviso erro">${esc(erro)}</div>`;
    else if (!cache.lista.length) corpo = '<div class="empty">Nenhum RDO no banco neste período.</div>';
    else {
      const a = levantar(cache.lista);
      const h = Store.fmtHoras;
      corpo = `
        ${cache.doServidor ? '' : '<div class="aviso">Sem internet: números da última cópia guardada no aparelho.</div>'}
        <div class="bi-resumo"><strong>RESUMO</strong>
          <ul>${topicos(a).map((t) => `<li${t.critico ? ' class="bi-critico"' : ''}>${esc(t.texto)}</li>`).join('')}</ul></div>
        <div class="bi-grade">
          ${cartao('RDOs', a.rdos.length, '', `${a.finalizados} final.`)}
          ${cartao('Pessoas', a.pessoas.length)}
          ${cartao('Executadas', a.executadas.length, 'green', '100%')}
          ${cartao('Em andam.', a.emAndamento.length, 'amber', '1–99%')}
          ${cartao('Não inic.', a.naoIniciadas.length, 'red', '0%')}
          ${cartao('Exec. média', `${a.mediaExecucao}%`)}
          ${cartao('Equip. parados', a.equipParados.length, 'red', 'últ. status')}
          ${cartao('Em manut.', a.equipManutencao.length, 'amber')}
          ${cartao('Operando', a.equipOperando.length, 'green')}
          ${cartao('H. paradas', h(a.minParados), 'red', `${a.paradas.length} parada(s)`)}
          ${cartao('Desvios', a.ocorrencias.length)}
          ${cartao('Dias c/ RDO', a.dias.length)}
        </div>
        <div class="btn-row">
          <button class="btn primary" data-act="exportar-pdf">${icon('download', 16)}PDF (resumo)</button>
          <button class="btn ghost" data-act="exportar">${icon('download', 16)}Excel (completo)</button>
        </div>

        <div class="section-label">Destaques</div>
        ${barrasH('Ativ. mais rotineiras', a.atividades.slice(0, 8))}
        ${rosca('Preventiva x corretiva', a.prevCorr, 'lançam.', ['#1f9d74', '#d64541', '#2f7bd6', '#9a9a9a', '#c9c9c9'])}
        ${barrasH('Equip./TAG mais atendidos', a.alvos.slice(0, 8))}
        ${a.maoDoDia.length ? `
        ${barrasH(`Mão de obra ${fmtDate(a.diaMaoDeObra)} · por local`, a.maoPorLocal.slice(0, 8))}
        ${a.maoPorEquipe.some(([k]) => k !== 'Sem equipe') ? barrasH(`Mão de obra ${fmtDate(a.diaMaoDeObra).slice(0, 5)} · por equipe`, a.maoPorEquipe.slice(0, 8)) : ''}
        ${barrasH(`Mão de obra ${fmtDate(a.diaMaoDeObra).slice(0, 5)} · por função`, a.maoPorFuncao.slice(0, 8))}` : vazio('Mão de obra do dia')}

        <div class="section-label">Gráficos</div>
        ${colunasDia('RDOs por dia', a.dias.map(([d, n]) => [fmtDate(d).slice(0, 5), n]), 'RDOs')}
        ${rosca('Tarefas', [['Executadas', a.executadas.length], ['Em andam.', a.emAndamento.length], ['Não inic.', a.naoIniciadas.length]], 'tarefas', ['#1f9d74', '#e0a419', '#d64541'])}
        ${rosca('Equipamentos', [['Operando', a.equipOperando.length], ['Manut.', a.equipManutencao.length], ['Parado', a.equipParados.length], ['S/ status', a.equipAtual.length - a.equipOperando.length - a.equipManutencao.length - a.equipParados.length]], 'equipamentos', ['#1f9d74', '#e0a419', '#d64541', '#9a9a9a'])}
        ${rosca('Tipo de manut.', a.porTipo.map(([k, v]) => [k || '(não inf.)', v]), 'tarefas')}
        ${barrasH('H. paradas por motivo', a.minutosPorMotivo, h)}
        ${barrasH('RDOs por pessoa', a.pessoas.map((p) => [p.pessoa, p.rdos]))}
        ${barrasH('Desvios por tipo', a.ocorrenciasPorTipo)}

        <div class="section-label">Por pessoa</div>
        ${tabela(['Pessoa', 'RDOs', 'Tar.', 'Exec.', 'Andam.', 'H. par.', 'Últ. RDO'],
          a.pessoas.map((p) => [p.pessoa, p.rdos, p.tarefas, p.executadas, p.emAndamento, h(p.minParados), fmtDate(p.ultimo)]))}
        <div class="section-label">Equip. parados/manut. · ${a.equipParados.length + a.equipManutencao.length}</div>
        ${tabela(['Equip.', 'Status', 'Data', 'RDO', 'Quem'],
          [...a.equipParados, ...a.equipManutencao].map((e) => [e.equipamento, e.status, fmtDate(e.data), e.rdo, e.pessoa]))}
        <div class="section-label">Em andamento · ${a.emAndamento.length}</div>
        ${tabela(['OS', 'TAG', 'Desc.', '%', 'Data', 'Quem'],
          a.emAndamento.sort((x, y) => x.execucao - y.execucao).map((t) => [t.os, t.tag, t.descricao, `${t.execucao}%`, fmtDate(t.data), t.pessoa]))}
        <div class="section-label">Executadas · ${a.executadas.length}</div>
        ${tabela(['OS', 'TAG', 'Desc.', 'Data', 'Quem'],
          a.executadas.map((t) => [t.os, t.tag, t.descricao, fmtDate(t.data), t.pessoa]))}`;
    }
    return {
      titulo: 'Análise dos RDOs',
      html: `
        <div class="form-grid">
          <div class="field"><label for="bi-de">De</label><input id="bi-de" type="date" value="${esc(de)}"></div>
          <div class="field"><label for="bi-ate">Até</label><input id="bi-ate" type="date" value="${esc(ate)}"></div>
        </div>
        <div class="btn-row">
          <button class="btn ghost" data-periodo="hoje">Hoje</button>
          <button class="btn ghost" data-periodo="7">7 dias</button>
          <button class="btn ghost" data-periodo="mes">Este mês</button>
          <button class="btn ghost" data-periodo="tudo">Tudo</button>
          <button class="btn ghost" data-act="bi-atualizar">${icon('refresh', 14)}Atualizar</button>
        </div>
        ${corpo}
        <p class="dica">Todos os RDOs do banco no período. Tarefa e equipamento contam uma vez (último lançamento). RDO sem internet entra depois que sobe.</p>`,
      bind(root) {
        const mudar = (novoDe, novoAte) => { de = novoDe; ate = novoAte; app.render(); };
        root.querySelector('#bi-de')?.addEventListener('change', (e) => { if (e.target.value) mudar(e.target.value, ate < e.target.value ? e.target.value : ate); });
        root.querySelector('#bi-ate')?.addEventListener('change', (e) => { if (e.target.value) mudar(de > e.target.value ? e.target.value : de, e.target.value); });
        root.querySelectorAll('[data-periodo]').forEach((b) => b.addEventListener('click', () => {
          const hoje = hojeIso();
          const p = b.dataset.periodo;
          if (p === 'hoje') mudar(hoje, hoje);
          else if (p === '7') {
            const d = new Date(); d.setDate(d.getDate() - 6);
            mudar(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, hoje);
          } else if (p === 'mes') mudar(inicioDoMes(), hoje);
          else mudar('2020-01-01', hoje);
        }));
        root.querySelector('[data-act="bi-atualizar"]')?.addEventListener('click', () => { cache = { ...cache, chave: '' }; app.render(); });
        root.querySelector('[data-act="exportar-pdf"]')?.addEventListener('click', async (ev) => {
          const botao = ev.currentTarget;
          botao.disabled = true;
          try {
            const nome = `Resumo RDO - ${fmtDate(de).replace(/\//g, '-')} a ${fmtDate(ate).replace(/\//g, '-')}.pdf`;
            const r = await UI.entregarArquivo(pdfResumo(levantar(cache.lista)), nome, 'Salvar ou enviar o PDF');
            if (r === 'baixado') toast('PDF baixado.');
          } catch (e) {
            toast(`Não foi possível gerar o PDF: ${e.message || e}`);
          }
          botao.disabled = false;
        });
        root.querySelector('[data-act="exportar"]')?.addEventListener('click', async (ev) => {
          const botao = ev.currentTarget;
          botao.disabled = true;
          try {
            const nome = `Analise RDO - ${fmtDate(de).replace(/\//g, '-')} a ${fmtDate(ate).replace(/\//g, '-')}.xls`;
            const r = await UI.entregarArquivo(planilha(levantar(cache.lista)), nome, 'Salvar ou enviar a planilha');
            if (r === 'baixado') toast('Planilha baixada.');
          } catch (e) {
            toast(`Não foi possível exportar: ${e.message || e}`);
          }
          botao.disabled = false;
        });
      },
    };
  }

  // ------------------------------------------------------------------ Excel

  /** Planilha do Excel (formato XML 2003, abre no Excel e no Google Planilhas), uma aba por assunto. */
  function planilha(a) {
    const x = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const cel = (v) => (typeof v === 'number' && Number.isFinite(v)
      ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>`
      : `<Cell><Data ss:Type="String">${x(v)}</Data></Cell>`);
    const aba = (nome, cab, linhas) => `<Worksheet ss:Name="${x(nome)}"><Table>
<Row>${cab.map((c) => `<Cell ss:StyleID="cab"><Data ss:Type="String">${x(c)}</Data></Cell>`).join('')}</Row>
${linhas.map((l) => `<Row>${l.map(cel).join('')}</Row>`).join('\n')}
</Table></Worksheet>`;
    const h = (m) => Math.round((m / 60) * 100) / 100;
    const resumo = [
      ['Período', `${fmtDate(de)} a ${fmtDate(ate)}`],
      ['RDOs', a.rdos.length], ['RDOs finalizados', a.finalizados], ['Pessoas que enviaram', a.pessoas.length],
      ['Dias com RDO', a.dias.length], ['Tarefas (sem repetir)', a.unicas.length], ['Tarefas executadas (100%)', a.executadas.length],
      ['Tarefas em andamento (1% a 99%)', a.emAndamento.length], ['Tarefas não iniciadas (0%)', a.naoIniciadas.length],
      ['Execução média (%)', a.mediaExecucao], ['Equipamentos parados', a.equipParados.length],
      ['Equipamentos em manutenção', a.equipManutencao.length], ['Equipamentos operando', a.equipOperando.length],
      ['Horas paradas', h(a.minParados)], ['Paradas', a.paradas.length], ['Desvios', a.ocorrencias.length],
      ['Gerado em', new Date().toLocaleString('pt-BR')],
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="cab"><Font ss:Bold="1"/><Interior ss:Color="#F4B183" ss:Pattern="Solid"/></Style></Styles>
${aba('Resumo', ['Indicador', 'Valor'], resumo)}
${aba('Por pessoa', ['Pessoa', 'RDOs', 'Tarefas', 'Executadas', 'Em andamento', 'Horas paradas', 'Último RDO'],
    a.pessoas.map((p) => [p.pessoa, p.rdos, p.tarefas, p.executadas, p.emAndamento, h(p.minParados), fmtDate(p.ultimo)]))}
${aba('RDOs', ['Data', 'Nº RDO', 'Pessoa', 'Local', 'Tipo', 'Turno', 'Status', 'Pessoas no RDO', 'Tarefas', 'Executadas', 'Equip. parados/manut.', 'Horas paradas', 'Desvios'],
    a.rdos.map((r) => [fmtDate(r.data), r.rdo, r.pessoa, r.local, r.tipo, r.turno, r.status, r.pessoasNoRdo, r.tarefas, r.executadas, r.equipParados, h(r.minParados), r.ocorrencias]))}
${aba('Tarefas', ['Data', 'Nº RDO', 'Pessoa', 'OS', 'TAG', 'Descrição', 'Tipo', 'Área', 'Execução (%)', 'Situação'],
    a.tarefas.map((t) => [fmtDate(t.data), t.rdo, t.pessoa, t.os, t.tag, t.descricao, t.tipo, t.area, t.execucao, t.execucao >= 100 ? 'Executada' : t.execucao > 0 ? 'Em andamento' : 'Não iniciada']))}
${aba('Equipamentos', ['Data', 'Nº RDO', 'Pessoa', 'Equipamento', 'Status', 'Horímetro início', 'Horímetro fim'],
    a.equipamentos.map((e) => [fmtDate(e.data), e.rdo, e.pessoa, e.equipamento, e.status, e.horimetroIni, e.horimetroFim]))}
${aba('Horas paradas', ['Data', 'Nº RDO', 'Pessoa', 'Início', 'Fim', 'Horas', 'Motivo', 'Observação'],
    a.paradas.map((p) => [fmtDate(p.data), p.rdo, p.pessoa, p.inicio, p.fim, h(p.minutos), p.motivo, p.obs]))}
${aba('Desvios', ['Data', 'Nº RDO', 'Pessoa', 'Hora', 'Tipo', 'Descrição', 'Local do desvio', 'Local do RDO'],
    a.ocorrencias.map((o) => [fmtDate(o.data), o.rdo, o.pessoa, o.hora, o.tipo, o.descricao, o.onde, o.local]))}
</Workbook>`;
    return new Blob(['﻿', xml], { type: 'application/vnd.ms-excel' });
  }

  function limpar() { cache = { chave: '', lista: [], doServidor: true }; erro = ''; }
  function aoEntrar() { if (!carregando) cache = { ...cache, chave: '' }; }

  return { tela, limpar, aoEntrar, levantar, planilha, topicos, pdfResumo };
})();
