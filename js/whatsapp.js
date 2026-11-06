/* Resumo do RDO em texto para envio por WhatsApp, no lugar do PDF. */
window.Whatsapp = (() => {
  'use strict';

  const fmtDate = (iso) => {
    const [a, m, d] = String(iso || '').slice(0, 10).split('-');
    return a ? `${d}/${m}/${a}` : '—';
  };

  const linha = (rotulo, valor) => (valor ? `${rotulo}: ${valor}` : null);

  /** Texto curto e legível no celular: sem tabelas, com marcadores simples. */
  function resumo(rdo) {
    const partes = [];

    partes.push(`*RELATÓRIO DIÁRIO DE OBRA*`);
    partes.push(`RDO ${rdo.number}`);
    // só o que foi preenchido; o contrato fixo saiu (a mina vai no Local)
    partes.push([fmtDate(rdo.date), rdo.shift && `Turno ${rdo.shift}`, rdo.weather].filter(Boolean).join(' · '));
    if (rdo.location) partes.push(`Local: ${rdo.location}`);
    if (rdo.startTime || rdo.endTime) partes.push(`Horário: ${rdo.startTime || '—'} às ${rdo.endTime || '—'}`);
    if (rdo.supervisor) partes.push(`Supervisor: ${rdo.supervisor}`);

    const presentes = rdo.workforce.filter((w) => w.status === 'Presente');
    if (presentes.length) {
      const comHoras = presentes.filter((w) => w.hours != null && w.hours !== '');
      const horas = comHoras.reduce((s, w) => s + (Number(w.hours) || 0), 0);
      partes.push('');
      // total de horas só quando alguém digitou horas
      partes.push(`*MÃO DE OBRA* (${presentes.length} presente${presentes.length > 1 ? 's' : ''}${comHoras.length ? ` · ${horas}h` : ''})`);
      presentes.forEach((w) => {
        const detalhe = [w.role, w.team].filter(Boolean).join(' · ');
        const horas = w.hours == null || w.hours === '' ? '' : ` (${Number(w.hours) || 0}h)`;
        partes.push(`• ${w.name}${detalhe ? ` — ${detalhe}` : ''}${horas}`);
      });
      const faltas = rdo.workforce.filter((w) => w.status !== 'Presente');
      if (faltas.length) partes.push(`Faltas: ${faltas.map((w) => w.name).join(', ')}`);
    }

    if (rdo.equipmentList.length) {
      partes.push('');
      partes.push(`*EQUIPAMENTOS* (${rdo.equipmentList.length})`);
      rdo.equipmentList.forEach((e) => {
        const horas = Math.max(0, (Number(e.hoursEnd) || 0) - (Number(e.hoursStart) || 0));
        const horimetro = e.hoursStart || e.hoursEnd ? ` · ${e.hoursStart ?? 0}h→${e.hoursEnd ?? 0}h (${horas}h)` : '';
        partes.push(`• ${e.name}${e.code ? ` (${e.code})` : ''} — ${e.status}${horimetro}`);
      });
    }

    if (rdo.tasks.length) {
      partes.push('');
      partes.push(`*ATIVIDADES REALIZADAS* (${rdo.tasks.length})`);
      rdo.tasks.forEach((t) => {
        // o campo já costuma vir como "OS-4472": evita "OS OS-4472"
        const etiqueta = t.os ? (/^os\b/i.test(t.os) ? `${t.os} — ` : `OS ${t.os} — `) : '';
        partes.push(`• ${etiqueta}${t.description} (${Number(t.progress) || 0}%)`);
      });
    }

    if (rdo.occurrences.length) {
      partes.push('');
      partes.push(`*OCORRÊNCIAS* (${rdo.occurrences.length})`);
      rdo.occurrences.forEach((o) => {
        const quando = [o.time, o.location].filter(Boolean).join(' · ');
        partes.push(`• ${o.type}: ${o.description}${quando ? ` (${quando})` : ''}`);
      });
    }

    if (rdo.photos.length) {
      partes.push('');
      partes.push(`Fotos anexadas no sistema: ${rdo.photos.length}`);
    }

    if (rdo.notes) {
      partes.push('');
      partes.push(`*OBSERVAÇÕES*`);
      partes.push(rdo.notes);
    }

    return partes.join('\n');
  }

  /** Abre o WhatsApp com o resumo. Número vazio abre o seletor de contato. */
  function enviar(rdo, telefone = '') {
    const texto = encodeURIComponent(resumo(rdo));
    const numero = String(telefone || '').replace(/\D/g, '');
    const url = numero
      ? `https://wa.me/${numero}?text=${texto}`
      : `https://wa.me/?text=${texto}`;
    if (window.Capacitor?.isNativePlatform?.()) {
      // no APK o WebView não abre janela nova: navegar para o link faz o Capacitor chamar o WhatsApp por intent
      window.location.href = url;
    } else {
      window.open(url, '_blank', 'noopener');
    }
    return url;
  }

  async function copiar(rdo) {
    const texto = resumo(rdo);
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      const area = document.createElement('textarea');
      area.value = texto;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      area.remove();
      // a área de transferência é bloqueada em alguns contextos (iframe sem
      // permissão, http). Aí devolvemos o texto para o usuário copiar à mão.
      return ok ? true : texto;
    }
  }

  return { resumo, enviar, copiar };
})();
