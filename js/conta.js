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

  const { esc, toast, sheet, icon } = UI;
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
    clearTimeout(timer);
    clearTimeout(retryTimer);
    try { await Nuvem.sair(); } catch { /* sem rede: sai do mesmo jeito */ }
    sessao = null;
    salvarSessao();
    vista = null;
    // nada é apagado do aparelho; quem entrar de novo reencontra os RDOs da conta
    Store.usarConta('');
    // lista e PDF que a conta principal deixou montados não ficam para a conta seguinte
    window.Mestre?.limpar?.();
    return id;
  }

  // ------------------------------------------------------------ troca com o banco

  let timer = null;
  let retryTimer = null;
  let tentativasRetry = 0;
  let sincronizando = false;
  let pedidoNaFila = false;        // pediram sincronização enquanto outra rodava
  let ouvintesLigados = false;
  let ultimaCompleta = 0;          // última vez que este aparelho conferiu a lista inteira do banco
  /*
   * O que a última conferência viu no banco: id do RDO → { docId, atualizado }. Enquanto ela
   * vale, cada gravação no aparelho sobe só o que mudou. Antes, cada gravação relia do banco
   * TODOS os RDOs da conta (com 100 RDOs, 100 leituras a cada toque em Salvar), o que gasta
   * a franquia de dados do celular e o limite diário de leituras do banco.
   */
  let vista = null;                // { uid, em, porId }
  const VALIDADE_VISTA = 10 * 60 * 1000;
  const FOLGA_AUTOMATICA = 60 * 1000;

  const CHAVE_APAGADOS = 'gps_rdo_apagados_v1';
  const CHAVE_ERROS = 'gps_rdo_erros_v1';
  const CHAVE_ULTIMA = 'gps_rdo_ultima_sync_v1';

  const meuId = () => sessao?.usuario?.id || '';
  const chaveDe = (base) => `${base}:${meuId()}`;
  const lerMapa = (base) => {
    try { return JSON.parse(localStorage.getItem(chaveDe(base)) || '{}') || {}; } catch { return {}; }
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
  // Guarda quantas fotos ele tinha, para apagar as fotos do banco sem precisar baixá-las.
  const marcarApagado = (docId, fotos) => {
    const mapa = lerMapa(CHAVE_APAGADOS);
    mapa[docId] = { em: Date.now(), fotos: Number.isInteger(fotos) ? fotos : null };
    gravarMapa(CHAVE_APAGADOS, mapa);
  };
  const desmarcarApagado = (docId) => {
    const mapa = lerMapa(CHAVE_APAGADOS);
    if (!(docId in mapa)) return;
    delete mapa[docId];
    gravarMapa(CHAVE_APAGADOS, mapa);
  };
  const fotosDaLapide = (info) => (info && typeof info === 'object' && Number.isInteger(info.fotos) ? info.fotos : undefined);

  // Falhas que não adiantam repetir (4xx de regra/dado/token): ficam registradas por
  // versão do RDO; só uma edição nova faz o app tentar de novo.
  const PERMANENTES = new Set(['permission-denied', 'invalid-argument', 'unauthenticated']);
  const permanente = (e) => PERMANENTES.has(String(e?.codigo || e?.code || ''));
  // Falhas de sinal: se uma aconteceu, as próximas da mesma rodada vão acontecer também.
  const DE_REDE = new Set(['unavailable', 'deadline-exceeded', 'auth/network-request-failed', 'sem-sessao']);
  const deRede = (e) => DE_REDE.has(String(e?.codigo || e?.code || ''));
  const mapaErros = () => lerMapa(CHAVE_ERROS);

  /** RDO de outra pessoa aberto neste aparelho (só acontece na conta principal). */
  const ehDeOutro = (r) => Boolean(r?.dono && r.dono !== meuId());

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

  /** RDOs que o banco recusou (a versão de agora); a lista mostra o selo e a conta, o motivo. */
  function comErro() {
    const erros = mapaErros();
    return Store.rdos
      .filter((r) => erros[r.id]?.versao === (Number(r.atualizado) || 0))
      .map((r) => ({ id: r.id, number: r.number, erro: erros[r.id].erro }));
  }

  /** Resumo para a tela: fila, recusados, última sincronização e se há internet. */
  function textoStatus() {
    const fila = pendentes().length;
    const recusados = comErro().length;
    const u = Number(localStorage.getItem(chaveDe(CHAVE_ULTIMA))) || 0;
    const hora = u ? new Date(u).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    const partes = [];
    if (fila) partes.push(`${fila} RDO(s) aguardando envio`);
    if (recusados) partes.push(`${recusados} RDO(s) recusado(s) pelo banco`);
    if (!fila && !recusados) partes.push('Tudo enviado ao banco');
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
  async function publicarUm(rdo, infoDoDono) {
    const meu = usuario();
    if (!meu) return null;
    if (ehDeOutro(rdo)) return Nuvem.publicarComo(rdo.dono, rdo, infoDoDono);
    return Nuvem.publicar(rdo);
  }

  /**
   * Monta, a partir do banco, o RDO como ele deve ficar neste aparelho: o JSON inteiro e as
   * fotos. Foto que o aparelho já tem (`antigo`, casada pela hora em que foi tirada) é
   * reaproveitada; só as que faltam são baixadas e guardadas no IndexedDB daqui.
   */
  async function montarDoBanco(registro, antigo = null) {
    const base = registro.json;
    const rdo = { ...base };
    rdo.dono = registro.dono || null;
    rdo.donoNome = registro.nome || '';
    rdo._docId = registro.docId;
    rdo.atualizado = Number(registro.atualizado) || Number(base.atualizado) || Date.now();
    delete rdo._fora;

    const metas = Array.isArray(base.photos) ? base.photos : [];
    const locais = new Map();
    (antigo?.photos || []).forEach((p) => {
      if (!p?.foto || !p.timestamp) return;
      if (!locais.has(p.timestamp)) locais.set(p.timestamp, []);
      locais.get(p.timestamp).push(p);
    });
    const fotos = metas.map((m) => {
      const igual = m?.timestamp ? locais.get(m.timestamp)?.shift() : null;
      if (!igual) return null;
      const meta = { ...m, foto: igual.foto };
      delete meta.data;
      return meta;
    });
    const novas = [];   // imagens gravadas agora; se o RDO não entrar, elas saem
    if (fotos.some((f) => !f)) {
      let imagens = [];
      try {
        imagens = await Nuvem.fotosDe(registro.docId);
      } catch (e) {
        // sem sinal: tenta de novo depois, para o RDO não entrar sem as fotos e ficar assim
        if (!permanente(e)) throw e;
      }
      // a lista de fotos do RDO é quem manda: imagem sobrando no banco, sem legenda, não entra
      for (let i = 0; i < metas.length; i += 1) {
        if (fotos[i]) continue;
        const meta = { ...(metas[i] || {}) };
        delete meta.foto;
        delete meta.data;
        const guardada = imagens[i] ? await Fotos.salvar(imagens[i]).catch(() => null) : null;
        if (guardada?.foto) { fotos[i] = { ...meta, foto: guardada.foto }; novas.push(fotos[i]); }
        else if (guardada?.data) fotos[i] = { ...meta, data: guardada.data };
        else fotos[i] = meta;   // a imagem não veio: fica a legenda ("foto indisponível")
      }
    }
    rdo.photos = fotos;
    return { rdo, novas };
  }

  /** Traz para o aparelho um RDO do banco que ainda não está aqui. */
  async function baixarRdo(registro) {
    const base = registro.json;
    if (!base?.id || Store.find(base.id)) return false;
    const { rdo, novas } = await montarDoBanco(registro);
    // outra aba pode ter baixado o mesmo RDO enquanto as fotos desciam
    const entrou = Store.find(rdo.id) ? 0 : Store.importar([rdo], {});
    if (entrou > 0) {
      marcarEnviado(rdo.id, rdo.atualizado);
      Nuvem.marcarFotosNoBanco?.(registro.docId, Store.find(rdo.id));
      return true;
    }
    Fotos.remover(novas);
    return false;
  }

  /**
   * Troca a versão deste aparelho pela do banco (correção do supervisor, edição feita em
   * outro celular): texto, listas e fotos. As fotos que saíram do RDO saem do aparelho.
   */
  async function trazerVersao(local, registro) {
    const { rdo, novas } = await montarDoBanco(registro, local);
    const ficam = new Set(rdo.photos.map((p) => p.foto).filter(Boolean));
    const sobras = (local.photos || []).filter((p) => p.foto && !ficam.has(p.foto));
    const ok = Store.update(local.id, (x) => {
      Object.assign(x, rdo);
      delete x._fora;
    });
    if (!ok) { Fotos.remover(novas); return false; }
    marcarEnviado(local.id, rdo.atualizado);
    Nuvem.marcarFotosNoBanco?.(registro.docId, Store.find(local.id));
    Fotos.remover(sobras);
    return true;
  }

  /** O RDO sumiu do banco (apagado em outro aparelho ou pela conta principal): fica só aqui. */
  function marcarFora(r) {
    if (!r._fora) Store.anotar(r.id, { _fora: true });
  }

  /** Uma aba de cada vez conversa com o banco (duas abas baixavam e subiam a mesma coisa). */
  function comTrava(nome, fazer, ocupado) {
    if (!navigator.locks?.request) return fazer();
    return navigator.locks.request(nome, { ifAvailable: true }, (trava) => (trava ? fazer() : ocupado));
  }

  /** O miolo da sincronização; `completo` relê a lista inteira do banco. */
  async function rodar(uid, completo) {
    const nada = { enviados: 0, recebidos: 0 };
    // a conta que o banco reconhece tem de ser a mesma da sessão guardada no aparelho
    if (Nuvem.sessaoPronta) {
      const noBanco = await Nuvem.sessaoPronta();
      if (noBanco?.uid !== uid) return { ...nada, semSessao: true };
    }

    // 1. exclusões pendentes: o que foi apagado no aparelho sai do banco (a lápide só cai
    //    depois que o banco confirma; sem rede ela espera a próxima volta)
    for (const [docId, info] of Object.entries(lerMapa(CHAVE_APAGADOS))) {
      try {
        await Nuvem.apagar(docId, fotosDaLapide(info));
        desmarcarApagado(docId);
      } catch (e) {
        // documento que não existe mais: nada a repetir
        if (permanente(e)) desmarcarApagado(docId);
        else if (deRede(e)) return { ...nada, semRede: true };
      }
    }
    const lapides = lerMapa(CHAVE_APAGADOS);

    // 2. o que o banco tem: a lista inteira, ou o que a última conferência viu
    let nuvem = null;
    const valeVista = !completo && vista && vista.uid === uid && Date.now() - vista.em < VALIDADE_VISTA;
    if (!valeVista) {
      nuvem = await Nuvem.meusRdos();
      // sem sinal de verdade a lista vem da cópia guardada: não dá para decidir nada com ela
      if (nuvem.doServidor === false) return { ...nada, semRede: true };
      vista = {
        uid,
        em: Date.now(),
        porId: new Map(nuvem.filter((n) => !lapides[n.docId]).map((n) => [n.json.id, { docId: n.docId, atualizado: n.atualizado }])),
      };
      ultimaCompleta = Date.now();
    }
    const porId = vista.porId;
    const inteiros = new Map((nuvem || []).map((n) => [n.json.id, n]));

    const enviadosAntes = mapaEnviados();
    const erros = mapaErros();
    let enviados = 0;
    let recebidos = 0;
    let semSinal = false;

    // 3. cada RDO do aparelho contra o banco: vale a edição mais recente. Aqui é mais novo,
    //    sobe; lá é mais novo, desce. `marca` é a versão que este aparelho já sabe que o banco
    //    tem. (Antes subia tudo primeiro e descia depois, com a lista lida antes: a correção
    //    do supervisor era coberta pela versão velha do aparelho, e o aparelho ficava com a
    //    correção sem que o banco a tivesse mais.)
    for (const id of Store.rdos.map((x) => x.id)) {
      // cada envio leva segundos: o RDO é relido a cada volta, para não decidir (nem enviar)
      // com uma cópia que outra aba já trocou, e some da volta se foi apagado no meio
      Store.recarregarSeMudou();
      const r = Store.find(id);
      if (!r) continue;
      const quando = Number(r.atualizado) || 0;
      const marca = Number(enviadosAntes[r.id]) || 0;
      // 4xx já visto nesta versão: não repete (uma edição nova muda o carimbo)
      if (erros[r.id]?.versao === quando) continue;
      const localMudou = quando > marca;
      try {
        if (ehDeOutro(r)) {
          // RDO de outra pessoa (conta principal): só volta para o banco se foi corrigido aqui.
          // Antes voltava a cada sincronização, cobrindo o que o dono tivesse mudado depois.
          if (!localMudou) continue;
          const n = Nuvem.umRdo ? await Nuvem.umRdo(Nuvem.idDoc(r.dono, r.id)) : null;
          if (Nuvem.umRdo && !n) {
            // o dono apagou o RDO: a correção não tem para onde ir
            marcarFora(r);
            marcarEnviado(r.id, quando);
            continue;
          }
          if (n && n.atualizado > quando) {
            // o dono mexeu depois da correção feita aqui: vale a versão dele
            if (await trazerVersao(r, n)) {
              recebidos += 1;
              toast(`RDO ${r.number}: ${r.donoNome || 'o dono'} alterou depois da sua correção. Ficou a versão mais nova; confira.`);
            }
            continue;
          }
          await publicarUm(r, n || undefined);
          marcarEnviado(r.id, quando);
          delete erros[r.id];
          enviados += 1;
          continue;
        }

        const n = porId.get(r.id);
        if (!n) {
          if (marca > 0 && !localMudou) {
            // já tinha subido e não está mais no banco: foi apagado em outro aparelho ou
            // pela conta principal. Fica só aqui, sem subir de novo (antes ele ressuscitava).
            if (nuvem) marcarFora(r);
            continue;
          }
        } else if (n.atualizado === quando) {
          // mesma versão dos dois lados (cópia restaurada, aparelho novo): só anota
          if (marca !== quando) marcarEnviado(r.id, quando);
          continue;
        } else if (n.atualizado > quando) {
          // o banco tem versão mais nova. O RDO inteiro só vem na conferência completa.
          const inteiro = inteiros.get(r.id);
          if (inteiro && await trazerVersao(r, inteiro)) {
            recebidos += 1;
            if (localMudou) toast(`RDO ${r.number}: o banco tinha uma versão mais nova (correção feita em outro aparelho). Ficou valendo ela; confira.`);
          }
          continue;
        }
        const docId = await publicarUm(r);
        marcarEnviado(r.id, quando);
        delete erros[r.id];
        porId.set(r.id, { docId: docId || Nuvem.idDoc(uid, r.id), atualizado: quando });
        if (r._fora) Store.anotar(r.id, { _fora: undefined });
        enviados += 1;
      } catch (e) {
        // falha de rede fica só na fila; 4xx fica registrado e exposto na tela
        if (permanente(e)) erros[r.id] = { versao: quando, erro: e.message, em: Date.now() };
        else if (deRede(e)) { semSinal = true; break; }
      }
    }

    // 4. o que só existe no banco desce (aparelho novo, RDO feito em outro celular)
    if (nuvem && !semSinal) {
      for (const n of nuvem) {
        if (lapides[n.docId] || Store.find(n.json.id)) continue;
        try {
          if (await baixarRdo(n)) recebidos += 1;
        } catch (e) {
          if (deRede(e)) { semSinal = true; break; }
        }
      }
    }

    // erro de RDO que não existe mais no aparelho não fica contando
    Object.keys(erros).forEach((id) => { if (!Store.find(id)) delete erros[id]; });
    gravarMapa(CHAVE_ERROS, erros);
    return { enviados, recebidos, semRede: semSinal };
  }

  /**
   * Acerta o aparelho com o banco: sobe o que mudou aqui e desce o que mudou lá
   * (correção do supervisor, RDO feito em outro celular). Sem rede, não faz nada.
   * `completo: false` (usado a cada gravação) só sobe o que mudou, sem reler a lista do banco.
   */
  async function sincronizar({ silencioso = true, completo = true } = {}) {
    const nada = { enviados: 0, recebidos: 0 };
    if (!ativo()) return nada;
    if (!Nuvem.configurado()) return { ...nada, semBanco: true };
    if (navigator.onLine === false) {
      if (!silencioso) toast('Sem internet. Os RDOs ficam guardados e sobem quando a rede voltar.');
      return { ...nada, semRede: true };
    }
    if (sincronizando) {
      pedidoNaFila = true;
      return { ...nada, ocupado: true };
    }
    sincronizando = true;
    pedidoNaFila = false;
    const uid = meuId();
    let resultado = nada;
    try {
      resultado = await comTrava(`gps-rdo-sync:${uid}`, () => rodar(uid, completo), { ...nada, ocupado: true });
      // a conta trocou no meio (saiu e entrou outra): o resultado não vale para a de agora
      if (meuId() !== uid) resultado = { ...nada, ocupado: true };
    } catch (e) {
      resultado = { ...nada, erro: e.message || 'Não foi possível falar com o banco.' };
    } finally {
      sincronizando = false;
    }

    const deuCerto = !resultado.erro && !resultado.semRede && !resultado.ocupado && !resultado.semSessao;
    if (deuCerto) {
      try { localStorage.setItem(chaveDe(CHAVE_ULTIMA), String(Date.now())); } catch { /* sem espaço */ }
    }
    atualizarStatus();
    // chegou RDO novo ou versão nova: as listas na tela ficam em dia (sem atropelar quem digita)
    if (resultado.recebidos) window.__rdo?.app?.renderSeguro?.();
    if (pedidoNaFila && pendentes().length) agendar();
    else agendarRetry();

    if (!silencioso) {
      if (resultado.erro) toast(resultado.erro);
      else if (resultado.semRede) toast('Sem sinal agora. Os RDOs ficam guardados e sobem quando a rede voltar.');
      else if (resultado.semSessao) toast('Entre de novo na conta para falar com o banco.');
      else if (!resultado.ocupado) {
        const partes = [];
        if (resultado.enviados) partes.push(`${resultado.enviados} enviado(s)`);
        if (resultado.recebidos) partes.push(`${resultado.recebidos} recebido(s)`);
        const recusados = comErro().length;
        if (recusados) partes.push(`${recusados} recusado(s) pelo banco`);
        toast(partes.length ? `Banco: ${partes.join(' · ')}.` : 'Tudo igual entre o aparelho e o banco.');
      }
    }
    return resultado;
  }

  const enviarTudo = (opcoes) => sincronizar(opcoes);

  /**
   * Agenda a troca com o banco (usada a cada gravação no aparelho). Com internet, sobe em
   * ~1 s; sem internet, espera a rede voltar (o evento `online` e o retry cuidam disso).
   */
  function agendar() {
    if (!ativo()) return;
    clearTimeout(timer);
    const espera = navigator.onLine === false ? 4000 : 1200;
    timer = setTimeout(() => { sincronizar({ silencioso: true, completo: false }).catch(() => {}); }, espera);
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
    retryTimer = setTimeout(() => { sincronizar({ silencioso: true, completo: false }).catch(() => {}); }, espera);
  }

  /** Volta ao app ou à rede: confere a lista do banco, mas não mais de uma vez por minuto. */
  function sincronizarAoVoltar() {
    const completo = Date.now() - ultimaCompleta > FOLGA_AUTOMATICA;
    if (!completo && !pendentes().length) return;
    sincronizar({ silencioso: true, completo }).catch(() => {});
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
      sincronizarAoVoltar();
      atualizarStatus();
    });
    window.addEventListener?.('offline', () => { clearTimeout(retryTimer); atualizarStatus(); });
    document.addEventListener?.('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) sincronizarAoVoltar();
    });
    window.addEventListener?.('focus', () => {
      if (navigator.onLine !== false) sincronizarAoVoltar();
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
    const nFotos = (rdo.photos || []).length;
    marcarApagado(docId, nFotos);
    vista?.porId?.delete(rdo.id);
    // sem rede a lápide espera a volta; não adianta ficar pendurado numa gravação que não sai
    if (navigator.onLine === false) return;
    try {
      await Nuvem.apagar(docId, nFotos);
      desmarcarApagado(docId);
    } catch (e) {
      // sem rede: a lápide espera; 4xx: não existe mais ou não é nosso — não insiste
      if (permanente(e)) desmarcarApagado(docId);
    }
  }

  /**
   * Abre no aparelho um RDO de outra pessoa (supervisor): baixa do banco e devolve o id
   * local para o app abrir. O campo `dono` marca de quem é, para a correção voltar certa.
   * Se o aparelho já tem uma cópia e ela não foi mexida aqui, vale a versão do banco: antes
   * abria a cópia velha, e a correção feita em cima dela apagava o que o dono mudou depois.
   */
  async function abrirDoBanco(registro) {
    const id = registro?.json?.id;
    if (!id) throw new Error('Não foi possível abrir este RDO agora.');
    // a lista da tela pode ter minutos: busca a versão de agora (sem sinal, vale a da lista)
    let atual = registro;
    if (Nuvem.umRdo && registro.docId && navigator.onLine !== false) {
      atual = (await Nuvem.umRdo(registro.docId).catch(() => null)) || registro;
    }
    const achado = Store.find(id);
    if (achado) {
      const marca = Number(mapaEnviados()[id]) || 0;
      const quando = Number(achado.atualizado) || 0;
      const mexidoAqui = quando > marca;
      if (!mexidoAqui && Number(atual.atualizado) > quando) {
        try { await trazerVersao(achado, atual); } catch { /* sem sinal: abre a cópia que está aqui */ }
      }
      return achado.id;
    }
    const desceu = await baixarRdo(atual);
    if (!desceu) throw new Error('Não foi possível abrir este RDO agora.');
    return Store.find(id)?.id || null;
  }

  // ------------------------------------------------------------ assinatura

  // Um ouvinte só para o tamanho da janela, sempre do quadro que está na tela. Antes cada
  // tela desenhada pendurava um ouvinte novo, que nunca saía.
  let aoRedimensionar = null;
  window.addEventListener?.('resize', () => aoRedimensionar?.());

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
    // quadro em branco acompanha a janela; com desenho não mexe (redimensionar apagaria o traço)
    aoRedimensionar = () => { if (vazia && canvas.isConnected) ajustar(); };

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
  // foto do rosto tirada no cadastro que ainda não virou conta. Fica aqui (e não pendurada na
  // tela, como antes): some ao criar a conta, ao trocar de aba e ao sair, para a foto de uma
  // pessoa nunca entrar no cadastro da pessoa seguinte no mesmo aparelho.
  let facialRascunho = '';

  /**
   * Mostra o aviso na caixa que já está na tela, sem redesenhar o formulário. Antes qualquer
   * erro (senha curta, e-mail já usado, sem internet) redesenhava tudo e a pessoa perdia o
   * que tinha digitado, a assinatura e a foto.
   */
  const mostrarAviso = (texto, tipo = 'erro') => {
    aviso = texto;
    avisoTipo = tipo;
    const caixa = document.querySelector?.('[data-aviso]');
    if (!caixa) return;
    caixa.textContent = texto;
    caixa.className = `aviso ${tipo === 'ok' ? 'ok' : 'erro'}`;
    caixa.hidden = !texto;
    if (texto) caixa.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  };

  const abas = () => `
    <div class="abas">
      ${[['entrar', 'Entrar'], ['criar', 'Criar conta'], ['esqueci', 'Esqueci a senha']].map(([v, t]) => `
        <button type="button" class="aba${aba === v ? ' ativa' : ''}" data-aba="${v}">${t}</button>`).join('')}
    </div>`;

  // a caixa do aviso fica sempre na tela (escondida quando vazia), para o texto poder mudar sem redesenhar
  const msgHtml = () => `<div data-aviso role="alert" class="aviso ${avisoTipo === 'ok' ? 'ok' : 'erro'}"${aviso ? '' : ' hidden'}>${esc(aviso)}</div>`;

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
          <button type="button" class="btn ghost block" data-act="facial">${icon('camera', 16)}<span>${facialRascunho ? 'Trocar a foto do rosto' : 'Tirar a foto do rosto'}</span></button>
          <img class="rosto-img" data-facial-preview${facialRascunho ? ` src="${esc(facialRascunho)}"` : ' hidden'} alt="Foto do rosto">
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
      <div class="sub">Versão ${esc(Pwa.versao?.() || '—')}<span data-versao-site></span></div>
      <div data-atualizacao hidden></div>
      ${u.facial ? `<div class="field"><label>Foto do rosto</label><img class="rosto-img" src="${esc(u.facial)}" alt="Foto do rosto"></div>` : ''}
      ${u.assinatura ? `<div class="field"><label>Sua assinatura</label><img class="assina-img" src="${esc(u.assinatura)}" alt="Assinatura"></div>` : ''}
      <button class="btn primary block" data-act="enviar">${icon('upload', 16)}Enviar meus RDOs agora</button>
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
        // Guarda o botão inteiro (ícone e texto) e devolve igual. O botão é passado já guardado
        // numa variável: depois de um await o `ev.currentTarget` não existe mais, e o botão
        // ficava em "Aguarde..." para sempre.
        const ocupado = (botao, sim) => {
          if (!botao) return;
          if (sim) {
            if (botao.dataset.rotulo == null) botao.dataset.rotulo = botao.innerHTML;
            botao.disabled = true;
            botao.textContent = 'Aguarde...';
          } else {
            botao.disabled = false;
            if (botao.dataset.rotulo != null) { botao.innerHTML = botao.dataset.rotulo; delete botao.dataset.rotulo; }
          }
        };
        // o erro aparece na caixa do aviso e o formulário fica como está
        const falhar = (e, botao) => {
          mostrarAviso(e?.message || 'Não foi possível.');
          ocupado(botao, false);
        };

        root.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => {
          aba = b.dataset.aba;
          aviso = '';
          facialRascunho = '';
          redesenhar();
        }));

        root.querySelector('[data-form="entrar"]')?.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const botao = ev.submitter || ev.target.querySelector('[type="submit"]');
          if (botao?.disabled) return;
          mostrarAviso('');
          ocupado(botao, true);
          try {
            await entrar(root.querySelector('#c-email').value.trim(), root.querySelector('#c-senha').value);
            toast('Você entrou na sua conta.');
            irParaInicio();
            sincronizar({ silencioso: true }).catch(() => {});
          } catch (e) { falhar(e, botao); }
        });

        root.querySelector('[data-form="criar"]')?.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const botao = ev.submitter || ev.target.querySelector('[type="submit"]');
          if (botao?.disabled) return;
          mostrarAviso('');
          const assina = root.__assina;
          if (!assina || assina.vazia()) { mostrarAviso('Desenhe sua assinatura no quadro antes de criar a conta.'); return; }
          if (!facialRascunho) { mostrarAviso('Tire a foto do rosto antes de criar a conta.'); return; }
          ocupado(botao, true);
          try {
            await cadastrar({
              nome: root.querySelector('#n-nome').value,
              funcao: root.querySelector('#n-funcao').value,
              email: root.querySelector('#n-email').value.trim(),
              senha: root.querySelector('#n-senha').value,
              assinatura: assina.png(),
              facial: facialRascunho,
            });
            facialRascunho = '';
            aba = 'entrar';
            toast('Conta criada. Seus RDOs já podem ir para o banco.');
            irParaInicio();
            sincronizar({ silencioso: true }).catch(() => {});
          } catch (e) { falhar(e, botao); }
        });

        root.querySelector('[data-form="esqueci"]')?.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const botao = ev.submitter || ev.target.querySelector('[type="submit"]');
          if (botao?.disabled) return;
          mostrarAviso('');
          emailEsqueci = root.querySelector('#s-email').value.trim();
          ocupado(botao, true);
          try {
            const texto = await esqueci(emailEsqueci);
            mostrarAviso(texto, 'ok');
            ocupado(botao, false);
          } catch (e) { falhar(e, botao); }
        });

        root.querySelector('[data-act="limpar-assina"]')?.addEventListener('click', () => root.__assina?.limpar());
        root.__assina = ligarAssinatura(root);

        // foto do rosto no cadastro: câmera da frente, reduzida antes de guardar
        const entradaFacial = root.querySelector('#n-facial');
        const botaoFacial = root.querySelector('[data-act="facial"]');
        botaoFacial?.addEventListener('click', () => entradaFacial?.click());
        entradaFacial?.addEventListener('change', async () => {
          const arquivo = entradaFacial.files?.[0];
          entradaFacial.value = '';
          if (!arquivo) return;
          botaoFacial.disabled = true;
          try {
            facialRascunho = await Fotos.reduzir(arquivo, { lado: 480, qualidade: 0.75 });
            const previa = root.querySelector('[data-facial-preview]');
            if (previa) { previa.src = facialRascunho; previa.hidden = false; }
            const rotulo = botaoFacial.querySelector('span');
            if (rotulo) rotulo.textContent = 'Trocar a foto do rosto';
            mostrarAviso('');
          } catch {
            mostrarAviso('Não consegui usar esta foto. Tire outra com a câmera.', 'erro');
          } finally { botaoFacial.disabled = false; }
        });

        // ---- conta aberta pelo menu
        root.querySelector('[data-act="enviar"]')?.addEventListener('click', async (ev) => {
          const botao = ev.currentTarget;
          ocupado(botao, true);
          // o aviso do resultado (enviados, recebidos, sem sinal, erro) sai da própria sincronização
          const r = await sincronizar({ silencioso: false });
          ocupado(botao, false);
          if (r.ocupado) toast('Já está sincronizando. Aguarde um instante.');
          if (r.recebidos) redesenhar();
        });

        // "Trazer os RDOs do banco" saiu da tela (pedido de 10/11/2026): o que está no banco já
        // desce sozinho ao abrir o app e ao tocar em "Enviar meus RDOs agora".

        root.querySelector('[data-act="atualizar"]')?.addEventListener('click', async (ev) => {
          const botao = ev.currentTarget;
          ocupado(botao, true);
          const achou = await Pwa.checarAtualizacao?.();
          ocupado(botao, false);
          if (achou) toast('Procurando versão nova; se houver, o app se atualiza sozinho.');
          else toast('Não consegui conferir agora. Tente com internet.');
        });

        // qual publicação do site está neste aparelho: é por aqui que se vê se a atualização chegou
        Pwa.versaoDoSite?.().then((v) => {
          const lugar = root.querySelector('[data-versao-site]');
          if (v && lugar) lugar.textContent = ` · atualização ${v}`;
        }).catch(() => {});

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
          const botao = ev.currentTarget;
          ocupado(botao, true);
          try {
            await esqueci(conta.email);
            toast('Link de senha nova enviado para o seu e-mail.');
          } catch (e) { toast(e.message); }
          finally { ocupado(botao, false); }
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
          entradaRosto.value = '';
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
          // entra na lista de folhas abertas: o voltar do aparelho fecha o quadro, em vez de
          // trocar a tela por baixo e deixar o quadro por cima
          let soltar = () => {};
          const fechar = () => { soltar(); scrim.remove(); };
          soltar = UI.registrarFolha?.(fechar) || soltar;
          scrim.addEventListener('click', async (e) => {
            // tocar fora não fecha: um escorregão do dedo não joga a assinatura fora
            const botao = e.target.closest('[data-act]');
            const act = botao?.dataset.act;
            if (act === 'cancelar') return fechar();
            if (act === 'limpar') return assina.limpar();
            if (act === 'salvar') {
              if (assina.vazia()) { toast('Desenhe a assinatura primeiro.'); return; }
              botao.disabled = true;
              try {
                const perfil = await Nuvem.salvarPerfil({ assinatura: assina.png() });
                if (sessao && perfil) { sessao.usuario = perfil; salvarSessao(); }
                toast('Assinatura atualizada.');
                fechar();
                redesenhar();
              } catch (err) {
                botao.disabled = false;
                toast(err.message);
              }
            }
          });
        });

        // sair tem página própria: mostra o que ainda não subiu e leva para o login
        root.querySelector('[data-act="sair"]')?.addEventListener('click', () => window.__rdo?.app?.go?.('sair'));
      },
    };
  }

  /**
   * Página "Sair da conta" (pedido de 10/11/2026): diz quem está logado e o que ainda não
   * subiu para o banco, e o botão leva de volta para a tela de entrar. Nada é apagado do
   * aparelho: entrando de novo com a mesma conta, os RDOs voltam.
   */
  function telaSair() {
    const u = usuario() || {};
    const fila = pendentes().length;
    const semRede = navigator.onLine === false;
    return {
      titulo: 'Sair da conta',
      html: `
        <div class="card"><div class="body">
          <div class="name">${esc(u.nome || 'Sua conta')}</div>
          <div class="sub">${esc(u.funcao ? `${u.funcao} · ` : '')}${esc(u.email || '')}${u.mestre ? ' · conta principal' : ''}</div>
        </div></div>
        ${fila ? `<div class="aviso-info">${fila} RDO(s) deste aparelho ainda não subiram para o banco${semRede ? ' e não há internet agora' : ''}.
          Eles ficam guardados aqui e sobem quando você entrar de novo com esta conta.</div>` : ''}
        <p class="dica">Ao sair, o app volta para a tela de entrar. Nada é apagado: os RDOs desta conta continuam
          no aparelho e no banco, e reaparecem quando você entrar de novo com o mesmo e-mail e a mesma senha.</p>
        <button class="btn danger block" data-act="confirmar-sair">${icon('lock', 16)}<span>Sair e ir para o login</span></button>
        <button class="btn ghost block" data-act="ficar">Continuar no app</button>`,
      bind(root) {
        root.querySelector('[data-act="ficar"]')?.addEventListener('click', () => window.__rdo?.app?.voltar?.());
        root.querySelector('[data-act="confirmar-sair"]')?.addEventListener('click', async (ev) => {
          const botao = ev.currentTarget;
          if (botao.disabled) return;
          botao.disabled = true;
          const rotulo = botao.querySelector('span');
          // com internet, tenta subir o que falta antes de sair (sem prender a pessoa: 12 s no máximo)
          if (pendentes().length && navigator.onLine !== false) {
            if (rotulo) rotulo.textContent = 'Enviando o que falta...';
            await Promise.race([
              sincronizar({ silencioso: true, completo: false }).catch(() => {}),
              new Promise((resolver) => { setTimeout(resolver, 12000); }),
            ]);
          }
          if (rotulo) rotulo.textContent = 'Saindo...';
          await sair();
          aba = 'entrar';
          aviso = '';
          facialRascunho = '';
          toast('Você saiu da conta.');
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
          // o banco diz que ninguém está logado (saiu em outra aba, conta removida): sai aqui também
          if (sessao?.usuario?.id) {
            clearTimeout(timer);
            clearTimeout(retryTimer);
            sessao = null;
            salvarSessao();
            vista = null;
            Store.usarConta('');
            window.Mestre?.limpar?.();
            redesenhar();
          }
          return;
        }
        // perfil que não deu para ler (sem sinal) não mexe no que o aparelho já sabe da conta
        const perfil = await Nuvem.perfil({ recarregar: true }).catch(() => null);
        if (perfil) {
          const trocou = sessao?.usuario?.id !== perfil.id;
          const mudou = JSON.stringify(sessao?.usuario || {}) !== JSON.stringify(perfil);
          if (trocou) {
            vista = null;
            usarPerfil(perfil);
            redesenhar();
          } else if (mudou) {
            usarPerfil(perfil);
            // mesma conta, dado novo do perfil: atualiza a tela sem atropelar quem está digitando
            (window.__rdo?.app?.renderSeguro || redesenhar)();
          }
        }
        if (sessao?.usuario?.id === user.uid) sincronizar({ silencioso: true }).catch(() => {});
      });
    } catch { /* sem banco configurado: o portão mostra o aviso */ }
  }

  return {
    iniciar, ativo, usuario, ehMestre,
    entrar, cadastrar, esqueci, sair,
    enviarTudo, sincronizar, agendar, recuperar, apagarNaNuvem,
    pendentes, comErro, statusSync, textoStatus,
    abrirDoBanco,
    tela, telaSair, ligarAssinatura,
    get sessao() { return sessao; },
  };
})();
