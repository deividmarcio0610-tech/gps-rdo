/*
 * Conta do funcionário na central: entrar, criar conta (com assinatura desenhada à mão),
 * esqueci a senha e o envio dos RDOs para a central.
 *
 * O aparelho guarda a sessão e os RDOs: no campo, sem sinal, o app abre e lança do mesmo
 * jeito; os RDOs vão para a central quando a internet volta. Sem conta, o app continua
 * valendo só neste aparelho ("Continuar sem conta").
 */
window.Conta = (() => {
  'use strict';

  const { esc, toast, sheet, icon, confirmar } = UI;
  const CHAVE = 'gps_rdo_conta_v1';
  const CHAVE_SEM_CONTA = 'gps_rdo_sem_conta_v1';

  // o navegador do app vive no app.js; aqui só se pede redesenho por ele
  const redesenhar = () => window.__rdo?.app?.render?.();
  const irParaInicio = () => window.__rdo?.app?.irParaInicio?.();

  let sessao = null;
  try { sessao = JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch { sessao = null; }
  if (!sessao?.usuario?.id) sessao = null;

  const salvarSessao = () => {
    try {
      if (sessao) localStorage.setItem(CHAVE, JSON.stringify(sessao));
      else localStorage.removeItem(CHAVE);
    } catch { /* sem espaço: a sessão fica só na memória */ }
  };

  /** Central pública (VPS, HTTPS). Quem quiser outra digita em "Endereço da central". */
  const CENTRAL_PADRAO = 'https://lubcontrol.dvdswap.com.br/rdo';

  /** Endereço da central (sem barra no fim). */
  const endereco = () => String(sessao?.endereco || Store.config.centralUrl || CENTRAL_PADRAO).trim().replace(/\/+$/, '');

  function definirEndereco(url) {
    const limpo = String(url || '').trim().replace(/\/+$/, '');
    sessao = sessao || {};
    sessao.endereco = limpo;
    Store.setCentralUrl(limpo);
    salvarSessao();
    return limpo;
  }

  const ativo = () => Boolean(sessao?.token && sessao?.usuario?.id);
  const semConta = () => !ativo() && localStorage.getItem(CHAVE_SEM_CONTA) === '1';
  const usuario = () => sessao?.usuario || null;

  async function api(caminho, { metodo = 'GET', corpo, bruto = false } = {}) {
    const base = endereco();
    if (!base) throw new Error('Falta o endereço da central. Preencha em "Endereço da central".');
    let r;
    try {
      r = await fetch(base + caminho, {
        method: metodo,
        headers: {
          ...(sessao?.token ? { Authorization: `Bearer ${sessao.token}` } : {}),
          ...(corpo ? { 'Content-Type': 'application/json' } : {}),
        },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
    } catch {
      throw new Error('Sem conexão com a central. Tente quando tiver internet.');
    }
    if (bruto && r.ok) return r;
    const dados = await r.json().catch(() => ({}));
    if (r.status === 401 && ativo()) {
      sessao.token = '';
      salvarSessao();
      throw new Error(dados.erro || 'Sua sessão venceu. Entre de novo.');
    }
    if (!r.ok) throw new Error(dados.erro || `Erro ${r.status} na central.`);
    return dados;
  }

  function guardarLogin(dados, url) {
    sessao = { token: dados.token, usuario: dados.usuario, endereco: (url || endereco()).trim().replace(/\/+$/, '') };
    Store.setCentralUrl(sessao.endereco);
    salvarSessao();
    localStorage.removeItem(CHAVE_SEM_CONTA);
    // cada conta tem os seus RDOs neste aparelho; a primeira vez adota os que já estão aqui
    Store.usarConta(dados.usuario.id);
  }

  const entrar = async (email, senha, url) => {
    const dados = await api('/api/entrar', { metodo: 'POST', corpo: { email, senha } });
    guardarLogin(dados, url);
    return dados.usuario;
  };

  const cadastrar = async (dados, url) => {
    const r = await api('/api/cadastrar', {
      metodo: 'POST',
      corpo: { nome: dados.nome, email: dados.email, senha: dados.senha, assinatura: dados.assinatura },
    });
    guardarLogin(r, url);
    return r.usuario;
  };

  const esqueci = async (email) => {
    const r = await api('/api/esqueci', { metodo: 'POST', corpo: { email } });
    return r.mensagem || 'Pedido registrado.';
  };

  const redefinir = async (email, codigo, senha) => {
    const r = await api('/api/redefinir', { metodo: 'POST', corpo: { email, codigo, senha } });
    guardarLogin(r);
    return r.usuario;
  };

  const atualizarPerfil = async (campos) => {
    const r = await api('/api/eu', { metodo: 'PUT', corpo: campos });
    if (sessao) { sessao.usuario = r.usuario; salvarSessao(); }
    return r.usuario;
  };

  async function sair() {
    const tinha = ativo();
    if (tinha) { try { await api('/api/sair', { metodo: 'POST' }); } catch { /* sem rede: sai do mesmo jeito */ } }
    const id = sessao?.usuario?.id;
    sessao = null;
    salvarSessao();
    localStorage.removeItem(CHAVE_SEM_CONTA);
    // volta ao modo sem conta sem apagar nada; quem entrar de novo reencontra os RDOs da conta
    Store.usarConta('');
    return id;
  }

  // ------------------------------------------------------------ envio dos RDOs

  let timer = null;
  let enviando = false;

  /**
   * Manda todos os RDOs do aparelho para a conta. O servidor regrava (upsert), então
   * mandar de novo não duplica. Devolve {enviados} ou lança o erro da central.
   */
  async function enviarTudo({ silencioso = false } = {}) {
    if (!ativo() || !endereco()) return { enviados: 0, semConta: true };
    if (enviando) return { enviados: 0, ocupado: true };
    enviando = true;
    try {
      const rdos = Store.rdos;
      if (!rdos.length) return { enviados: 0 };
      const r = await api('/api/rdos', { metodo: 'POST', corpo: { rdos } });
      if (!silencioso) toast(`${r.recebidos?.length || 0} RDO(s) enviado(s) para a central.`);
      return { enviados: r.recebidos?.length || 0 };
    } catch (e) {
      if (!silencioso) toast(e.message);
      throw e;
    } finally {
      enviando = false;
    }
  }

  /** Agenda o envio (usado a cada gravação no aparelho); sem rede, tenta de novo depois. */
  function agendar() {
    if (!ativo() || !endereco()) return;
    clearTimeout(timer);
    timer = setTimeout(() => { enviarTudo({ silencioso: true }).catch(() => {}); }, 4000);
  }

  /** Traz da central os RDOs desta conta que não estão no aparelho (celular novo). */
  async function recuperar() {
    const r = await api('/api/rdos');
    const novos = (r.rdos || []).filter((x) => x?.id && !Store.find(x.id));
    if (!novos.length) return 0;
    return Store.importar(novos, {});
  }

  // ------------------------------------------------------------ assinatura

  /** Liga o quadro de assinatura: dedo/mouse desenham; "Limpar" apaga. */
  function ligarAssinatura(root) {
    const canvas = root.querySelector('[data-assina]');
    if (!canvas) return { vazia: () => true, limpar: () => {} };
    const ctx = canvas.getContext('2d');
    let traco = false;
    let vazia = true;
    let pontos = [];

    function ajustar() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      if (!r.width) return;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111';
    }
    function limpar() {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      vazia = true;
      pontos = [];
      canvas.dataset.vazia = '1';
    }
    const posicao = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (canvas.dataset.travada) return;
      e.preventDefault();
      try { canvas.setPointerCapture?.(e.pointerId); } catch { /* Safari antigo não aceita */ }
      traco = true;
      vazia = false;
      canvas.dataset.vazia = '0';
      const p = posicao(e);
      pontos.push(p);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!traco) return;
      e.preventDefault();
      const p = posicao(e);
      pontos.push(p);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    });
    const soltar = () => { traco = false; };
    canvas.addEventListener('pointerup', soltar);
    canvas.addEventListener('pointercancel', soltar);
    canvas.addEventListener('pointerleave', soltar);

    ajustar();
    window.addEventListener('resize', () => { if (vazia) ajustar(); });

    return {
      vazia: () => vazia,
      limpar,
      /** PNG recortado no que foi desenhado (fundo branco, traço preto). */
      png() {
        if (vazia) return '';
        const dpr = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
        const margem = 8;
        const xs = pontos.map((p) => p.x);
        const ys = pontos.map((p) => p.y);
        const x0 = Math.max(0, Math.min(...xs) - margem);
        const y0 = Math.max(0, Math.min(...ys) - margem);
        const x1 = Math.min(canvas.width, Math.max(...xs) + margem);
        const y1 = Math.min(canvas.height, Math.max(...ys) + margem);
        const largura = Math.max(1, Math.round((x1 - x0) * dpr));
        const altura = Math.max(1, Math.round((y1 - y0) * dpr));
        const saida = document.createElement('canvas');
        saida.width = largura;
        saida.height = altura;
        const c2 = saida.getContext('2d');
        c2.fillStyle = '#fff';
        c2.fillRect(0, 0, largura, altura);
        c2.drawImage(canvas, x0 * dpr, y0 * dpr, largura, altura, 0, 0, largura, altura);
        return saida.toDataURL('image/png');
      },
    };
  }

  // ------------------------------------------------------------ telas

  let aba = 'entrar';      // entrar | criar | esqueci | redefinir
  let aviso = '';
  let avisoTipo = 'erro';
  let emailEsqueci = '';

  const mostrarAviso = (texto, tipo = 'erro') => { aviso = texto; avisoTipo = tipo; };

  function campoEndereco(valor) {
    return `
      <details class="central-end"${valor ? '' : ' open'}>
        <summary>Endereço da central</summary>
        <div class="field">
          <label for="c-url">Endereço da central (quem instalou o app informa)</label>
          <input id="c-url" type="url" data-campo="url" value="${esc(valor)}" placeholder="${esc(CENTRAL_PADRAO)}" autocapitalize="off" spellcheck="false">
        </div>
        <p class="dica">Já vem com a central do supervisor (${esc(CENTRAL_PADRAO)}). Só troque se ele pedir.</p>
      </details>`;
  }

  const abas = () => `
    <div class="abas">
      ${[['entrar', 'Entrar'], ['criar', 'Criar conta'], ['esqueci', 'Esqueci a senha']].map(([v, t]) => `
        <button type="button" class="aba${aba === v || (v === 'esqueci' && aba === 'redefinir') ? ' ativa' : ''}" data-aba="${v}">${t}</button>`).join('')}
    </div>`;

  const msgHtml = () => (aviso ? `<div class="aviso ${avisoTipo === 'ok' ? 'ok' : 'erro'}">${esc(aviso)}</div>` : '');

  function htmlEntrar(url) {
    return `
      ${abas()}
      <form data-form="entrar">
        <div class="field"><label for="c-email">E-mail</label>
          <input id="c-email" type="email" autocomplete="username" autocapitalize="off" required></div>
        <div class="field"><label for="c-senha">Senha</label>
          <input id="c-senha" type="password" autocomplete="current-password" required></div>
        <button class="btn primary block" type="submit">Entrar</button>
      </form>
      ${campoEndereco(url)}`;
  }

  function htmlCriar(url) {
    return `
      ${abas()}
      <form data-form="criar">
        <div class="field"><label for="n-nome">Nome completo</label>
          <input id="n-nome" type="text" autocomplete="name" required placeholder="Como assina os RDOs"></div>
        <div class="field"><label for="n-email">E-mail</label>
          <input id="n-email" type="email" autocomplete="email" autocapitalize="off" required></div>
        <div class="field"><label for="n-senha">Senha (mínimo 6)</label>
          <input id="n-senha" type="password" autocomplete="new-password" minlength="6" required></div>
        <div class="field">
          <label>Assinatura — desenhe com o dedo</label>
          <canvas data-assina data-vazia="1" class="assina" aria-label="Desenhe sua assinatura"></canvas>
          <button type="button" class="btn ghost block" data-act="limpar-assina">${icon('trash', 15)}Limpar assinatura</button>
          <p class="dica">Assine dentro do quadro, como no papel. A assinatura vai junto com os seus RDOs.</p>
        </div>
        <button class="btn primary block" type="submit">Criar minha conta</button>
      </form>
      ${campoEndereco(url)}`;
  }

  function htmlEsqueci(url) {
    return `
      ${abas()}
      <form data-form="esqueci">
        <div class="field"><label for="s-email">E-mail da conta</label>
          <input id="s-email" type="email" autocapitalize="off" required value="${esc(emailEsqueci)}"></div>
        <button class="btn primary block" type="submit">Pedir código</button>
        <p class="dica">O pedido chega na central do Tiago Oliveira, que gera um código de 6 dígitos. Peça o código a ele e use a aba abaixo.</p>
      </form>
      <form data-form="redefinir" style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
        <div class="field"><label for="r-codigo">Código de 6 dígitos</label>
          <input id="r-codigo" type="text" inputmode="numeric" maxlength="6" pattern="[0-9]*" autocomplete="one-time-code" required></div>
        <div class="field"><label for="r-senha">Nova senha (mínimo 6)</label>
          <input id="r-senha" type="password" autocomplete="new-password" minlength="6" required></div>
        <button class="btn primary block" type="submit">Definir nova senha</button>
      </form>
      ${campoEndereco(url)}`;
  }

  function htmlConta(logado) {
    const u = logado || {};
    const end = endereco();
    return `
      <div class="card"><div class="body">
        <div class="name">${esc(u.nome || 'Sua conta')}</div>
        <div class="sub">${esc(u.email || '')}${u.mestre ? ' · conta principal' : ''}</div>
      </div></div>
      ${u.assinatura ? `<div class="field"><label>Sua assinatura</label><img class="assina-img" src="${esc(u.assinatura)}" alt="Assinatura"></div>` : ''}
      <button class="btn primary block" data-act="enviar">${icon('upload', 16)}Enviar meus RDOs agora</button>
      <button class="btn ghost block" data-act="recuperar">${icon('download', 16)}Baixar meus RDOs da central</button>
      <button class="btn ghost block" data-act="senha">${icon('lock', 16)}Trocar a senha</button>
      <button class="btn ghost block" data-act="nova-assinatura">${icon('file', 16)}Desenhar a assinatura de novo</button>
      <details class="central-end">
        <summary>Endereço da central</summary>
        <div class="field"><label for="c-url">Endereço</label>
          <input id="c-url" type="url" data-campo="url" value="${esc(end)}" autocapitalize="off" spellcheck="false"></div>
        <button class="btn ghost block" type="button" data-act="salvar-url">Salvar endereço</button>
      </details>
      <button class="btn danger block" data-act="sair">Sair da conta</button>
      <p class="dica">Ao sair, os RDOs desta conta ficam guardados no aparelho (e na central). Entrando de novo com a mesma conta, eles voltam.</p>`;
  }

  /** Tela de conta do portão (sem login) e a do menu (logado). */
  function tela() {
    const url = endereco();
    const html = ativo() ? htmlConta(usuario())
      : `<div class="conta-topo">${icon('lock', 20)}<span>Entre na sua conta para os seus RDOs chegarem na central do supervisor. Sem conta, o app continua valendo só neste aparelho.</span></div>
         ${msgHtml()}
         ${aba === 'criar' ? htmlCriar(url) : aba === 'esqueci' || aba === 'redefinir' ? htmlEsqueci(url) : htmlEntrar(url)}
         <button class="btn ghost block" data-act="sem-conta" style="margin-top:16px">Continuar sem conta neste aparelho</button>`;

    return {
      titulo: ativo() ? 'Minha Conta' : 'Sua conta',
      html,
      bind(root) {
        const urlDoCampo = () => root.querySelector('[data-campo="url"]')?.value || '';
        const ocupado = (botao, sim) => {
          if (!botao) return;
          if (sim) { botao.dataset.rotulo = botao.textContent; botao.disabled = true; botao.textContent = 'Aguarde...'; }
          else { botao.disabled = false; botao.textContent = botao.dataset.rotulo || botao.textContent; }
        };
        const falhar = (e) => { mostrarAviso(e.message || 'Não foi possível.'); redesenhar(); };

        root.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => {
          aba = b.dataset.aba;
          aviso = '';
          redesenhar();
        }));

        // cada formulário salva o endereço digitado antes de chamar a central
        root.querySelector('[data-form="entrar"]')?.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          aviso = '';
          definirEndereco(urlDoCampo());
          ocupado(ev.submitter, true);
          try {
            await entrar(root.querySelector('#c-email').value.trim(), root.querySelector('#c-senha').value);
            toast('Você entrou na sua conta.');
            irParaInicio();
          } catch (e) { falhar(e); }
        });

        root.querySelector('[data-form="criar"]')?.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          aviso = '';
          const assina = root.__assina;
          if (assina?.vazia()) { mostrarAviso('Desenhe sua assinatura no quadro antes de criar a conta.'); redesenhar(); return; }
          definirEndereco(urlDoCampo());
          ocupado(ev.submitter, true);
          try {
            await cadastrar({
              nome: root.querySelector('#n-nome').value,
              email: root.querySelector('#n-email').value.trim(),
              senha: root.querySelector('#n-senha').value,
              assinatura: assina.png(),
            });
            toast('Conta criada. Seus RDOs já podem ir para a central.');
            irParaInicio();
          } catch (e) { falhar(e); }
        });

        root.querySelector('[data-form="esqueci"]')?.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          aviso = '';
          definirEndereco(urlDoCampo());
          emailEsqueci = root.querySelector('#s-email').value.trim();
          ocupado(ev.submitter, true);
          try {
            const texto = await esqueci(emailEsqueci);
            mostrarAviso(texto, 'ok');
            aba = 'esqueci';
            redesenhar();
          } catch (e) { falhar(e); }
        });

        root.querySelector('[data-form="redefinir"]')?.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          aviso = '';
          definirEndereco(urlDoCampo());
          ocupado(ev.submitter, true);
          try {
            await redefinir(emailEsqueci, root.querySelector('#r-codigo').value, root.querySelector('#r-senha').value);
            toast('Senha nova definida. Você já está na conta.');
            irParaInicio();
          } catch (e) { falhar(e); }
        });

        root.querySelector('[data-act="limpar-assina"]')?.addEventListener('click', () => root.__assina?.limpar());
        root.__assina = ligarAssinatura(root);

        root.querySelector('[data-act="sem-conta"]')?.addEventListener('click', () => {
          localStorage.setItem(CHAVE_SEM_CONTA, '1');
          irParaInicio();
        });

        // ---- conta aberta pelo menu
        root.querySelector('[data-act="enviar"]')?.addEventListener('click', async (ev) => {
          ocupado(ev.currentTarget, true);
          try {
            const r = await enviarTudo({ silencioso: true });
            toast(r.enviados ? `${r.enviados} RDO(s) enviado(s).` : 'Nada novo para enviar.');
          } catch (e) { toast(e.message); }
          ocupado(ev.currentTarget, false);
        });

        root.querySelector('[data-act="recuperar"]')?.addEventListener('click', async (ev) => {
          ocupado(ev.currentTarget, true);
          try {
            const n = await recuperar();
            toast(n ? `${n} RDO(s) voltaram da central.` : 'Todos os RDOs da central já estão aqui.');
            if (n) redesenhar();
          } catch (e) { toast(e.message); }
          ocupado(ev.currentTarget, false);
        });

        root.querySelector('[data-act="senha"]')?.addEventListener('click', async () => {
          const v = await sheet({
            title: 'Trocar a senha',
            fields: [
              { key: 'atual', label: 'Senha atual', type: 'password' },
              { key: 'nova', label: 'Senha nova (mínimo 6)', type: 'password' },
            ],
            submit: 'Trocar',
          });
          if (!v) return;
          try {
            await atualizarPerfil({ senhaAtual: v.atual, senhaNova: v.nova });
            toast('Senha trocada.');
          } catch (e) { toast(e.message); }
        });

        root.querySelector('[data-act="nova-assinatura"]')?.addEventListener('click', () => {
          const scrim = document.createElement('div');
          scrim.className = 'scrim';
          scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
            <h2>Assinatura</h2>
            <canvas data-assina data-vazia="1" class="assina" aria-label="Desenhe sua assinatura"></canvas>
            <div class="sheet-actions">
              <button class="btn ghost" data-act="cancelar" type="button">Cancelar</button>
              <button class="btn ghost" data-act="limpar" type="button">Limpar</button>
              <button class="btn primary" data-act="salvar" type="button">Salvar</button>
            </div></div>`;
          document.body.appendChild(scrim);
          const assina = ligarAssinatura(scrim);
          const fechar = () => scrim.remove();
          scrim.addEventListener('click', async (e) => {
            if (e.target === scrim) return fechar();
            const act = e.target.closest('[data-act]')?.dataset.act;
            if (act === 'cancelar') return fechar();
            if (act === 'limpar') return assina.limpar();
            if (act === 'salvar') {
              if (assina.vazia()) { toast('Desenhe a assinatura primeiro.'); return; }
              try {
                await atualizarPerfil({ assinatura: assina.png() });
                toast('Assinatura atualizada.');
                fechar();
                redesenhar();
              } catch (err) { toast(err.message); }
            }
          });
        });

        root.querySelector('[data-act="salvar-url"]')?.addEventListener('click', () => {
          definirEndereco(urlDoCampo());
          toast('Endereço da central salvo.');
        });

        root.querySelector('[data-act="sair"]')?.addEventListener('click', async () => {
          const ok = await confirmar('Sair da conta',
            'Os RDOs desta conta ficam guardados no aparelho e na central. Para reabrir, entre de novo com o mesmo e-mail.', 'Sair');
          if (!ok) return;
          await sair();
          aba = 'entrar';
          aviso = '';
          irParaInicio();
        });
      },
    };
  }

  return {
    ativo, semConta, usuario, endereco, api,
    entrar, cadastrar, esqueci, redefinir, sair,
    enviarTudo, agendar, recuperar, definirEndereco,
    tela, ligarAssinatura,
    get sessao() { return sessao; },
  };
})();
