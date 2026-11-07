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
    backup: 'Cópia de Segurança',
    roster: 'Cadastro da Equipe',
    stops: 'Horas Paradas',
    month: 'Resumo do Mês',
  };

  // -------------------------------------------------------------- filtro dos RDOs

  const TIPOS = ['Preventiva', 'Corretiva', 'Backlog'];
  const CORES_TIPO = { Preventiva: 'green', Corretiva: 'red', Backlog: 'amber' };

  // vale para o início e para a tela de apagar; fica enquanto o app está aberto.
  // O tipo acha o RDO pelo tipo dele ou pelo de qualquer tarefa dele.
  const filtro = { data: '', tipo: '' };
  const temTipo = (r, tipo) => r.maintenanceType === tipo || (r.tasks || []).some((t) => t.maintenanceType === tipo);
  const filtrar = (lista) => lista.filter((r) =>
    (!filtro.data || r.date === filtro.data) && (!filtro.tipo || temTipo(r, filtro.tipo)));

  // serve para o RDO e para a tarefa (os dois têm maintenanceType)
  const seloTipo = (r) => (r.maintenanceType
    ? `<span class="badge ${CORES_TIPO[r.maintenanceType] || 'gray'}">${esc(r.maintenanceType)}</span>` : '');

  // -------------------------------------------------------------- RDO finalizado

  // finalizado fica só para leitura: some adicionar, remover, copiar e salvar
  const travado = (rdo) => rdo?.status === 'final';
  const fmtDataHora = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const dd = (n) => String(n).padStart(2, '0');
    return `${dd(d.getDate())}/${dd(d.getMonth() + 1)}/${d.getFullYear()} ${dd(d.getHours())}:${dd(d.getMinutes())}`;
  };
  const avisoTravado = (rdo) => `
    <div class="aviso-final">${icon('lock', 16)}<span>RDO finalizado${rdo.finalizedAt ? ` em ${fmtDataHora(rdo.finalizedAt)}` : ''}.
      Para mudar, reabra em <strong>Gerar Relatório</strong>.</span></div>`;

  /** RDO anterior (pelo número) que tem algo nessa lista, para copiar equipe ou equipamentos. */
  const rdoAnterior = (rdo, lista) => Store.rdos
    .filter((r) => r.id !== rdo.id && r[lista]?.length && String(r.number) < String(rdo.number))
    .sort((a, b) => String(b.number).localeCompare(String(a.number)))[0] || null;

  function filtroHtml() {
    return `
      <div class="filtro">
        <div class="field">
          <label for="f-data">Selecione a data</label>
          <input id="f-data" type="date" value="${esc(filtro.data)}" data-filtro="data">
        </div>
        <div class="field">
          <label for="f-tipo">Tipo</label>
          <select id="f-tipo" data-filtro="tipo">
            <option value="">Todos</option>
            ${TIPOS.map((t) => `<option value="${t}"${t === filtro.tipo ? ' selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
      </div>`;
  }

  /** Liga o filtro: a cada mudança só a lista é redesenhada (a tela não pula para o topo). */
  function ligarFiltro(root, redesenhar) {
    root.querySelectorAll('[data-filtro]').forEach((campo) => {
      campo.addEventListener('change', () => {
        filtro[campo.dataset.filtro] = campo.value;
        redesenhar();
      });
    });
  }

  const resumoFiltro = (n) => {
    const partes = [filtro.data && fmtDate(filtro.data), filtro.tipo].filter(Boolean).join(' · ');
    return partes ? `${n} RDO(s) em ${partes}` : `${n} RDO(s)`;
  };

  // -------------------------------------------------------------- início

  function home(rdo) {
    // depois de apagar todos os relatórios não há RDO aberto: as seções criam um ao entrar
    const contagem = (lista) => {
      const n = rdo ? (rdo[lista] || []).length : 0;
      return n ? `<span class="badge-count">${n}</span>` : '';
    };
    // lista dos RDOs: filtrada por data e tipo; sem filtro, os 20 mais recentes
    const LIMITE = 20;
    const listaHtml = () => {
      const achados = filtrar(Store.rdos);
      const filtrando = filtro.data || filtro.tipo;
      const mostrados = filtrando ? achados : achados.slice(0, LIMITE);
      if (!achados.length) {
        return `<div class="empty">${filtrando ? 'Nenhum RDO nesta data/tipo.' : 'Nenhum RDO registrado ainda.'}</div>`;
      }
      return `
        <div class="contagem">${resumoFiltro(achados.length)}${!filtrando && achados.length > LIMITE ? ` · mostrando os ${LIMITE} mais recentes` : ''}</div>
        ${mostrados.map((r) => `
          <button class="row" data-open="${esc(r.id)}">
            <div class="grow">
              <div class="num">RDO ${esc(r.number)}</div>
              <div class="meta">${fmtDate(r.date)} · ${esc(r.location || 'Sem local')}</div>
            </div>
            ${seloTipo(r)}
            <span class="arrow">${icon('chevron', 16)}</span>
          </button>`).join('')}`;
    };

    return {
      titulo: TITULOS.home,
      html: `
        <img class="logo-inhaus" src="${window.Logo.src}" alt="In-Haus industrial" width="${window.Logo.largura}" height="${window.Logo.altura}" />
        <h1 class="screen-title">Selecione a Ação</h1>
        ${rdo ? `<div class="rdo-aberto">RDO aberto: <strong>${esc(rdo.number)}</strong> · ${fmtDate(rdo.date)}${rdo.maintenanceType ? ` · ${esc(rdo.maintenanceType)}` : ''}</div>` : ''}
        <div class="action-grid">
          <button class="action-card" data-go="header">${icon('file')}Cabeçalho do RDO</button>
          <button class="action-card" data-go="workforce">${icon('users')}Mão de Obra${contagem('workforce')}</button>
          <button class="action-card" data-go="equipment">${icon('truck')}Equipamentos${contagem('equipmentList')}</button>
          <button class="action-card" data-go="tasks">${icon('clipboard')}Tarefas Realizadas${contagem('tasks')}</button>
          <button class="action-card" data-go="occurrences">${icon('alert')}Ocorrências${contagem('occurrences')}</button>
          <button class="action-card" data-go="stops">${icon('clock')}Horas Paradas${contagem('stoppages')}</button>
          <button class="action-card" data-go="photos">${icon('camera')}Fotos do RDO${contagem('photos')}</button>
          <button class="action-card" data-go="month">${icon('chart')}Resumo do Mês</button>
          <button class="action-card wide" data-go="report">${icon('output', 22)}Gerar Relatório</button>
          <button class="action-card wide neutro-card" data-go="backup">${icon('shield', 20)}Cópia de Segurança</button>
          <button class="action-card wide danger-card" data-go="reports">${icon('trash', 20)}Apagar Relatórios</button>
        </div>

        <div class="history">
          <div class="head">
            <span class="label">Relatórios</span>
            <button class="btn ghost" data-act="novo" style="padding:6px 10px;font-size:11.5px">${icon('plus', 14)}Novo RDO</button>
          </div>
          ${filtroHtml()}
          <div id="lista-rdo">${listaHtml()}</div>
        </div>`,
      bind(root) {
        root.querySelectorAll('[data-go]').forEach((b) => {
          b.addEventListener('click', () => app.go(b.dataset.go));
        });
        root.querySelector('[data-act="novo"]')?.addEventListener('click', () => {
          const novo = Store.createRdo();
          app.abrir(novo.id);
          toast(`Novo RDO ${novo.number} criado.`);
        });
        const lista = root.querySelector('#lista-rdo');
        const ligarLinhas = () => lista.querySelectorAll('[data-open]').forEach((b) => {
          b.addEventListener('click', () => {
            app.abrir(b.dataset.open);
            const aberto = Store.find(b.dataset.open);
            if (aberto) toast(`RDO ${aberto.number} aberto.`);
          });
        });
        ligarLinhas();
        ligarFiltro(root, () => { lista.innerHTML = listaHtml(); ligarLinhas(); });
      },
    };
  }

  // -------------------------------------------------------------- cabeçalho

  // lista sem nada marcado: o primeiro item é vazio e quem preenche escolhe
  const opcoes = (lista, atual) => [`<option value=""${atual ? '' : ' selected'}>Selecione</option>`,
    ...lista.map((v) => `<option value="${esc(v)}"${v === atual ? ' selected' : ''}>${esc(v)}</option>`)].join('');

  function header(rdo) {
    const trava = travado(rdo);
    return {
      titulo: TITULOS.header,
      html: `
        ${trava ? avisoTravado(rdo) : ''}
        <fieldset class="campos"${trava ? ' disabled' : ''}>
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
            <label for="h-tipo">Tipo de manutenção</label>
            <select id="h-tipo" data-key="maintenanceType">${opcoes(TIPOS, rdo.maintenanceType)}</select>
          </div>
          <div class="field full">
            <label for="h-location">Local / Mina</label>
            <input id="h-location" type="text" value="${esc(rdo.location)}" data-key="location" placeholder="Digite a mina e o local onde está" autocomplete="off" maxlength="120">
          </div>
          <div class="field">
            <label for="h-shift">Turno</label>
            <select id="h-shift" data-key="shift">${opcoes(['A', 'B', 'C', 'D', 'ADM'], rdo.shift)}</select>
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
            <textarea id="h-notes" data-key="notes" data-ditado placeholder="Condições, liberações, observações do dia">${esc(rdo.notes)}</textarea>
          </div>
        </div>
        </fieldset>
        ${trava ? '' : '<button class="btn primary block" data-act="salvar" style="margin-top:4px">Salvar Cabeçalho</button>'}`,
      bind(root) {
        root.querySelector('[data-act="salvar"]')?.addEventListener('click', () => {
          const ler = (k) => root.querySelector(`[data-key="${k}"]`);
          const novaData = ler('date').value;
          let renumerado = null;
          const salvo = Store.update(rdo.id, (d) => {
            // data vazia não apaga a data; data nova troca o número para o daquele dia
            if (novaData && novaData !== d.date) {
              d.date = novaData;
              if (!String(d.number).startsWith(`${novaData.replace(/-/g, '')}-`)) {
                d.number = Store.numeroPara(novaData);
                renumerado = d.number;
              }
            }
            // contrato fixo saiu: a mina/obra vai no Local, digitado à mão
            d.contractId = '';
            d.contractName = '';
            d.maintenanceType = ler('maintenanceType').value;
            d.location = ler('location').value.trim();
            d.shift = ler('shift').value;
            d.weather = ler('weather').value;
            d.startTime = ler('startTime').value;
            d.endTime = ler('endTime').value;
            d.supervisor = ler('supervisor').value;
            d.notes = ler('notes').value;
          });
          if (!salvo) { toast('Não foi possível salvar: o aparelho está sem espaço.'); return; }
          toast(renumerado ? `Cabeçalho salvo. Com a data nova o RDO passou a ser ${renumerado}.` : 'Cabeçalho salvo com sucesso');
          app.voltar();
        });
      },
    };
  }

  // -------------------------------------------------------------- mão de obra

  // botão de copiar do RDO anterior (só aparece quando há de onde copiar)
  const botaoCopiar = (rdo, lista, rotulo) => {
    const anterior = travado(rdo) ? null : rdoAnterior(rdo, lista);
    return anterior
      ? `<button class="btn ghost block" data-act="copiar-anterior" data-de="${esc(anterior.id)}">${icon('copy', 16)}Copiar ${rotulo} do RDO ${esc(anterior.number)}</button>`
      : '';
  };

  function workforce(rdo) {
    const presentes = rdo.workforce.filter((w) => w.status === 'Presente').length;
    const trava = travado(rdo);
    const horasTexto = (w) => (w.hours == null || w.hours === '' ? '—' : `${Number(w.hours) || 0}h`);
    // mesma folha para adicionar e para corrigir (toque no nome)
    const campos = (w = {}) => [
      { key: 'name', label: 'Nome', placeholder: 'Nome completo', value: w.name },
      { key: 'role', label: 'Função', placeholder: 'Função', value: w.role },
      { key: 'team', label: 'Equipe', placeholder: 'Equipe', value: w.team },
      { key: 'status', label: 'Presença', type: 'select', options: [{ value: '', label: 'Selecione' }, 'Presente', 'Falta'], value: w.status },
      { key: 'hours', label: 'Horas', type: 'number', placeholder: 'Horas trabalhadas', value: w.hours ?? '' },
    ];
    const ler = (valores) => {
      if (!valores.name) { toast('Informe o nome.'); return null; }
      if (!valores.status) { toast('Informe a presença.'); return null; }
      return {
        name: valores.name,
        role: valores.role || '',
        team: valores.team || '',
        status: valores.status,
        hours: valores.status === 'Falta' ? 0 : (valores.hours === '' ? null : Number(valores.hours) || 0),
      };
    };
    return {
      titulo: TITULOS.workforce,
      html: `
        <div class="counter">
          <div><div class="n">${presentes}</div><div class="t">presente(s) de ${rdo.workforce.length}</div></div>
          ${trava ? '' : `<button class="btn primary" data-act="escolher">${icon('users', 16)}Escolher da equipe</button>`}
        </div>
        ${trava ? avisoTravado(rdo) : `
          <div class="btn-row">
            <button class="btn ghost" data-act="add">${icon('plus', 16)}Outra pessoa</button>
            <button class="btn ghost" data-act="cadastro">${icon('file', 16)}Cadastro da equipe</button>
          </div>
          ${botaoCopiar(rdo, 'workforce', 'a equipe')}`}
        ${rdo.workforce.length === 0
          ? '<div class="empty-state">Nenhuma pessoa no RDO.<br>Use <strong>Escolher da equipe</strong> e marque quem está presente hoje.</div>'
          : rdo.workforce.map((w) => `
            <div class="card">
              <button class="body editar" data-editar="${esc(w.id)}"${trava ? ' disabled' : ''}>
                <div class="name">${esc(w.name)}</div>
                <div class="sub">${esc(w.role || '—')} • ${esc(w.team || '—')} · ${horasTexto(w)}</div>
              </button>
              <button class="badge ${w.status === 'Presente' ? 'green' : 'red'}" data-presenca="${esc(w.id)}"${trava ? ' disabled' : ''}
                aria-label="Trocar presença de ${esc(w.name)}">${esc(w.status)}</button>
              ${trava ? '' : `<button class="del" data-del="${esc(w.id)}" aria-label="Remover">${icon('trash', 17)}</button>`}
            </div>`).join('')}
        ${rdo.workforce.length && !trava ? '<p class="dica">Toque no nome para corrigir e na presença para trocar entre Presente e Falta.</p>' : ''}`,
      bind(root) {
        if (trava) return;
        root.querySelector('[data-act="cadastro"]').addEventListener('click', () => app.go('roster'));

        // escolher da equipe: lista de marcar por equipe; quem já está no RDO aparece travado
        root.querySelector('[data-act="escolher"]').addEventListener('click', async () => {
          const noRdo = new Set(rdo.workforce.map((w) => w.name.trim().toLowerCase()));
          const grupos = Store.equipe.map((g) => ({
            titulo: g.equipe,
            itens: g.pessoas.map((p) => {
              const ja = noRdo.has(p.name.trim().toLowerCase());
              return { value: `${p.team}|${p.name}`, label: p.name, checked: ja, disabled: ja, nota: ja ? 'já no RDO' : (p.role || '') };
            }),
          }));
          const valores = await sheet({
            title: 'Quem está presente hoje?',
            text: 'Marque as pessoas. Elas entram como Presente; toque no selo depois para trocar para Falta.',
            fields: [{ key: 'pessoas', type: 'checks', grupos }],
            submit: 'Adicionar marcados',
          });
          if (!valores || !valores.pessoas?.length) return;
          const todos = Store.equipe.flatMap((g) => g.pessoas);
          Store.update(rdo.id, (d) => {
            valores.pessoas.forEach((chave) => {
              const p = todos.find((x) => `${x.team}|${x.name}` === chave);
              if (p) d.workforce.push({ id: Store.uid(), name: p.name, role: p.role || '', team: p.team, status: 'Presente', hours: null });
            });
          });
          toast(`${valores.pessoas.length} pessoa(s) adicionada(s).`);
          app.render();
        });

        root.querySelector('[data-act="add"]').addEventListener('click', async () => {
          // pessoa fora da equipe: digitada, sem presença ou horas marcadas
          const valores = await sheet({ title: 'Adicionar pessoa', fields: campos(), submit: 'Adicionar' });
          const pessoa = valores && ler(valores);
          if (!pessoa) return;
          Store.update(rdo.id, (d) => { d.workforce.push({ id: Store.uid(), ...pessoa }); });
          toast('Mão de obra atualizada.');
          app.render();
        });

        root.querySelectorAll('[data-editar]').forEach((b) => {
          b.addEventListener('click', async () => {
            const atual = rdo.workforce.find((w) => w.id === b.dataset.editar);
            if (!atual) return;
            const valores = await sheet({ title: 'Corrigir pessoa', fields: campos(atual), submit: 'Salvar' });
            const pessoa = valores && ler(valores);
            if (!pessoa) return;
            Store.update(rdo.id, (d) => { Object.assign(d.workforce.find((w) => w.id === atual.id), pessoa); });
            app.render();
          });
        });

        root.querySelectorAll('[data-presenca]').forEach((b) => {
          b.addEventListener('click', () => {
            Store.update(rdo.id, (d) => {
              const w = d.workforce.find((x) => x.id === b.dataset.presenca);
              if (w) w.status = w.status === 'Presente' ? 'Falta' : 'Presente';
            });
            app.render();
          });
        });

        root.querySelector('[data-act="copiar-anterior"]')?.addEventListener('click', async (e) => {
          const origem = Store.find(e.currentTarget.dataset.de);
          if (!origem) return;
          const nomes = new Set(rdo.workforce.map((w) => w.name.trim().toLowerCase()));
          const novas = origem.workforce.filter((w) => !nomes.has(String(w.name).trim().toLowerCase()));
          if (!novas.length) { toast('Essa equipe já está no RDO.'); return; }
          const ok = await confirmar('Copiar equipe',
            `Copiar ${novas.length} pessoa(s) do RDO ${origem.number} (${fmtDate(origem.date)})? Confira a presença de cada um depois.`, 'Copiar');
          if (!ok) return;
          Store.update(rdo.id, (d) => {
            novas.forEach((w) => d.workforce.push({ id: Store.uid(), name: w.name, role: w.role || '', team: w.team || '', status: w.status, hours: w.hours ?? null }));
          });
          toast(`${novas.length} pessoa(s) copiada(s).`);
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
    const trava = travado(rdo);
    // mesma folha para adicionar e para corrigir (toque no nome); horímetro em branco
    const campos = (e = {}) => [
      { key: 'name', label: 'Equipamento', placeholder: 'Nome do equipamento', value: e.name },
      { key: 'code', label: 'Código / patrimônio', placeholder: 'Código', value: e.code },
      { key: 'status', label: 'Status', type: 'select', options: [{ value: '', label: 'Selecione' }, 'Operando', 'Parado', 'Manutenção'], value: e.status },
      { key: 'hoursStart', label: 'Horímetro inicial', type: 'number', placeholder: 'Horímetro inicial', value: e.hoursStart ?? '' },
      { key: 'hoursEnd', label: 'Horímetro final', type: 'number', placeholder: 'Horímetro final', value: e.hoursEnd ?? '' },
    ];
    const horimetro = (v) => (v === '' ? null : Number(v) || 0);
    const ler = (valores) => {
      if (!valores.name) { toast('Informe o equipamento.'); return null; }
      if (!valores.status) { toast('Informe o status do equipamento.'); return null; }
      return {
        name: valores.name,
        code: valores.code || '',
        status: valores.status,
        hoursStart: horimetro(valores.hoursStart),
        hoursEnd: horimetro(valores.hoursEnd),
      };
    };
    return {
      titulo: TITULOS.equipment,
      html: `
        ${trava ? avisoTravado(rdo) : `<button class="btn primary block" data-act="add">${icon('plus', 16)}Equipamento</button>`}
        ${botaoCopiar(rdo, 'equipmentList', 'os equipamentos')}
        ${rdo.equipmentList.length === 0
          ? '<div class="empty-state">Nenhum equipamento no relatório.<br>Toque em <strong>Equipamento</strong> para incluir.</div>'
          : rdo.equipmentList.map((e, i) => `
            <div class="card">
              <button class="body editar" data-editar="${i}"${trava ? ' disabled' : ''}>
                <div class="name">${esc(e.name)}</div>
                <div class="sub">${esc(e.code || 'sem código')} · horímetro ${horas(e.hoursStart)} → ${horas(e.hoursEnd)}</div>
              </button>
              <span class="badge ${badge(e.status)}">${esc(e.status)}</span>
              ${trava ? '' : `<button class="del" data-del="${i}" aria-label="Remover">${icon('trash', 17)}</button>`}
            </div>`).join('')}
        ${rdo.equipmentList.length && !trava ? '<p class="dica">Toque no equipamento para corrigir ou digitar o horímetro.</p>' : ''}`,
      bind(root) {
        if (trava) return;
        root.querySelector('[data-act="add"]').addEventListener('click', async () => {
          // tudo digitado: sem cadastro de equipamentos, status e horímetro em branco
          const valores = await sheet({ title: 'Equipamento', fields: campos(), submit: 'Adicionar' });
          const item = valores && ler(valores);
          if (!item) return;
          Store.update(rdo.id, (d) => { d.equipmentList.push(item); });
          toast('Equipamento adicionado.');
          app.render();
        });

        root.querySelectorAll('[data-editar]').forEach((b) => {
          b.addEventListener('click', async () => {
            const i = Number(b.dataset.editar);
            const valores = await sheet({ title: 'Corrigir equipamento', fields: campos(rdo.equipmentList[i]), submit: 'Salvar' });
            const item = valores && ler(valores);
            if (!item) return;
            Store.update(rdo.id, (d) => { d.equipmentList[i] = item; });
            app.render();
          });
        });

        root.querySelector('[data-act="copiar-anterior"]')?.addEventListener('click', async (e) => {
          const origem = Store.find(e.currentTarget.dataset.de);
          if (!origem) return;
          const ja = new Set(rdo.equipmentList.map((x) => `${x.name}|${x.code}`.toLowerCase()));
          const novos = origem.equipmentList.filter((x) => !ja.has(`${x.name}|${x.code}`.toLowerCase()));
          if (!novos.length) { toast('Esses equipamentos já estão no RDO.'); return; }
          const ok = await confirmar('Copiar equipamentos',
            `Copiar ${novos.length} equipamento(s) do RDO ${origem.number} (${fmtDate(origem.date)})? O horímetro fica em branco para você digitar.`, 'Copiar');
          if (!ok) return;
          Store.update(rdo.id, (d) => {
            novos.forEach((x) => d.equipmentList.push({ name: x.name, code: x.code || '', status: x.status, hoursStart: null, hoursEnd: null }));
          });
          toast(`${novos.length} equipamento(s) copiado(s).`);
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

  // identidade de uma tarefa ao longo dos dias: a que veio do backlog guarda de onde veio
  const chaveTarefa = (r, t, i) => t.backlogDe || t.id || `${r.id}:${i}`;

  /**
   * Backlog que acompanha: tarefas marcadas Backlog e abaixo de 100% em RDOs anteriores,
   * olhando a última vez que cada uma apareceu, e que ainda não estão neste RDO.
   */
  function pendenciasBacklog(rdo) {
    const ultimas = new Map();
    Store.rdos.forEach((r) => (r.tasks || []).forEach((t, i) => {
      const chave = chaveTarefa(r, t, i);
      const vista = ultimas.get(chave);
      if (!vista || String(r.number) > String(vista.rdo.number)) ultimas.set(chave, { rdo: r, tarefa: t, chave });
    }));
    const aqui = new Set((rdo.tasks || []).map((t, i) => chaveTarefa(rdo, t, i)));
    return [...ultimas.values()].filter(({ rdo: r, tarefa: t, chave }) => r.id !== rdo.id
      && String(r.number) < String(rdo.number) && t.maintenanceType === 'Backlog'
      && (Number(t.progress) || 0) < 100 && !aqui.has(chave));
  }

  function tasks(rdo) {
    const trava = travado(rdo);
    const pendencias = trava ? [] : pendenciasBacklog(rdo);
    // mesma folha para registrar e para corrigir (toque na tarefa)
    const campos = (t = {}) => [
      { key: 'description', label: 'Descrição', type: 'textarea', placeholder: 'O que foi executado', value: t.description },
      { key: 'maintenanceType', label: 'Tipo (opcional)', type: 'select', options: [{ value: '', label: 'Selecione' }, ...TIPOS], value: t.maintenanceType },
      { key: 'os', label: 'Nº da OS', placeholder: 'Opcional', value: t.os },
      { key: 'progress', label: 'Execução (%)', type: 'number', placeholder: 'De 0 a 100', value: t.progress ?? '' },
      { key: 'area', label: 'Área', placeholder: 'Área', value: t.area },
    ];
    const ler = (valores) => {
      const desc = String(valores.description || '').trim();
      if (!desc) { toast('Informe a descrição da tarefa.'); return null; }
      if (valores.progress === '') { toast('Informe a execução (%).'); return null; }
      const bruto = valores.progress;
      const progresso = Math.max(0, Math.min(100, Number.isFinite(bruto) ? bruto : 0));
      return {
        os: valores.os || '',
        maintenanceType: valores.maintenanceType || '',
        description: desc,
        progress: progresso,
        area: valores.area || '',
        status: progresso >= 100 ? 'Concluído' : 'Em Andamento',
      };
    };
    return {
      titulo: TITULOS.tasks,
      html: `
        ${trava ? avisoTravado(rdo) : `<button class="btn dashed block" data-act="add">${icon('plus', 16)}Registrar Nova Tarefa</button>`}
        ${pendencias.length ? `
          <div class="pendencias">
            <div class="label">Pendências do backlog (${pendencias.length})</div>
            ${pendencias.map(({ rdo: r, tarefa: t, chave }) => `
              <div class="pendencia">
                <div class="grow">
                  <div class="num">${esc(t.description)}</div>
                  <div class="meta">${t.os ? `OS ${esc(t.os)} · ` : ''}${Number(t.progress) || 0}% · RDO ${esc(r.number)} (${fmtDate(r.date)})</div>
                </div>
                <button class="btn ghost" data-trazer="${esc(chave)}" style="padding:7px 10px;font-size:12px">Trazer</button>
              </div>`).join('')}
          </div>` : ''}
        ${rdo.tasks.length === 0
          ? '<div class="empty-state">Nenhuma tarefa registrada.<br>Use <strong>Registrar Nova Tarefa</strong>.</div>'
          : rdo.tasks.map((t, i) => {
            const done = Number(t.progress) >= 100;
            return `
            <div class="card task-card ${done ? 'done' : ''}">
              <button class="body editar" data-editar="${i}"${trava ? ' disabled' : ''}>
                <div class="name">${esc(t.description)}</div>
                <div class="sub">${t.os ? `OS ${esc(t.os)} · ` : ''}${t.area ? `${esc(t.area)} · ` : ''}${Number(t.progress) || 0}%${t.backlogDe ? ' · veio do backlog' : ''}</div>
                <div class="progress"><span style="width:${Math.max(0, Math.min(100, Number(t.progress) || 0))}%"></span></div>
              </button>
              <div class="selos">
                ${seloTipo(t)}
                <span class="badge ${done ? 'green' : 'amber'}">${esc(t.status || (done ? 'Concluído' : 'Em Andamento'))}</span>
              </div>
              ${trava ? '' : `<button class="del" data-del="${i}" aria-label="Remover">${icon('trash', 17)}</button>`}
            </div>`;
          }).join('')}
        ${rdo.tasks.length && !trava ? '<p class="dica">Toque na tarefa para corrigir ou atualizar a execução (%). Backlog abaixo de 100% aparece no próximo RDO.</p>' : ''}`,
      bind(root) {
        root.querySelector('[data-act="add"]')?.addEventListener('click', async () => {
          const valores = await sheet({ title: 'Registrar Nova Tarefa', fields: campos(), submit: 'Registrar' });
          const tarefa = valores && ler(valores);
          if (!tarefa) return;
          Store.update(rdo.id, (d) => { d.tasks.push({ id: Store.uid(), ...tarefa }); });
          toast('Tarefa registrada.');
          app.render();
        });

        root.querySelectorAll('[data-editar]').forEach((b) => {
          b.addEventListener('click', async () => {
            const i = Number(b.dataset.editar);
            const valores = await sheet({ title: 'Corrigir tarefa', fields: campos(rdo.tasks[i]), submit: 'Salvar' });
            const tarefa = valores && ler(valores);
            if (!tarefa) return;
            Store.update(rdo.id, (d) => { Object.assign(d.tasks[i], tarefa); });
            app.render();
          });
        });

        root.querySelectorAll('[data-trazer]').forEach((b) => {
          b.addEventListener('click', () => {
            const achada = pendencias.find((p) => p.chave === b.dataset.trazer);
            if (!achada) return;
            const t = achada.tarefa;
            Store.update(rdo.id, (d) => {
              d.tasks.push({
                id: Store.uid(), backlogDe: achada.chave, os: t.os || '', maintenanceType: 'Backlog',
                description: t.description, progress: Number(t.progress) || 0, area: t.area || '', status: 'Em Andamento',
              });
            });
            toast('Pendência trazida. Toque nela para atualizar a execução (%).');
            app.render();
          });
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
        ${travado(rdo) ? avisoTravado(rdo) : `<button class="btn danger block" data-act="add">${icon('plus', 16)}Registrar Ocorrência</button>`}
        ${rdo.occurrences.length === 0
          ? '<div class="empty-state">Nenhuma ocorrência registrada.</div>'
          : rdo.occurrences.map((o, i) => `
            <div class="card">
              <div class="body">
                <div class="name">${esc(o.description)}</div>
                <div class="sub">${esc([o.time, o.location].filter(Boolean).join(' · ') || '—')}</div>
              </div>
              <span class="badge red">${esc(o.type || '—')}</span>
              ${travado(rdo) ? '' : `<button class="del" data-del="${i}" aria-label="Remover">${icon('trash', 17)}</button>`}
            </div>`).join('')}`,
      bind(root) {
        root.querySelector('[data-act="add"]')?.addEventListener('click', async () => {
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

  // -------------------------------------------------------------- horas paradas

  const MOTIVOS = ['Chuva', 'Aguardando liberação', 'Falta de peça', 'Falta de material', 'Aguardando cliente', 'Equipamento quebrado', 'Outro'];

  function stops(rdo) {
    const lista = rdo.stoppages || [];
    const total = lista.reduce((s, p) => s + Store.minutosParada(p), 0);
    const trava = travado(rdo);
    return {
      titulo: TITULOS.stops,
      html: `
        <div class="counter">
          <div><div class="n">${Store.fmtHoras(total)}</div><div class="t">parado no dia (${lista.length} parada(s))</div></div>
          ${trava ? '' : `<button class="btn primary" data-act="add">${icon('plus', 16)}Parada</button>`}
        </div>
        ${trava ? avisoTravado(rdo) : ''}
        ${lista.length === 0
          ? '<div class="empty-state">Nenhuma parada registrada.<br>Registre chuva, espera de liberação, falta de peça... para justificar e cobrar a hora parada.</div>'
          : lista.map((p, i) => `
            <div class="card">
              <div class="body">
                <div class="name">${esc(p.reason)}</div>
                <div class="sub">${esc(p.start)} → ${esc(p.end)} · ${Store.fmtHoras(Store.minutosParada(p))}${p.note ? ` · ${esc(p.note)}` : ''}</div>
              </div>
              <span class="badge amber">${Store.fmtHoras(Store.minutosParada(p))}</span>
              ${trava ? '' : `<button class="del" data-del="${i}" aria-label="Remover">${icon('trash', 17)}</button>`}
            </div>`).join('')}`,
      bind(root) {
        root.querySelector('[data-act="add"]')?.addEventListener('click', async () => {
          const valores = await sheet({
            title: 'Registrar parada',
            fields: [
              { key: 'start', label: 'Parou às', type: 'time' },
              { key: 'end', label: 'Voltou às', type: 'time' },
              { key: 'reason', label: 'Motivo', type: 'select', options: [{ value: '', label: 'Selecione' }, ...MOTIVOS] },
              { key: 'note', label: 'Observação (opcional)', type: 'textarea', placeholder: 'Detalhe da parada' },
            ],
            submit: 'Registrar',
          });
          if (!valores) return;
          if (!valores.start || !valores.end) { toast('Informe a hora que parou e a que voltou.'); return; }
          if (valores.start === valores.end) { toast('A hora de volta é igual à de parada.'); return; }
          if (!valores.reason) { toast('Informe o motivo da parada.'); return; }
          Store.update(rdo.id, (d) => {
            d.stoppages = d.stoppages || [];
            d.stoppages.push({ id: Store.uid(), start: valores.start, end: valores.end, reason: valores.reason, note: valores.note || '' });
          });
          toast('Parada registrada.');
          app.render();
        });

        root.querySelectorAll('[data-del]').forEach((b) => {
          b.addEventListener('click', async () => {
            const ok = await confirmar('Remover parada', 'Remover esta parada do relatório?');
            if (!ok) return;
            Store.update(rdo.id, (d) => { d.stoppages.splice(Number(b.dataset.del), 1); });
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
        ${travado(rdo) ? avisoTravado(rdo) : `
        <div class="btn-row">
          <button class="btn primary" data-act="tirar">${icon('camera', 18)}Tirar Foto</button>
          <button class="btn ghost" data-act="galeria">${icon('image', 18)}Da Galeria</button>
        </div>
        <input type="file" accept="image/*" capture="environment" id="camera-input" hidden>
        <input type="file" accept="image/*" multiple id="galeria-input" hidden>
        <p style="font-size:11.5px;color:var(--text-soft);line-height:1.5;margin:0">
          Data, hora, GPS e nº do RDO ficam escritos na própria foto. Tirada aqui leva o GPS de agora
          (quando o aparelho permite); da galeria entra com a data do arquivo, sem GPS. As fotos vão
          junto no PDF.
        </p>`}
        ${rdo.photos.length === 0
          ? '<div class="empty-state">Nenhuma foto anexada.</div>'
          : `<div class="photo-grid">${rdo.photos.map((p, i) => `
              <figure class="photo">
                <img data-foto="${i}" alt="${esc(p.desc || 'Foto do RDO')}">
                ${p.latitude != null ? `<span class="gps">${icon('gps', 9)} GPS</span>` : ''}
                ${travado(rdo) ? '' : `<button class="rm" data-del="${i}" aria-label="Remover foto">${icon('trash', 13)}</button>`}
                <figcaption class="cap">${esc(p.desc || fmtDate(p.date) + ' ' + (p.time || ''))}</figcaption>
              </figure>`).join('')}</div>`}`,
      bind(root) {
        // miniaturas: a imagem vem do IndexedDB depois de desenhar a tela
        root.querySelectorAll('img[data-foto]').forEach((img) => {
          Fotos.imagem(rdo.photos[Number(img.dataset.foto)]).then((src) => { if (src) img.src = src; });
        });
        if (travado(rdo)) return;

        const camera = root.querySelector('#camera-input');
        const galeria = root.querySelector('#galeria-input');
        root.querySelector('[data-act="tirar"]').addEventListener('click', () => camera.click());
        root.querySelector('[data-act="galeria"]').addEventListener('click', () => galeria.click());

        const doisDigitos = (n) => String(n).padStart(2, '0');
        const isoLocal = (d) => `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;

        async function anexar(arquivos, daCamera) {
          if (!arquivos.length) return;
          const desc = await sheet({
            title: arquivos.length > 1 ? `Descrição das ${arquivos.length} fotos` : 'Descrição da foto',
            fields: [{ key: 'desc', label: 'Descrição (opcional)', placeholder: 'O que a foto mostra' }],
            submit: 'Anexar',
          });
          if (desc === null) return;

          // GPS só para foto tirada agora; a da galeria pode ter sido feita em outro lugar
          let coords = null;
          if (daCamera && navigator.geolocation) {
            coords = await new Promise((resolve) => {
              navigator.geolocation.getCurrentPosition(
                (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
                () => resolve(null),
                { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 },
              );
            });
          }

          toast(arquivos.length > 1 ? `Anexando ${arquivos.length} fotos...` : 'Anexando a foto...');
          let anexadas = 0;
          let falhas = 0;
          for (const arquivo of arquivos) {
            const quando = daCamera || !arquivo.lastModified ? new Date() : new Date(arquivo.lastModified);
            const carimbo = [
              `${fmtDate(isoLocal(quando))} ${doisDigitos(quando.getHours())}:${doisDigitos(quando.getMinutes())} · RDO ${rdo.number}`,
              coords ? `GPS ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}` : (daCamera ? 'GPS indisponível' : 'Foto da galeria (sem GPS)'),
              [rdo.location, desc.desc].filter(Boolean).join(' · '),
            ];
            let guardada = null;
            try {
              guardada = await Fotos.salvar(await Fotos.reduzir(arquivo, { carimbo }));
            } catch {
              falhas += 1;
              continue;
            }
            const salvo = Store.update(rdo.id, (d) => {
              d.photos.push({
                ...guardada,
                desc: desc.desc || '',
                timestamp: quando.toISOString(),
                date: isoLocal(quando),
                time: `${doisDigitos(quando.getHours())}:${doisDigitos(quando.getMinutes())}`,
                latitude: coords?.latitude ?? null,
                longitude: coords?.longitude ?? null,
                origem: daCamera ? 'camera' : 'galeria',
              });
            });
            if (salvo) anexadas += 1;
            else { falhas += 1; Fotos.remover([guardada]); }
          }
          if (falhas && !anexadas) toast('Não foi possível anexar a foto. Apague relatórios antigos e tente de novo.');
          else if (falhas) toast(`${anexadas} foto(s) anexada(s); ${falhas} não entraram.`);
          else toast(anexadas > 1 ? `${anexadas} fotos anexadas.` : 'Foto anexada.');
          app.render();
        }

        camera.addEventListener('change', () => {
          const arquivos = [...(camera.files || [])];
          camera.value = '';
          anexar(arquivos, true);
        });
        galeria.addEventListener('change', () => {
          const arquivos = [...(galeria.files || [])];
          galeria.value = '';
          anexar(arquivos, false);
        });

        root.querySelectorAll('[data-del]').forEach((b) => {
          b.addEventListener('click', async () => {
            const ok = await confirmar('Remover foto', 'Remover esta foto do relatório?');
            if (!ok) return;
            const [removida] = rdo.photos.slice(Number(b.dataset.del), Number(b.dataset.del) + 1);
            if (Store.update(rdo.id, (d) => { d.photos.splice(Number(b.dataset.del), 1); })) Fotos.remover([removida]);
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
          <div class="li"><span class="k">Tipo</span><span class="v">${esc(rdo.maintenanceType || '—')}</span></div>
          <div class="li"><span class="k">Local / Mina</span><span class="v">${esc(rdo.location || '—')}</span></div>
          <div class="li"><span class="k">Clima</span><span class="v">${esc(rdo.weather || '—')}</span></div>
          <div class="li"><span class="k">Supervisor</span><span class="v">${esc(rdo.supervisor || '—')}</span></div>
          <div class="li"><span class="k">Horas de equipamento</span><span class="v">${somaHoras}h</span></div>
          <div class="li"><span class="k">Ocorrências</span><span class="v">${rdo.occurrences.length}</span></div>
        </div>

        <button class="btn block" data-act="enviar-pdf" style="background:#25D366;color:#fff">${icon('whatsapp', 18)}<span>Enviar PDF com fotos (WhatsApp)</span></button>
        <button class="btn primary block" data-act="pdf">${icon('download', 18)}Baixar PDF com fotos</button>
        <button class="btn ghost block" data-act="whats">${icon('whatsapp', 16)}Enviar só o texto pelo WhatsApp</button>
        <button class="btn ghost block" data-act="copiar">${icon('copy', 16)}Copiar resumo em texto</button>
        ${travado(rdo)
          ? `${avisoTravado(rdo)}<button class="btn ghost block" data-act="reabrir">${icon('unlock', 16)}Reabrir RDO para mudar</button>`
          : `<button class="btn dark block" data-act="finalizar">${icon('lock', 16)}Finalizar RDO</button>
             <p class="dica">Finalizado, o RDO fica só para leitura: ninguém muda sem querer depois de enviado.</p>`}`,
      bind(root) {
        root.querySelector('[data-act="pdf"]').addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            const r = await window.Pdf.gerar(rdo);
            if (r !== 'cancelado') toast(`RDO_${rdo.number}.pdf gerado${rdo.photos.length ? ` com ${rdo.photos.length} foto(s)` : ''}.`);
          } catch (err) {
            toast('Não foi possível gerar o PDF.');
          } finally {
            btn.disabled = false;
          }
        });

        // PDF com as fotos pelo compartilhar do aparelho (escolher WhatsApp).
        // 1º toque monta o PDF; 2º toque compartilha (o Safari só deixa dentro de um toque).
        const btnEnviar = root.querySelector('[data-act="enviar-pdf"]');
        const rotulo = btnEnviar.querySelector('span');
        let pronto = null;
        const legenda = `RDO ${rdo.number} - ${fmtDate(rdo.date)}${rdo.location ? ` - ${rdo.location}` : ''}`;
        const depois = (r) => {
          if (r === 'compartilhado') toast('PDF enviado para o compartilhar.');
          if (r === 'baixado') toast('Este navegador não compartilha arquivo: o PDF foi baixado para anexar no WhatsApp.');
        };
        btnEnviar.addEventListener('click', async () => {
          if (pronto) {
            const p = pronto;
            pronto = null;
            rotulo.textContent = 'Enviar PDF com fotos (WhatsApp)';
            p.enviar(legenda).then(depois, () => toast('Não foi possível compartilhar o PDF.'));
            return;
          }
          btnEnviar.disabled = true;
          rotulo.textContent = 'Montando o PDF...';
          try {
            const p = await window.Pdf.preparar(rdo);
            if (window.Capacitor?.isNativePlatform?.()) {
              rotulo.textContent = 'Enviar PDF com fotos (WhatsApp)';
              depois(await p.enviar(legenda));
            } else {
              pronto = p;
              rotulo.textContent = 'PDF pronto: toque para enviar';
            }
          } catch {
            rotulo.textContent = 'Enviar PDF com fotos (WhatsApp)';
            toast('Não foi possível gerar o PDF.');
          } finally {
            btnEnviar.disabled = false;
          }
        });

        root.querySelector('[data-act="whats"]').addEventListener('click', async () => {
          const valores = await sheet({
            title: 'Enviar só o texto',
            text: 'O texto resumido do RDO será aberto no WhatsApp (sem as fotos; para mandar as fotos use "Enviar PDF com fotos"). Deixe o número em branco para escolher o contato no aplicativo.',
            fields: [
              { key: 'telefone', label: 'Número com DDD (opcional)', placeholder: 'Ex.: 18997123456' },
            ],
            submit: 'Abrir WhatsApp',
          });
          if (!valores) return;
          Whatsapp.enviar(rdo, valores.telefone || '');
          toast('Resumo aberto no WhatsApp.');
        });

        root.querySelector('[data-act="finalizar"]')?.addEventListener('click', async () => {
          const ok = await confirmar('Finalizar RDO',
            `Finalizar o RDO ${rdo.number}? Ele fica só para leitura (dá para reabrir depois em Gerar Relatório).`, 'Finalizar');
          if (!ok) return;
          Store.update(rdo.id, (d) => { d.status = 'final'; d.finalizedAt = new Date().toISOString(); });
          toast(`RDO ${rdo.number} finalizado.`);
          app.render();
        });

        root.querySelector('[data-act="reabrir"]')?.addEventListener('click', async () => {
          const ok = await confirmar('Reabrir RDO',
            `Reabrir o RDO ${rdo.number} para mudar? Se ele já foi enviado, mande o PDF de novo depois.`, 'Reabrir');
          if (!ok) return;
          Store.update(rdo.id, (d) => { d.status = 'draft'; d.finalizedAt = null; });
          toast(`RDO ${rdo.number} reaberto.`);
          app.render();
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
    const listaHtml = () => {
      const lista = filtrar(Store.rdos);
      if (!lista.length) {
        return `<div class="empty-state">${Store.rdos.length ? 'Nenhum RDO nesta data/tipo.' : 'Nenhum relatório salvo neste aparelho.'}</div>`;
      }
      return `<div class="contagem">${resumoFiltro(lista.length)}</div>${lista.map((r) => `
            <div class="card">
              <div class="body">
                <div class="name">RDO ${esc(r.number)}</div>
                <div class="sub">${fmtDate(r.date)} · ${esc(r.location || 'Sem local')}</div>
                <div class="sub">${r.tasks.length} tarefa(s) · ${r.occurrences.length} ocorrência(s) · ${r.photos.length} foto(s)</div>
              </div>
              ${seloTipo(r)}
              <button class="del del-rdo" data-del="${esc(r.id)}" aria-label="Apagar RDO ${esc(r.number)}">${icon('trash', 20)}</button>
            </div>`).join('')}`;
    };
    return {
      titulo: TITULOS.reports,
      html: `
        <div class="aviso-perigo">
          Apagar um relatório remove cabeçalho, equipe, equipamentos, tarefas, ocorrências e fotos dele.
          <strong>A exclusão é definitiva:</strong> não há lixeira. Baixe o PDF antes, se precisar.
        </div>
        <div class="section-label">${Store.rdos.length} relatório(s) salvo(s) · ${fmtTamanho(Store.tamanho())} de dados (fotos à parte)</div>
        ${filtroHtml()}
        <div id="lista-apagar" class="lista-cartoes">${listaHtml()}</div>`,
      bind(root) {
        const lista = root.querySelector('#lista-apagar');
        ligarFiltro(root, () => { lista.innerHTML = listaHtml(); ligarApagar(); });
        ligarApagar();
        function ligarApagar() {
          lista.querySelectorAll('[data-del]').forEach((b) => {
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
        }
      },
    };
  }

  // -------------------------------------------------------------- cadastro da equipe

  function roster() {
    const grupos = Store.equipe;
    return {
      titulo: TITULOS.roster,
      html: `
        <button class="btn primary block" data-act="add">${icon('plus', 16)}Acrescentar pessoa</button>
        <p class="dica">As equipes fixas ficam sempre no app. Quem você acrescentar fica guardado neste
          aparelho (e vai na cópia de segurança). Para pôr alguém no RDO, use <strong>Escolher da equipe</strong> na Mão de Obra.</p>
        ${grupos.map((g) => `
          <div class="history">
            <div class="head"><span class="label">${esc(g.equipe)} · ${g.pessoas.length}</span></div>
            ${g.pessoas.map((p) => `
              <div class="row pessoa">
                <div class="grow">
                  <div class="num">${esc(p.name)}</div>
                  ${p.role ? `<div class="meta">${esc(p.role)}</div>` : ''}
                </div>
                ${p.fixa
                  ? `<span class="badge gray">${icon('lock', 11)} fixo</span>`
                  : `<button class="del" data-tirar="${esc(p.id)}" aria-label="Tirar ${esc(p.name)} do cadastro">${icon('trash', 17)}</button>`}
              </div>`).join('')}
          </div>`).join('')}`,
      bind(root) {
        root.querySelector('[data-act="add"]').addEventListener('click', async () => {
          const NOVA = '__nova__';
          const valores = await sheet({
            title: 'Acrescentar pessoa',
            fields: [
              { key: 'name', label: 'Nome', placeholder: 'Nome' },
              { key: 'team', label: 'Equipe', type: 'select', options: [{ value: '', label: 'Selecione' }, ...grupos.map((g) => g.equipe), { value: NOVA, label: 'Outra equipe (digitar)' }] },
              { key: 'novaEquipe', label: 'Nome da outra equipe (se escolheu "Outra equipe")', placeholder: 'Ex.: Equipe 3' },
              { key: 'role', label: 'Função (opcional)', placeholder: 'Função' },
            ],
            submit: 'Acrescentar',
          });
          if (!valores) return;
          if (!valores.name) { toast('Informe o nome.'); return; }
          const equipe = valores.team === NOVA ? valores.novaEquipe : valores.team;
          if (!equipe) { toast('Escolha a equipe.'); return; }
          if (!Store.adicionarPessoa(valores.name, equipe, valores.role)) { toast('Essa pessoa já está nessa equipe.'); return; }
          toast(`${valores.name} acrescentado(a) em ${equipe}.`);
          app.render();
        });

        root.querySelectorAll('[data-tirar]').forEach((b) => {
          b.addEventListener('click', async () => {
            const ok = await confirmar('Tirar do cadastro', 'Tirar esta pessoa do cadastro? Os RDOs em que ela já está não mudam.', 'Tirar');
            if (!ok) return;
            Store.removerPessoa(b.dataset.tirar);
            app.render();
          });
        });
      },
    };
  }

  // -------------------------------------------------------------- resumo do mês

  let mesEscolhido = '';  // "AAAA-MM"; vazio = mês de hoje

  function month() {
    const mes = mesEscolhido || Store.todayIso().slice(0, 7);
    const rdos = Store.rdos.filter((r) => String(r.date).startsWith(mes))
      .sort((a, b) => String(a.number).localeCompare(String(b.number)));
    const r = Store.resumo(rdos);
    const caixa = (n, t) => `<div class="box"><div class="n">${n}</div><div class="t">${t}</div></div>`;
    return {
      titulo: TITULOS.month,
      html: `
        <div class="field">
          <label for="m-mes">Mês</label>
          <input id="m-mes" type="month" value="${esc(mes)}">
        </div>
        <div class="summary">
          ${caixa(r.total, 'RDOs')}
          ${caixa(`${r.concluidas}/${r.tarefas}`, 'Tarefas concluídas')}
          ${caixa(`${r.horasEquipe}h`, 'Horas de equipe')}
          ${caixa(Store.fmtHoras(r.minutosParados), 'Horas paradas')}
        </div>
        <div class="info-list">
          <div class="li"><span class="k">Preventiva / Corretiva / Backlog (RDO)</span><span class="v">${r.porTipo.Preventiva} / ${r.porTipo.Corretiva} / ${r.porTipo.Backlog}</span></div>
          <div class="li"><span class="k">Tarefas Prev. / Corr. / Backlog</span><span class="v">${r.tarefasPorTipo.Preventiva} / ${r.tarefasPorTipo.Corretiva} / ${r.tarefasPorTipo.Backlog}</span></div>
          <div class="li"><span class="k">Backlog ainda aberto</span><span class="v">${r.backlogAberto}</span></div>
          <div class="li"><span class="k">Ocorrências</span><span class="v">${r.ocorrencias}</span></div>
          <div class="li"><span class="k">Finalizados</span><span class="v">${r.finalizados} de ${r.total}</span></div>
          ${r.motivosParada.map(([motivo, min]) => `<div class="li"><span class="k">Parado: ${esc(motivo)}</span><span class="v">${Store.fmtHoras(min)}</span></div>`).join('')}
        </div>
        <button class="btn primary block" data-act="pdf-mes"${r.total ? '' : ' disabled'}>${icon('download', 18)}<span>PDF do resumo de ${esc(Pdf.nomeMes(mes))}</span></button>
        ${rdos.length ? `<div class="lista-cartoes">${rdos.map((x) => `
          <button class="card linha-rdo" data-open="${esc(x.id)}">
            <div class="body">
              <div class="name">RDO ${esc(x.number)}</div>
              <div class="sub">${fmtDate(x.date)} · ${esc(x.location || 'Sem local')}${x.status === 'final' ? ' · finalizado' : ''}</div>
            </div>
            ${seloTipo(x)}
          </button>`).join('')}</div>` : '<div class="empty-state">Nenhum RDO neste mês.</div>'}`,
      bind(root) {
        root.querySelector('#m-mes').addEventListener('change', (e) => {
          if (!e.target.value) return;
          mesEscolhido = e.target.value;
          app.render();
        });
        root.querySelectorAll('[data-open]').forEach((b) => {
          b.addEventListener('click', () => { app.abrir(b.dataset.open); toast('RDO aberto.'); });
        });
        const botao = root.querySelector('[data-act="pdf-mes"]');
        const rotulo = `PDF do resumo de ${Pdf.nomeMes(mes)}`;
        UI.botaoArquivo(botao, {
          rotulo,
          async preparar() {
            const { doc, nome } = Pdf.resumoMes(mes, rdos);
            return { blob: doc.output('blob'), nome, titulo: 'Salvar ou enviar o resumo' };
          },
          aoEntregar(res) {
            if (res === 'compartilhado') toast('Resumo enviado para o compartilhar.');
            if (res === 'baixado') toast('Resumo baixado.');
          },
        });
      },
    };
  }

  // -------------------------------------------------------------- cópia de segurança

  function backup() {
    const totalFotos = Store.rdos.reduce((s, r) => s + r.photos.length, 0);
    return {
      titulo: TITULOS.backup,
      html: `
        <div class="aviso-info">
          Os relatórios ficam só neste aparelho. Apagar o app, o ícone ou trocar de celular pode
          perder tudo. Salve uma cópia (todos os RDOs, com as fotos) em Arquivos, Drive ou
          WhatsApp; para trazer de volta, use <strong>Restaurar cópia</strong> no aparelho novo.
        </div>
        <div class="section-label">${Store.rdos.length} RDO(s) · ${totalFotos} foto(s) neste aparelho</div>
        <button class="btn primary block" data-act="salvar-copia"${Store.rdos.length ? '' : ' disabled'}>${icon('download', 18)}<span>Salvar cópia de segurança</span></button>
        <button class="btn ghost block" data-act="restaurar">${icon('upload', 18)}Restaurar cópia</button>
        <input type="file" accept="application/json,.json" id="copia-input" hidden>
        <p class="dica">Restaurar só acrescenta: RDO que já está neste aparelho fica como está.
          Faça uma cópia por semana, ou antes de trocar de celular.</p>`,
      bind(root) {
        const btnSalvar = root.querySelector('[data-act="salvar-copia"]');
        UI.botaoArquivo(btnSalvar, {
          rotulo: 'Salvar cópia de segurança',
          async preparar() {
            // fotos voltam para dentro do arquivo: a cópia leva tudo
            const rdos = [];
            for (const r of Store.rdos) {
              const copia = JSON.parse(JSON.stringify(r));
              for (const p of copia.photos) {
                p.data = (await Fotos.imagem(p)) || null;
                delete p.foto;
              }
              rdos.push(copia);
            }
            // vai junto quem foi acrescentado à equipe (a equipe fixa já vem no app)
            const dados = { app: 'GPS-RDO', tipo: 'copia-de-seguranca', versao: 1, geradoEm: new Date().toISOString(), ultimos: Store.all.ultimos || {}, equipe: Store.employees || [], rdos };
            return {
              blob: new Blob([JSON.stringify(dados)], { type: 'application/json' }),
              nome: `GPS-RDO-copia-${Store.todayIso()}.json`,
              titulo: 'Salvar a cópia de segurança',
            };
          },
          aoEntregar(r) {
            if (r === 'compartilhado') toast('Cópia entregue. Escolha onde guardar (Arquivos, Drive...).');
            if (r === 'baixado') toast('Cópia baixada na pasta de downloads.');
          },
        });

        const input = root.querySelector('#copia-input');
        root.querySelector('[data-act="restaurar"]').addEventListener('click', () => input.click());
        input.addEventListener('change', async () => {
          const arquivo = input.files?.[0];
          input.value = '';
          if (!arquivo) return;
          let dados = null;
          try { dados = JSON.parse(await arquivo.text()); } catch { dados = null; }
          if (!dados || dados.app !== 'GPS-RDO' || !Array.isArray(dados.rdos)) {
            toast('Esse arquivo não é uma cópia do GPS-RDO.');
            return;
          }
          // gente acrescentada à equipe: entra quem ainda não está (adicionarPessoa ignora repetidos)
          const pessoas = (Array.isArray(dados.equipe) ? dados.equipe : [])
            .filter((p) => p?.name && Store.adicionarPessoa(p.name, p.team, p.role)).length;
          const novos = dados.rdos.filter((r) => r?.id && !Store.find(r.id));
          if (!novos.length) {
            toast(pessoas ? `${pessoas} pessoa(s) voltaram para a equipe. Os RDOs dessa cópia já estão aqui.` : 'Todos os RDOs dessa cópia já estão neste aparelho.');
            return;
          }
          const ok = await confirmar('Restaurar cópia',
            `Trazer ${novos.length} RDO(s) da cópia de ${fmtDate(String(dados.geradoEm).slice(0, 10))}? Os que já estão aqui ficam como estão.`, 'Restaurar');
          if (!ok) return;
          toast('Restaurando...');
          for (const r of novos) {
            for (const p of r.photos || []) {
              if (!p.data) continue;
              const guardada = await Fotos.salvar(p.data);
              if (guardada.foto) { p.foto = guardada.foto; delete p.data; }
            }
          }
          const entrou = Store.importar(novos, dados.ultimos);
          if (entrou < 0) { toast('Não coube no aparelho. Apague relatórios antigos e tente de novo.'); return; }
          toast(`${entrou} RDO(s) restaurado(s).`);
          app.render();
        });
      },
    };
  }

  const mapa = { home, header, workforce, equipment, tasks, occurrences, stops, photos, report, reports, backup, month, roster };

  return {
    boot(appRef) { app = appRef; },
    get(tela) { return mapa[tela] || home; },
    TITULOS,
  };
})();
