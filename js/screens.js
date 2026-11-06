/* Telas do RDO. Cada tela recebe o RDO aberto e devolve HTML + liga eventos. */
window.Screens = (() => {
  'use strict';

  const { icon, esc, fmtDate, toast, sheet, confirmar } = UI;

  let app = null; // preenchido em boot()

  const TITULOS = {
    home: 'Selecione a Ação',
    header: 'Cabeçalho do RDO',
    workforce: 'Mão de Obra',
    equipment: 'Equipamentos',
    tasks: 'Tarefas Realizadas',
    occurrences: 'Ocorrências',
    photos: 'Fotos do RDO',
    report: 'Gerar Relatório',
    reports: 'Apagar Relatórios',
  };

  // -------------------------------------------------------------- início

  function home(rdo) {
    // depois de apagar todos os relatórios não há RDO aberto: as seções criam um ao entrar
    const contagem = (lista) => {
      const n = rdo ? rdo[lista].length : 0;
      return n ? `<span class="badge-count">${n}</span>` : '';
    };
    const recentes = Store.recentes;

    return {
      titulo: TITULOS.home,
      html: `
        <img class="logo-inhaus" src="${window.Logo.src}" alt="In-Haus industrial" width="${window.Logo.largura}" height="${window.Logo.altura}" />
        <h1 class="screen-title">Selecione a Ação</h1>
        <div class="action-grid">
          <button class="action-card" data-go="header">${icon('file')}Cabeçalho do RDO</button>
          <button class="action-card" data-go="workforce">${icon('users')}Mão de Obra${contagem('workforce')}</button>
          <button class="action-card" data-go="equipment">${icon('truck')}Equipamentos${contagem('equipmentList')}</button>
          <button class="action-card" data-go="tasks">${icon('clipboard')}Tarefas Realizadas${contagem('tasks')}</button>
          <button class="action-card" data-go="occurrences">${icon('alert')}Ocorrências${contagem('occurrences')}</button>
          <button class="action-card" data-go="photos">${icon('camera')}Fotos do RDO${contagem('photos')}</button>
          <button class="action-card wide" data-go="report">${icon('output', 22)}Gerar Relatório</button>
          <button class="action-card wide danger-card" data-go="reports">${icon('trash', 20)}Apagar Relatórios</button>
        </div>

        <div class="history">
          <div class="head">
            <span class="label">Histórico Recente</span>
            <button class="btn ghost" data-act="novo" style="padding:6px 10px;font-size:11.5px">${icon('plus', 14)}Novo RDO</button>
          </div>
          ${recentes.length === 0
            ? '<div class="empty">Nenhum RDO registrado ainda.</div>'
            : recentes.map((r) => `
              <button class="row" data-open="${esc(r.id)}">
                <div class="grow">
                  <div class="num">${esc(r.number)}</div>
                  <div class="meta">${fmtDate(r.date)} · ${esc(r.location || 'Sem local')}</div>
                </div>
                <span class="arrow">${icon('chevron', 16)}</span>
              </button>`).join('')}
        </div>`,
      bind(root) {
        root.querySelectorAll('[data-go]').forEach((b) => {
          b.addEventListener('click', () => app.go(b.dataset.go));
        });
        root.querySelector('[data-act="novo"]')?.addEventListener('click', () => {
          const novo = Store.createRdo();
          app.abrir(novo.id);
          toast('Novo RDO criado.');
        });
        root.querySelectorAll('[data-open]').forEach((b) => {
          b.addEventListener('click', () => app.abrir(b.dataset.open, true));
        });
      },
    };
  }

  // -------------------------------------------------------------- cabeçalho

  // lista sem nada marcado: o primeiro item é vazio e quem preenche escolhe
  const opcoes = (lista, atual) => [`<option value=""${atual ? '' : ' selected'}>Selecione</option>`,
    ...lista.map((v) => `<option value="${esc(v)}"${v === atual ? ' selected' : ''}>${esc(v)}</option>`)].join('');

  function header(rdo) {
    return {
      titulo: TITULOS.header,
      html: `
        <div class="form-grid">
          <div class="field full">
            <label>Nº RDO</label>
            <input type="text" value="${esc(rdo.number)}" readonly>
          </div>
          <div class="field full">
            <label for="h-date">Data</label>
            <input id="h-date" type="date" value="${esc(rdo.date)}" data-key="date">
          </div>
          <div class="field full">
            <label for="h-location">Local / Mina</label>
            <input id="h-location" type="text" value="${esc(rdo.location)}" data-key="location" placeholder="Digite a mina e o local onde está" autocomplete="off" maxlength="120">
          </div>
          <div class="field">
            <label for="h-shift">Turno</label>
            <select id="h-shift" data-key="shift">${opcoes(['A', 'B', 'C', 'ADM'], rdo.shift)}</select>
          </div>
          <div class="field">
            <label for="h-weather">Clima</label>
            <select id="h-weather" data-key="weather">${opcoes(['Sol', 'Nublado', 'Chuva'], rdo.weather)}</select>
          </div>
          <div class="field">
            <label for="h-start">Início</label>
            <input id="h-start" type="time" value="${esc(rdo.startTime)}" data-key="startTime">
          </div>
          <div class="field">
            <label for="h-end">Término</label>
            <input id="h-end" type="time" value="${esc(rdo.endTime)}" data-key="endTime">
          </div>
          <div class="field full">
            <label for="h-sup">Supervisor</label>
            <input id="h-sup" type="text" value="${esc(rdo.supervisor)}" data-key="supervisor" placeholder="Nome do supervisor">
          </div>
          <div class="field full">
            <label for="h-notes">Observações Gerais</label>
            <textarea id="h-notes" data-key="notes" placeholder="Condições, liberações, observações do dia">${esc(rdo.notes)}</textarea>
          </div>
        </div>
        <button class="btn primary block" data-act="salvar" style="margin-top:4px">Salvar Cabeçalho</button>`,
      bind(root) {
        root.querySelector('[data-act="salvar"]').addEventListener('click', () => {
          const ler = (k) => root.querySelector(`[data-key="${k}"]`);
          Store.update(rdo.id, (d) => {
            d.date = ler('date').value;
            // contrato fixo saiu: a mina/obra vai no Local, digitado à mão
            d.contractId = '';
            d.contractName = '';
            d.location = ler('location').value.trim();
            d.shift = ler('shift').value;
            d.weather = ler('weather').value;
            d.startTime = ler('startTime').value;
            d.endTime = ler('endTime').value;
            d.supervisor = ler('supervisor').value;
            d.notes = ler('notes').value;
          });
          toast('Cabeçalho salvo com sucesso');
          app.voltar();
        });
      },
    };
  }

  // -------------------------------------------------------------- mão de obra

  function workforce(rdo) {
    const presentes = rdo.workforce.filter((w) => w.status === 'Presente').length;
    return {
      titulo: TITULOS.workforce,
      html: `
        <div class="counter">
          <div><div class="n">${presentes}</div><div class="t">presente(s) de ${rdo.workforce.length}</div></div>
          <button class="btn primary" data-act="add">${icon('plus', 16)}Adicionar</button>
        </div>
        ${rdo.workforce.length === 0
          ? '<div class="empty-state">Nenhuma pessoa registrada.<br>Use <strong>Adicionar</strong> para incluir a equipe do dia.</div>'
          : rdo.workforce.map((w) => `
            <div class="card">
              <div class="body">
                <div class="name">${esc(w.name)}</div>
                <div class="sub">${esc(w.role || '—')} • ${esc(w.team || '—')} · ${w.hours == null || w.hours === '' ? '—' : `${Number(w.hours) || 0}h`}</div>
              </div>
              <span class="badge ${w.status === 'Presente' ? 'green' : 'red'}">${esc(w.status)}</span>
              <button class="del" data-del="${esc(w.id)}" aria-label="Remover">${icon('trash', 17)}</button>
            </div>`).join('')}`,
      bind(root) {
        root.querySelector('[data-act="add"]').addEventListener('click', async () => {
          // tudo digitado: sem cadastro de pessoas e sem presença ou horas marcadas
          const valores = await sheet({
            title: 'Adicionar pessoa',
            fields: [
              { key: 'name', label: 'Nome', placeholder: 'Nome completo' },
              { key: 'role', label: 'Função', placeholder: 'Função' },
              { key: 'team', label: 'Equipe', placeholder: 'Equipe' },
              { key: 'status', label: 'Presença', type: 'select', options: [{ value: '', label: 'Selecione' }, 'Presente', 'Falta'] },
              { key: 'hours', label: 'Horas', type: 'number', placeholder: 'Horas trabalhadas' },
            ],
            submit: 'Adicionar',
          });
          if (!valores) return;
          if (!valores.name) { toast('Informe o nome.'); return; }
          if (!valores.status) { toast('Informe a presença.'); return; }
          Store.update(rdo.id, (d) => {
            d.workforce.push({
              id: Store.uid(),
              name: valores.name,
              role: valores.role || '',
              team: valores.team || '',
              status: valores.status,
              hours: valores.status === 'Falta' ? 0 : (valores.hours === '' ? null : Number(valores.hours) || 0),
            });
          });
          toast('Mão de obra atualizada.');
          app.render();
        });

        root.querySelectorAll('[data-del]').forEach((b) => {
          b.addEventListener('click', async () => {
            const ok = await confirmar('Remover pessoa', 'Remover este registro de mão de obra?');
            if (!ok) return;
            Store.update(rdo.id, (d) => { d.workforce = d.workforce.filter((w) => w.id !== b.dataset.del); });
            app.render();
          });
        });
      },
    };
  }

  // -------------------------------------------------------------- equipamentos

  function equipment(rdo) {
    const badge = (s) => (s === 'Operando' ? 'green' : s === 'Manutenção' ? 'amber' : 'red');
    const horas = (v) => (v == null || v === '' ? '—' : `${v}h`);
    return {
      titulo: TITULOS.equipment,
      html: `
        <button class="btn primary block" data-act="add">${icon('plus', 16)}Equipamento</button>
        ${rdo.equipmentList.length === 0
          ? '<div class="empty-state">Nenhum equipamento no relatório.<br>Toque em <strong>Equipamento</strong> para incluir.</div>'
          : rdo.equipmentList.map((e, i) => `
            <div class="card">
              <div class="body">
                <div class="name">${esc(e.name)}</div>
                <div class="sub">${esc(e.code || 'sem código')} · horímetro ${horas(e.hoursStart)} → ${horas(e.hoursEnd)}</div>
              </div>
              <span class="badge ${badge(e.status)}">${esc(e.status)}</span>
              <button class="del" data-del="${i}" aria-label="Remover">${icon('trash', 17)}</button>
            </div>`).join('')}`,
      bind(root) {
        root.querySelector('[data-act="add"]').addEventListener('click', async () => {
          // tudo digitado: sem cadastro de equipamentos, status e horímetro em branco
          const valores = await sheet({
            title: 'Equipamento',
            fields: [
              { key: 'name', label: 'Equipamento', placeholder: 'Nome do equipamento' },
              { key: 'code', label: 'Código / patrimônio', placeholder: 'Código' },
              { key: 'status', label: 'Status', type: 'select', options: [{ value: '', label: 'Selecione' }, 'Operando', 'Parado', 'Manutenção'] },
              { key: 'hoursStart', label: 'Horímetro inicial', type: 'number', placeholder: 'Horímetro inicial' },
              { key: 'hoursEnd', label: 'Horímetro final', type: 'number', placeholder: 'Horímetro final' },
            ],
            submit: 'Adicionar',
          });
          if (!valores) return;
          if (!valores.name) { toast('Informe o equipamento.'); return; }
          if (!valores.status) { toast('Informe o status do equipamento.'); return; }
          const horimetro = (v) => (v === '' ? null : Number(v) || 0);
          Store.update(rdo.id, (d) => {
            d.equipmentList.push({
              name: valores.name,
              code: valores.code || '',
              status: valores.status,
              hoursStart: horimetro(valores.hoursStart),
              hoursEnd: horimetro(valores.hoursEnd),
            });
          });
          toast('Equipamento adicionado.');
          app.render();
        });

        root.querySelectorAll('[data-del]').forEach((b) => {
          b.addEventListener('click', async () => {
            const ok = await confirmar('Remover equipamento', 'Remover este equipamento do relatório?');
            if (!ok) return;
            Store.update(rdo.id, (d) => { d.equipmentList.splice(Number(b.dataset.del), 1); });
            app.render();
          });
        });
      },
    };
  }

  // -------------------------------------------------------------- tarefas

  function tasks(rdo) {
    return {
      titulo: TITULOS.tasks,
      html: `
        <button class="btn dashed block" data-act="add">${icon('plus', 16)}Registrar Nova Tarefa</button>
        ${rdo.tasks.length === 0
          ? '<div class="empty-state">Nenhuma tarefa registrada.<br>Use <strong>Registrar Nova Tarefa</strong>.</div>'
          : rdo.tasks.map((t, i) => {
            const done = Number(t.progress) >= 100;
            return `
            <div class="card task-card ${done ? 'done' : ''}">
              <div class="body">
                <div class="name">${esc(t.description)}</div>
                <div class="sub">${t.os ? `OS ${esc(t.os)} · ` : ''}${t.area ? `${esc(t.area)} · ` : ''}${Number(t.progress) || 0}%</div>
                <div class="progress"><span style="width:${Math.max(0, Math.min(100, Number(t.progress) || 0))}%"></span></div>
              </div>
              <span class="badge ${done ? 'green' : 'amber'}">${esc(t.status || (done ? 'Concluído' : 'Em Andamento'))}</span>
              <button class="del" data-del="${i}" aria-label="Remover">${icon('trash', 17)}</button>
            </div>`;
          }).join('')}`,
      bind(root) {
        root.querySelector('[data-act="add"]').addEventListener('click', async () => {
          const valores = await sheet({
            title: 'Registrar Nova Tarefa',
            fields: [
              { key: 'description', label: 'Descrição', type: 'textarea', placeholder: 'O que foi executado' },
              { key: 'os', label: 'Nº da OS', placeholder: 'Opcional' },
              { key: 'progress', label: 'Execução (%)', type: 'number', placeholder: 'De 0 a 100' },
              { key: 'area', label: 'Área', placeholder: 'Área' },
            ],
            submit: 'Registrar',
          });
          if (!valores) return;
          const desc = String(valores.description || '').trim();
          if (!desc) { toast('Informe a descrição da tarefa.'); return; }
          if (valores.progress === '') { toast('Informe a execução (%).'); return; }
          const bruto = valores.progress;
          const progresso = Math.max(0, Math.min(100, Number.isFinite(bruto) ? bruto : 0));
          Store.update(rdo.id, (d) => {
            d.tasks.push({
              os: valores.os || '',
              description: desc,
              progress: progresso,
              area: valores.area || '',
              status: progresso >= 100 ? 'Concluído' : 'Em Andamento',
            });
          });
          toast('Tarefa registrada.');
          app.render();
        });

        root.querySelectorAll('[data-del]').forEach((b) => {
          b.addEventListener('click', async () => {
            const ok = await confirmar('Remover tarefa', 'Remover esta tarefa do relatório?');
            if (!ok) return;
            Store.update(rdo.id, (d) => { d.tasks.splice(Number(b.dataset.del), 1); });
            app.render();
          });
        });
      },
    };
  }

  // -------------------------------------------------------------- ocorrências

  function occurrences(rdo) {
    return {
      titulo: TITULOS.occurrences,
      html: `
        <button class="btn danger block" data-act="add">${icon('plus', 16)}Registrar Ocorrência</button>
        ${rdo.occurrences.length === 0
          ? '<div class="empty-state">Nenhuma ocorrência registrada.</div>'
          : rdo.occurrences.map((o, i) => `
            <div class="card">
              <div class="body">
                <div class="name">${esc(o.description)}</div>
                <div class="sub">${esc([o.time, o.location].filter(Boolean).join(' · ') || '—')}</div>
              </div>
              <span class="badge red">${esc(o.type || '—')}</span>
              <button class="del" data-del="${i}" aria-label="Remover">${icon('trash', 17)}</button>
            </div>`).join('')}`,
      bind(root) {
        root.querySelector('[data-act="add"]').addEventListener('click', async () => {
          const valores = await sheet({
            title: 'Registrar Ocorrência',
            fields: [
              { key: 'type', label: 'Tipo', type: 'select', options: [{ value: '', label: 'Selecione' }, 'Segurança', 'Equipamento', 'Clima', 'Outros'] },
              { key: 'description', label: 'Descrição', type: 'textarea', placeholder: 'O que aconteceu' },
              { key: 'time', label: 'Hora', type: 'time' },
              { key: 'location', label: 'Local', placeholder: 'Onde aconteceu' },
            ],
            submit: 'Registrar',
          });
          if (!valores) return;
          if (!valores.type) { toast('Informe o tipo da ocorrência.'); return; }
          const desc = String(valores.description || '').trim();
          if (!desc) { toast('Informe a descrição da ocorrência.'); return; }
          Store.update(rdo.id, (d) => {
            d.occurrences.push({
              type: valores.type,
              description: desc,
              time: valores.time || '',
              location: valores.location || '',
            });
          });
          toast('Ocorrência registrada.');
          app.render();
        });

        root.querySelectorAll('[data-del]').forEach((b) => {
          b.addEventListener('click', async () => {
            const ok = await confirmar('Remover ocorrência', 'Remover esta ocorrência?');
            if (!ok) return;
            Store.update(rdo.id, (d) => { d.occurrences.splice(Number(b.dataset.del), 1); });
            app.render();
          });
        });
      },
    };
  }

  // -------------------------------------------------------------- fotos

  function photos(rdo) {
    return {
      titulo: TITULOS.photos,
      html: `
        <button class="btn primary block" data-act="tirar">${icon('camera', 18)}Tirar Foto</button>
        <input type="file" accept="image/*" capture="environment" id="camera-input" hidden>
        <p style="font-size:11.5px;color:var(--text-soft);line-height:1.5;margin:0">
          Cada foto recebe carimbo de data, hora e GPS (quando o aparelho permite).
        </p>
        ${rdo.photos.length === 0
          ? '<div class="empty-state">Nenhuma foto anexada.</div>'
          : `<div class="photo-grid">${rdo.photos.map((p, i) => `
              <figure class="photo">
                <img src="${p.data}" alt="${esc(p.desc || 'Foto do RDO')}">
                ${p.latitude != null ? `<span class="gps">${icon('gps', 9)} GPS</span>` : ''}
                <button class="rm" data-del="${i}" aria-label="Remover foto">${icon('trash', 13)}</button>
                <figcaption class="cap">${esc(p.desc || fmtDate(p.date) + ' ' + (p.time || ''))}</figcaption>
              </figure>`).join('')}</div>`}`,
      bind(root) {
        const input = root.querySelector('#camera-input');
        root.querySelector('[data-act="tirar"]').addEventListener('click', () => input.click());

        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          input.value = '';
          if (!file) return;

          const desc = await sheet({
            title: 'Descrição da foto',
            fields: [{ key: 'desc', label: 'Descrição (opcional)', placeholder: 'Ex.: frente de serviço liberada' }],
            submit: 'Anexar',
          });
          if (desc === null) return;

          let coords = null;
          try {
            coords = await new Promise((resolve) => {
              if (!navigator.geolocation) return resolve(null);
              navigator.geolocation.getCurrentPosition(
                (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
                () => resolve(null),
                { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 },
              );
            });
          } catch { coords = null; }

          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const agora = new Date();
          const salvo = Store.update(rdo.id, (d) => {
            d.photos.push({
              data: dataUrl,
              desc: desc.desc || '',
              timestamp: agora.toISOString(),
              date: Store.todayIso(),
              time: `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`,
              latitude: coords?.latitude ?? null,
              longitude: coords?.longitude ?? null,
            });
          });
          if (!salvo) toast('Armazenamento cheio: a foto não foi salva. Remova fotos antigas.');
          else toast('Foto anexada.');
          app.render();
        });

        root.querySelectorAll('[data-del]').forEach((b) => {
          b.addEventListener('click', async () => {
            const ok = await confirmar('Remover foto', 'Remover esta foto do relatório?');
            if (!ok) return;
            Store.update(rdo.id, (d) => { d.photos.splice(Number(b.dataset.del), 1); });
            app.render();
          });
        });
      },
    };
  }

  // -------------------------------------------------------------- relatório

  function report(rdo) {
    const somaHoras = rdo.equipmentList.reduce((s, e) => s + Math.max(0, (Number(e.hoursEnd) || 0) - (Number(e.hoursStart) || 0)), 0);
    return {
      titulo: TITULOS.report,
      html: `
        <div class="summary">
          <div class="box"><div class="n">${rdo.workforce.length}</div><div class="t">Mão de obra</div></div>
          <div class="box"><div class="n">${rdo.equipmentList.length}</div><div class="t">Equipamentos</div></div>
          <div class="box"><div class="n">${rdo.tasks.length}</div><div class="t">Tarefas</div></div>
          <div class="box"><div class="n">${rdo.photos.length}</div><div class="t">Fotos</div></div>
        </div>

        <div class="info-list">
          <div class="li"><span class="k">RDO</span><span class="v">${esc(rdo.number)}</span></div>
          <div class="li"><span class="k">Data</span><span class="v">${fmtDate(rdo.date)}${rdo.shift ? ` · turno ${esc(rdo.shift)}` : ''}</span></div>
          <div class="li"><span class="k">Local / Mina</span><span class="v">${esc(rdo.location || '—')}</span></div>
          <div class="li"><span class="k">Clima</span><span class="v">${esc(rdo.weather || '—')}</span></div>
          <div class="li"><span class="k">Supervisor</span><span class="v">${esc(rdo.supervisor || '—')}</span></div>
          <div class="li"><span class="k">Horas de equipamento</span><span class="v">${somaHoras}h</span></div>
          <div class="li"><span class="k">Ocorrências</span><span class="v">${rdo.occurrences.length}</span></div>
        </div>

        <button class="btn primary block" data-act="pdf">${icon('download', 18)}Baixar PDF</button>
        <button class="btn block" data-act="whats" style="background:#25D366;color:#fff">${icon('whatsapp', 18)}Enviar por WhatsApp</button>
        <button class="btn ghost block" data-act="copiar">${icon('copy', 16)}Copiar resumo em texto</button>`,
      bind(root) {
        root.querySelector('[data-act="pdf"]').addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            await window.Pdf.gerar(rdo);
            toast(`RDO_${rdo.number}.pdf gerado.`);
          } catch (err) {
            toast('Não foi possível gerar o PDF.');
          } finally {
            btn.disabled = false;
          }
        });

        root.querySelector('[data-act="whats"]').addEventListener('click', async () => {
          const valores = await sheet({
            title: 'Enviar por WhatsApp',
            text: 'O texto resumido do RDO será aberto no WhatsApp. Deixe o número em branco para escolher o contato no aplicativo.',
            fields: [
              { key: 'telefone', label: 'Número com DDD (opcional)', placeholder: 'Ex.: 18997123456' },
            ],
            submit: 'Abrir WhatsApp',
          });
          if (!valores) return;
          Whatsapp.enviar(rdo, valores.telefone || '');
          toast('Resumo aberto no WhatsApp.');
        });

        root.querySelector('[data-act="copiar"]').addEventListener('click', async () => {
          const resultado = await Whatsapp.copiar(rdo);
          if (resultado === true) { toast('Resumo copiado.'); return; }
          // sem acesso à área de transferência: mostra o texto para copiar à mão
          await sheet({
            title: 'Copie o resumo',
            fields: [{ key: 'texto', label: 'Resumo do RDO', type: 'textarea', value: resultado }],
            submit: 'Fechar',
          });
        });
      },
    };
  }

  // -------------------------------------------------------------- apagar relatórios

  const fmtTamanho = (bytes) => (bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`);

  function reports() {
    const lista = Store.rdos;
    return {
      titulo: TITULOS.reports,
      html: `
        <div class="aviso-perigo">
          Apagar um relatório remove cabeçalho, equipe, equipamentos, tarefas, ocorrências e fotos dele.
          <strong>A exclusão é definitiva:</strong> não há lixeira. Baixe o PDF antes, se precisar.
        </div>
        <div class="section-label">${lista.length} relatório(s) salvo(s) · ${fmtTamanho(Store.tamanho())} ocupados</div>
        ${lista.length === 0
          ? '<div class="empty-state">Nenhum relatório salvo neste aparelho.</div>'
          : lista.map((r) => `
            <div class="card">
              <div class="body">
                <div class="name">RDO ${esc(r.number)}</div>
                <div class="sub">${fmtDate(r.date)} · ${esc(r.location || 'Sem local')}</div>
                <div class="sub">${r.tasks.length} tarefa(s) · ${r.occurrences.length} ocorrência(s) · ${r.photos.length} foto(s)</div>
              </div>
              <button class="del del-rdo" data-del="${esc(r.id)}" aria-label="Apagar RDO ${esc(r.number)}">${icon('trash', 20)}</button>
            </div>`).join('')}`,
      bind(root) {
        root.querySelectorAll('[data-del]').forEach((b) => {
          b.addEventListener('click', async () => {
            const rdo = Store.find(b.dataset.del);
            if (!rdo) return;
            const fotos = rdo.photos.length ? ` e as ${rdo.photos.length} foto(s) dele` : '';
            const ok = await confirmar(
              'Apagar relatório',
              `Apagar o RDO ${rdo.number} de ${fmtDate(rdo.date)}${fotos}? A exclusão é definitiva e não pode ser desfeita.`,
              'Apagar',
            );
            if (!ok) return;
            if (!Store.remove(rdo.id)) { toast('Não foi possível apagar o relatório.'); return; }
            toast(`RDO ${rdo.number} apagado.`);
            app.render();
          });
        });
      },
    };
  }

  const mapa = { home, header, workforce, equipment, tasks, occurrences, photos, report, reports };

  return {
    boot(appRef) { app = appRef; },
    get(tela) { return mapa[tela] || home; },
    TITULOS,
  };
})();
