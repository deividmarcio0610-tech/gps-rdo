/*
 * Conta do funcionário no banco na nuvem: entrar, criar conta (com assinatura desenhada à
 * mão), esqueci a senha e a troca dos RDOs com o banco (js/nuvem.js).
 *
 * O aparelho guarda a sessão e os RDOs: no campo, sem sinal, o app abre e lança do mesmo
 * jeito; os RDOs sobem quando a internet volta e as correções do supervisor descem na
 * próxima vez que o app abrir. A conta é obrigatória — sem ela o app não abre.
 */
window.Conta = (() => {
  'use strict';

  const { esc, toast, sheet, icon, confirmar } = UI;
  const CHAVE = 'gps_rdo_conta_v1';
  const CHAVE_ENVIADOS = 'gps_rdo_enviado_v1';

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

  const ativo = () => Boolean(sessao?.usuario?.id);
  const usuario = () => sessao?.usuario || null;
  const ehMestre = () => Boolean(sessao?.usuario?.mestre);

  function usarPerfil(perfil) {
    sessao = { usuario: perfil };
    salvarSessao();
    Store.usarConta(perfil.id);
    return perfil;
  }

  // ------------------------------------------------------------ entrar / sair

  const entrar = async (email, senha) => {
    const perfil = await Nuvem.entrar(email, senha);
    usarPerfil(perfil);
    return perfil;
  };

  const cadastrar = async (dados) => {
    const perfil = await Nuvem.cadastrar(dados);
    usarPerfil(perfil);
    return perfil;
  };

  /** Manda o link de senha nova para o e-mail da conta (não precisa de código do supervisor). */
  const esqueci = async (email) => {
    await Nuvem.esqueci(email);
    return `Se este e-mail tiver conta, o link para criar uma senha nova chega nele em instantes (veja também a caixa de spam).`;
  };

  async function sair() {
    const id = sessao?.usuario?.id;
    try { await Nuvem.sair(); } catch { /* sem rede: sai do mesmo jeito */ }
    sessao = null;
    salvarSessao();
    // nada é apagado do aparelho; quem entrar de novo reencontra os RDOs da conta
    Store.usarConta('');
    return id;
  }

  // ------------------------------------------------------------ troca com o banco

  let timer = null;
  let retryTimer = null;
  let tentativasRetry = 0;
  let sincronizando = false;
  let ouvintesLigados = false;

  const CHAVE_APAGADOS = 'gps_rdo_apagados_v1';
  const CHAVE_ERROS = 'gps_rdo_erros_v1';
  const CHAVE_ULTIMA = 'gps_rdo_ultima_sync_v1';

  const chaveDe = (base) => `${base}:${sessao?.usuario?.id || ''}`;
  const lerMapa = (base) => {
    try { return JSON.parse(localStorage.getItem(chaveDe(base)) || '{}'); } catch { return {}; }
  };
  const gravarMapa = (base, mapa) => {
    try { localStorage.setItem(chaveDe(base), JSON.stringify(mapa)); } catch { /* sem espaço: tenta de novo no próximo envio */ }
  };

  const mapaEnviados = () => lerMapa(CHAVE_ENVIADOS);
  const marcarEnviado = (id, quando) => {
    const mapa = mapaEnviados();
    mapa[id] = quando;
    gravarMapa(CHAVE_ENVIADOS, mapa);
  };

  // Exclusões: sem a lápide, o RDO apagado no aparelho desceria de novo do banco.
  const marcarApagado = (docId) => {
    const mapa = lerMapa(CHAVE_APAGADOS);
    mapa[docId] = Date.now();
    gravarMapa(CHAVE_APAGADOS, mapa);
  };
  const desmarcarApagado = (docId) => {
    const mapa = lerMapa(CHAVE_APAGADOS);
    if (!(docId in mapa)) return;
    delete mapa[docId];
    gravarMapa(CHAVE_APAGADOS, mapa);
  };

  // Falhas que não adiantam repetir (4xx de regra/dado/token): ficam registradas por
  // versão do RDO; só uma edição nova faz o app tentar de novo.
  const PERMANENTES = new Set(['permission-denied', 'invalid-argument', 'unauthenticated']);
  const permanente = (e) => PERMANENTES.has(String(e?.codigo || e?.code || ''));
  const mapaErros = () => lerMapa(CHAVE_ERROS);

  /** RDOs que ainda precisam subir (versão local mais nova que a última enviada). */
  function pendentes() {
    const enviados = mapaEnviados();
    const erros = mapaErros();
    return Store.rdos.filter((r) => {
      const quando = Number(r.atualizado) || 0;
      if (erros[r.id]?.versao === quando) return false;
      return quando > (Number(enviados[r.id]) || 0);
    });
  }

  /** Resumo para a tela: fila, última sincronização e se há internet. */
  function textoStatus() {
    const fila = pendentes().length;
    const u = Number(localStorage.getItem(chaveDe(CHAVE_ULTIMA))) || 0;
    const hora = u ? new Date(u).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    const partes = [fila ? `${fila} RDO(s) aguardando envio` : 'Tudo enviado ao banco'];
    if (hora) partes.push(`última sincronização ${hora}`);
    if (navigator.onLine === false) partes.push('sem internet agora');
    return partes.join(' · ');
  }

  function atualizarStatus() {
    const el = document.querySelector?.('[data-sync]');
    if (el) el.textContent = textoStatus();
  }

  const statusSync = () => ({
    pendentes: pendentes().length,
    erros: Object.keys(mapaErros()).length,
    sincronizando,
    ultima: Number(localStorage.getItem(chaveDe(CHAVE_ULTIMA))) || 0,
  });

  /** Sobe um RDO; se ele for de outra pessoa (supervisor corrigindo), grava no documento do dono. */
  async function publicarUm(rdo) {
    const meu = usuario();
    if (!meu) return null;
    if (rdo.dono && rdo.dono !== meu.id) return Nuvem.publicarComo(rdo.dono, rdo);
    return Nuvem.publicar(rdo);
  }

  /**
   * Traz um RDO do banco para o aparelho: o JSON inteiro e as fotos, que voltam para o
   * IndexedDB deste aparelho (guardadas com o mesmo carimbo de antes).
   */
  async function baixarRdo(registro) {
    const base = registro.json;
    if (!base?.id || Store.find(base.id)) return false;
    const rdo = { stoppages: [], ...base };
    rdo.dono = registro.dono || null;
    rdo.donoNome = registro.nome || '';
    rdo._docId = registro.docId;
    const metas = Array.isArray(rdo.photos) ? rdo.photos : [];
    const imagens = await Nuvem.fotosDe(registro.docId).catch(() => []);
    const fotos = [];
    for (let i = 0; i < Math.max(metas.length, imagens.length); i += 1) {
      const meta = metas[i] || {};
      const guardada = imagens[i] ? await Fotos.salvar(imagens[i]).catch(() => null) : null;
      if (guardada?.foto) fotos.push({ ...meta, foto: guardada.foto, data: undefined });
      else if (imagens[i]) fotos.push({ ...meta, data: imagens[i] });
    }
    if (fotos.length) rdo.photos = fotos;
    const entrou = Store.importar([rdo], {});
    marcarEnviado(rdo.id, Number(rdo.atualizado) || 0);
    return entrou > 0;
  }

  /**
   * Acerta o aparelho com o banco: sobe o que mudou aqui e desce o que mudou lá
   * (correção do supervisor, RDO feito em outro celular). Sem rede, não faz nada.
   */
  async function sincronizar({ silencioso = true } = {}) {
    if (!ativo()) return { enviados: 0, recebidos: 0 };
    if (!Nuvem.configurado()) return { enviados: 0, recebidos: 0, semBanco: true };
    if (sincronizando) return { enviados: 0, recebidos: 0, ocupado: true };
    sincronizando = true;
    try {
      // 1. exclusões pendentes: o que foi apagado no aparelho sai do banco (a lápide só
      //    cai depois que o banco confirma; sem rede ela espera a próxima volta)
      const apagados = lerMapa(CHAVE_APAGADOS);
      for (const docId of Object.keys(apagados)) {
        try {
          await Nuvem.apagar(docId);
          desmarcarApagado(docId);
        } catch (e) {
          // documento que não existe mais: nada a repetir
          if (permanente(e)) desmarcarApagado(docId);
        }
      }
      const lapes = lerMapa(CHAVE_APAGADOS);

      const enviadosAntes = mapaEnviados();
      const erros = mapaErros();
      const nuvem = await Nuvem.meusRdos();
      const porId = new Map();
      nuvem.forEach((n) => {
        if (!lapes[n.docId]) porId.set(n.json.id, n);
      });

      let enviados = 0;
      let recebidos = 0;

      for (const r of Store.rdos.slice()) {
        const marca = Number(enviadosAntes[r.id]) || 0;
        const quando = Number(r.atualizado) || 0;
        // 4xx já visto nesta versão: não repete (uma edição nova muda o carimbo)
        if (erros[r.id]?.versao === quando) continue;
        if (!porId.has(r.id) || quando > marca) {
          try {
            await publicarUm(r);
            marcarEnviado(r.id, quando);
            delete erros[r.id];
            enviados += 1;
          } catch (e) {
            // falha de rede fica só na fila; 4xx fica registrado e exposto na tela
            if (permanente(e)) erros[r.id] = { versao: quando, erro: e.message, em: Date.now() };
          }
        }
      }
      gravarMapa(CHAVE_ERROS, erros);

      for (const n of nuvem) {
        if (lapes[n.docId]) continue; // apagado aqui: não desce de novo
        const local = Store.find(n.json.id);
        if (!local) {
          if (await baixarRdo(n).catch(() => false)) recebidos += 1;
          continue;
        }
        if (n.atualizado > (Number(local.atualizado) || 0)) {
          // correção vinda do banco: texto e listas; as fotos do aparelho ficam
          Store.update(local.id, (x) => {
            const fotos = x.photos?.length ? x.photos : (n.json.photos || []);
            Object.assign(x, n.json, { photos: fotos, dono: n.dono, atualizado: n.atualizado });
          }, { deBanco: true });
          marcarEnviado(local.id, n.atualizado);
          recebidos += 1;
        }
      }

      if (!silencioso) {
        const partes = [];
        if (enviados) partes.push(`${enviados} enviado(s)`);
        if (recebidos) partes.push(`${recebidos} recebido(s)`);
        toast(partes.length ? `Banco: ${partes.join(' · ')}.` : 'Tudo igual entre o aparelho e o banco.');
      }
      return { enviados, recebidos };
    } catch (e) {
      if (!silencioso) toast(e.message);
      return { enviados: 0, recebidos: 0, erro: e.message };
    } finally {
      sincronizando = false;
      try { localStorage.setItem(chaveDe(CHAVE_ULTIMA), String(Date.now())); } catch { /* sem espaço */ }
      atualizarStatus();
      agendarRetry();
    }
  }

  const enviarTudo = (opcoes) => sincronizar(opcoes);

  /**
   * Agenda a troca com o banco (usada a cada gravação no aparelho). Com internet, sobe em
   * ~1 s; sem internet, o Firestore já guarda a gravação em fila local e o retry cuida dela.
   */
  function agendar() {
    if (!ativo()) return;
    clearTimeout(timer);
    const espera = navigator.onLine === false ? 4000 : 1200;
    timer = setTimeout(() => { sincronizar({ silencioso: true }).catch(() => {}); }, espera);
  }

  /** Reenvio com espera crescente enquanto houver fila e rede (15 s → no máximo 5 min). */
  function agendarRetry() {
    clearTimeout(retryTimer);
    if (!ativo() || !pendentes().length || navigator.onLine === false) {
      tentativasRetry = 0;
      return;
    }
    const espera = Math.min(15000 * 2 ** tentativasRetry, 300000);
    tentativasRetry = Math.min(tentativasRetry + 1, 5);
    retryTimer = setTimeout(() => { sincronizar({ silencioso: true }).catch(() => {}); }, espera);
  }

  /**
   * Gatilhos de sincronização além da gravação: volta da internet, app em primeiro plano
   * e reabertura. No navegador/WebView não existe sincronização com o app fechado.
   */
  function ligarRede() {
    if (ouvintesLigados) return;
    ouvintesLigados = true;
    window.addEventListener?.('online', () => {
      tentativasRetry = 0;
      sincronizar({ silencioso: true }).catch(() => {});
    });
    window.addEventListener?.('offline', () => { clearTimeout(retryTimer); });
    document.addEventListener?.('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) {
        sincronizar({ silencioso: true }).catch(() => {});
      }
    });
    window.addEventListener?.('focus', () => {
      if (navigator.onLine !== false) sincronizar({ silencioso: true }).catch(() => {});
    });
  }

  /** Só traz o que falta no aparelho (celular novo, cópia perdida). */
  async function recuperar() {
    const r = await sincronizar({ silencioso: true });
    return r.recebidos || 0;
  }

  /** RDO apagado no aparelho sai do banco também (ou fica na lápide para a próxima volta). */
  async function apagarNaNuvem(rdo) {
    if (!ativo() || !rdo || !Nuvem.configurado()) return;
    const dono = rdo.dono || usuario()?.id;
    if (!dono) return;
    const docId = Nuvem.idDoc(dono, rdo.id);
    marcarApagado(docId);
    try {
      await Nuvem.apagar(docId);
      desmarcarApagado(docId);
    } catch (e) {
      // sem rede: a lápide espera; 4xx: não existe mais ou não é nosso — não insiste
      if (permanente(e)) desmarcarApagado(docId);
    }
  }

  /**
   * Abre no aparelho um RDO de outra pessoa (supervisor): baixa do banco e devolve o id
   * local para o app abrir. O campo `dono` marca de quem é, para a correção voltar certa.
   */
  async function abrirDoBanco(registro) {
    const achado = Store.find(registro.json?.id);
    if (achado) return achado.id;
    const desceu = await baixarRdo(registro);
    if (!desceu) throw new Error('Não foi possível abrir este RDO agora.');
    return Store.find(registro.json.id)?.id || null;
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

  let aba = 'entrar';      // entrar | criar | esqueci
  let aviso = '';
  let avisoTipo = 'erro';
  let emailEsqueci = '';

  const mostrarAviso = (texto, tipo = 'erro') => { aviso = texto; avisoTipo = tipo; };

  const abas = () => `
    <div class="abas">
      ${[['entrar', 'Entrar'], ['criar', 'Criar conta'], ['esqueci', 'Esqueci a senha']].map(([v, t]) => `
        <button type="button" class="aba${aba === v ? ' ativa' : ''}" data-aba="${v}">${t}</button>`).join('')}
    </div>`;

  const msgHtml = () => (aviso ? `<div class="aviso ${avisoTipo === 'ok' ? 'ok' : 'erro'}">${esc(aviso)}</div>` : '');

  const semBanco = () => (Nuvem.configurado() ? ''
    : `<div class="aviso erro">O banco na nuvem ainda não foi ligado neste app. Quem publicou precisa colar a configuração do Firebase (js/firebase-config.js).</div>`);

  function htmlEntrar() {
    return `
      ${abas()}
      <form data-form="entrar">
        <div class="field"><label for="c-email">E-mail</label>
          <input id="c-email" type="email" autocomplete="username" autocapitalize="off" required></div>
        <div class="field"><label for="c-senha">Senha</label>
          <input id="c-senha" type="password" autocomplete="current-password" required></div>
        <button class="btn primary block" type="submit">Entrar</button>
      </form>
      <p class="dica link-cadastro">Não tem conta? <button type="button" class="link-btn" data-aba="criar">Criar cadastro</button></p>`;
  }

  function htmlCriar() {
    return `
      ${abas()}
      <form data-form="criar">
        <div class="field"><label for="n-nome">Nome completo</label>
          <input id="n-nome" type="text" autocomplete="name" required placeholder="Como assina os RDOs"></div>
        <div class="field"><label for="n-funcao">Função</label>
          <input id="n-funcao" type="text" required placeholder="Ex.: Mecânico, Eletricista, Supervisor"></div>
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
        <div class="field">
          <label>Foto do rosto</label>
          <input id="n-facial" type="file" accept="image/*" capture="user" hidden>
          <button type="button" class="btn ghost block" data-act="facial">${icon('camera', 16)}Tirar a foto do rosto</button>
          <img class="rosto-img" data-facial-preview hidden alt="Foto do rosto">
          <p class="dica">A foto identifica quem preencheu o RDO. Fica guardada só na sua conta e na conta principal;
            não vai no PDF nem no WhatsApp.</p>
        </div>
        <button class="btn primary block" type="submit">Criar minha conta</button>
      </form>`;
  }

  function htmlEsqueci() {
    return `
      ${abas()}
      <form data-form="esqueci">
        <div class="field"><label for="s-email">E-mail da conta</label>
          <input id="s-email" type="email" autocapitalize="off" required value="${esc(emailEsqueci)}"></div>
        <button class="btn primary block" type="submit">Mandar o link por e-mail</button>
        <p class="dica">O link chega no e-mail da conta e abre a tela de criar uma senha nova. Não precisa de código do supervisor.</p>
      </form>`;
  }

  function htmlConta(logado) {
    const u = logado || {};
    return `
      <div class="card"><div class="body">
        <div class="name">${esc(u.nome || 'Sua conta')}</div>
        <div class="sub">${esc(u.funcao ? `${u.funcao} · ` : '')}${esc(u.email || '')}${u.mestre ? ' · conta principal' : ''}</div>
      </div></div>
      ${u.deveTrocarSenha ? `<div class="conta-topo">${icon('lock', 18)}<span>Você entrou com a senha provisória.
        Troque a senha agora em “Trocar a senha”; ela é pessoal e não deve ficar com outra pessoa.</span></div>` : ''}
      <div class="sub" data-sync>${esc(textoStatus())}</div>
      <div class="sub">Versão ${esc(Pwa.versao?.() || '—')}</div>
      <div data-atualizacao hidden></div>
      ${u.facial ? `<div class="field"><label>Foto do rosto</label><img class="rosto-img" src="${esc(u.facial)}" alt="Foto do rosto"></div>` : ''}
      ${u.assinatura ? `<div class="field"><label>Sua assinatura</label><img class="assina-img" src="${esc(u.assinatura)}" alt="Assinatura"></div>` : ''}
      <button class="btn primary block" data-act="enviar">${icon('upload', 16)}Enviar meus RDOs agora</button>
      <button class="btn ghost block" data-act="recuperar">${icon('download', 16)}Trazer os RDOs do banco</button>
      <button class="btn ghost block" data-act="atualizar">${icon('download', 16)}Procurar atualização do app</button>
      <button class="btn ghost block" data-act="recuperar-senha">${icon('mail', 16)}Recuperar a senha por e-mail</button>
      <button class="btn ghost block" data-act="senha">${icon('lock', 16)}Trocar a senha</button>
      <button class="btn ghost block" data-act="foto-rosto">${icon('camera', 16)}${u.facial ? 'Trocar a foto do rosto' : 'Tirar a foto do rosto'}</button>
      <input type="file" accept="image/*" capture="user" data-entrada-rosto hidden>
      <button class="btn ghost block" data-act="nova-assinatura">${icon('file', 16)}Desenhar a assinatura de novo</button>
      <button class="btn danger block" data-act="sair">Sair da conta</button>
      <p class="dica">Os RDOs desta conta ficam no aparelho e no banco na nuvem. Ao sair, nada é apagado:
        entrando de novo com a mesma conta, eles voltam.</p>`;
  }

  /** Tela de conta do portão (sem login) e a do menu (logado). */
  function tela() {
    const html = ativo() ? htmlConta(usuario())
      : `<div class="conta-topo">${icon('lock', 20)}<span>Entre na sua conta. Os RDOs ficam no aparelho (funciona sem sinal) e chegam no banco do supervisor quando tiver internet.</span></div>
         ${semBanco()}
         ${msgHtml()}
         ${aba === 'criar' ? htmlCriar() : aba === 'esqueci' ? htmlEsqueci() : htmlEntrar()}`;

    return {
      titulo: ativo() ? 'Minha Conta' : 'Sua conta',
      html,
      bind(root) {
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

        root.querySelector('[data-form="entrar"]')?.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          aviso = '';
          ocupado(ev.submitter, true);
          try {
            await entrar(root.querySelector('#c-email').value.trim(), root.querySelector('#c-senha').value);
            toast('Você entrou na sua conta.');
            irParaInicio();
            sincronizar({ silencioso: true }).catch(() => {});
          } catch (e) { falhar(e); }
        });

        root.querySelector('[data-form="criar"]')?.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          aviso = '';
          const assina = root.__assina;
          if (assina?.vazia()) { mostrarAviso('Desenhe sua assinatura no quadro antes de criar a conta.'); redesenhar(); return; }
          if (!root.__facial) { mostrarAviso('Tire a foto do rosto antes de criar a conta.'); redesenhar(); return; }
          ocupado(ev.submitter, true);
          try {
            await cadastrar({
              nome: root.querySelector('#n-nome').value,
              funcao: root.querySelector('#n-funcao').value,
              email: root.querySelector('#n-email').value.trim(),
              senha: root.querySelector('#n-senha').value,
              assinatura: assina.png(),
              facial: root.__facial,
            });
            toast('Conta criada. Seus RDOs já podem ir para o banco.');
            irParaInicio();
            sincronizar({ silencioso: true }).catch(() => {});
          } catch (e) { falhar(e); }
        });

        root.querySelector('[data-form="esqueci"]')?.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          aviso = '';
          emailEsqueci = root.querySelector('#s-email').value.trim();
          ocupado(ev.submitter, true);
          try {
            const texto = await esqueci(emailEsqueci);
            mostrarAviso(texto, 'ok');
            redesenhar();
          } catch (e) { falhar(e); }
        });

        root.querySelector('[data-act="limpar-assina"]')?.addEventListener('click', () => root.__assina?.limpar());
        root.__assina = ligarAssinatura(root);

        // foto do rosto no cadastro: câmera da frente, reduzida antes de guardar
        const entradaFacial = root.querySelector('#n-facial');
        const botaoFacial = root.querySelector('[data-act="facial"]');
        botaoFacial?.addEventListener('click', () => entradaFacial?.click());
        entradaFacial?.addEventListener('change', async () => {
          const arquivo = entradaFacial.files?.[0];
          if (!arquivo) return;
          botaoFacial.disabled = true;
          try {
            root.__facial = await Fotos.reduzir(arquivo, { lado: 480, qualidade: 0.75 });
            const previa = root.querySelector('[data-facial-preview]');
            previa.src = root.__facial;
            previa.hidden = false;
            botaoFacial.textContent = 'Trocar a foto do rosto';
          } catch {
            mostrarAviso('Não consegui usar esta foto. Tire outra com a câmera.', 'erro');
            redesenhar();
          } finally { botaoFacial.disabled = false; }
        });

        // ---- conta aberta pelo menu
        root.querySelector('[data-act="enviar"]')?.addEventListener('click', async (ev) => {
          ocupado(ev.currentTarget, true);
          const r = await sincronizar({ silencioso: false });
          ocupado(ev.currentTarget, false);
          if (r.erro) toast(r.erro);
        });

        root.querySelector('[data-act="recuperar"]')?.addEventListener('click', async (ev) => {
          ocupado(ev.currentTarget, true);
          const r = await sincronizar({ silencioso: true });
          ocupado(ev.currentTarget, false);
          if (r.erro) { toast(r.erro); return; }
          toast(r.recebidos ? `${r.recebidos} RDO(s) vieram do banco.` : 'Todos os RDOs do banco já estão aqui.');
          if (r.recebidos) redesenhar();
        });

        root.querySelector('[data-act="atualizar"]')?.addEventListener('click', async (ev) => {
          ocupado(ev.currentTarget, true);
          const achou = await Pwa.checarAtualizacao?.();
          ocupado(ev.currentTarget, false);
          if (achou) toast('Procurando versão nova; se houver, o app se atualiza sozinho.');
          else toast('Não consegui conferir agora. Tente com internet.');
        });

        // APK não se atualiza sozinho: avisa quando a release publicada é mais nova
        Pwa.versaoNovaDoApk?.().then((nova) => {
          if (!nova) return;
          const box = root.querySelector('[data-atualizacao]');
          if (!box) return;
          box.hidden = false;
          box.innerHTML = `<button class="btn primary block" data-act="baixar-apk">${icon('download', 16)}Baixar a versão ${esc(nova.versao)} do app</button>`;
          box.querySelector('[data-act="baixar-apk"]')?.addEventListener('click', () => {
            window.open(nova.url, '_system');
          });
        }).catch(() => {});

        root.querySelector('[data-act="recuperar-senha"]')?.addEventListener('click', async (ev) => {
          const conta = usuario();
          if (!conta?.email) return;
          ocupado(ev.currentTarget, true);
          try {
            await esqueci(conta.email);
            toast('Link de senha nova enviado para o seu e-mail.');
          } catch (e) { toast(e.message); }
          finally { ocupado(ev.currentTarget, false); }
        });

        root.querySelector('[data-act="senha"]')?.addEventListener('click', async () => {
          const v = await sheet({
            title: 'Trocar a senha',
            fields: [
              { key: 'atual', label: 'Senha atual', type: 'password' },
              { key: 'nova', label: 'Senha nova (mínimo 6)', type: 'password' },
              { key: 'repete', label: 'Repita a senha nova', type: 'password' },
            ],
            submit: 'Trocar',
          });
          if (!v) return;
          if (String(v.nova || '').length < 6) { toast('A senha nova precisa de pelo menos 6 caracteres.'); return; }
          if (v.nova !== v.repete) { toast('As duas senhas novas não são iguais.'); return; }
          try {
            const perfil = await Nuvem.trocarSenha(v.atual, v.nova).then(() => Nuvem.perfil({ recarregar: true }));
            if (sessao && perfil) { sessao.usuario = perfil; salvarSessao(); }
            toast('Senha trocada.');
            redesenhar();
          } catch (e) { toast(e.message); }
        });

        const entradaRosto = root.querySelector('[data-entrada-rosto]');
        root.querySelector('[data-act="foto-rosto"]')?.addEventListener('click', () => entradaRosto?.click());
        entradaRosto?.addEventListener('change', async () => {
          const arquivo = entradaRosto.files?.[0];
          if (!arquivo) return;
          try {
            const facial = await Fotos.reduzir(arquivo, { lado: 480, qualidade: 0.75 });
            const perfil = await Nuvem.salvarPerfil({ facial });
            if (sessao) { sessao.usuario = perfil; salvarSessao(); }
            toast('Foto do rosto guardada.');
            redesenhar();
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
                const perfil = await Nuvem.salvarPerfil({ assinatura: assina.png() });
                if (sessao) { sessao.usuario = perfil; salvarSessao(); }
                toast('Assinatura atualizada.');
                fechar();
                redesenhar();
              } catch (err) { toast(err.message); }
            }
          });
        });

        root.querySelector('[data-act="sair"]')?.addEventListener('click', async () => {
          const ok = await confirmar('Sair da conta',
            'Os RDOs desta conta ficam guardados no aparelho e no banco. Para reabrir, entre de novo com o mesmo e-mail.', 'Sair');
          if (!ok) return;
          await sair();
          aba = 'entrar';
          aviso = '';
          irParaInicio();
        });
      },
    };
  }

  // ------------------------------------------------------------ ligação com o banco ao abrir

  /**
   * Chamado uma vez pelo app.js. Deixa o banco pronto e acompanha a sessão: quando o
   * Firebase diz quem entrou, o perfil local (e a tela) acompanham, e os RDOs trocam.
   */
  async function iniciar() {
    ligarRede();
    if (!Nuvem.configurado()) return;
    try {
      Nuvem.aoMudar(async (user) => {
        if (!user) {
          if (sessao?.usuario?.id) { sessao = null; salvarSessao(); Store.usarConta(''); redesenhar(); }
          return;
        }
        const perfil = await Nuvem.perfil({ recarregar: true }).catch(() => null);
        if (!perfil) return;
        const trocou = sessao?.usuario?.id !== perfil.id;
        const mudou = JSON.stringify(sessao?.usuario || {}) !== JSON.stringify(perfil);
        if (trocou || mudou) {
          usarPerfil(perfil);
          redesenhar();
        }
        sincronizar({ silencioso: true }).catch(() => {});
      });
    } catch { /* sem banco configurado: o portão mostra o aviso */ }
  }

  return {
    iniciar, ativo, usuario, ehMestre,
    entrar, cadastrar, esqueci, sair,
    enviarTudo, sincronizar, agendar, recuperar, apagarNaNuvem,
    pendentes, statusSync, textoStatus,
    abrirDoBanco,
    tela, ligarAssinatura,
    get sessao() { return sessao; },
  };
})();
