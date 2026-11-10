/*
 * Banco na nuvem: contas (Firebase Authentication) e RDOs (Firestore).
 *
 * Cada RDO gravado no aparelho sobe para `rdos/{dono}__{id}`, com o JSON do RDO no campo
 * `json` e as fotos em `rdos/{doc}/fotos/{n}` (uma foto por documento, porque o Firestore
 * não aceita documento acima de 1 MB). A conta principal (Tiago) enxerga os RDOs de todos
 * pelo e-mail e pode corrigir; as regras do Firestore (firestore.rules) são quem garante isso.
 *
 * Sem internet nada se perde: o RDO fica no aparelho e sobe quando a rede volta. O Firestore
 * também guarda uma cópia local (cache) para leitura rápida depois da primeira carga.
 */
window.Nuvem = (() => {
  'use strict';

  const MESTRE = 't_oliveira@gpssa.com.br';
  const cfg = window.FIREBASE_CONFIG || {};
  // "?emulador" no endereço aponta para os emuladores locais (testes), nunca para produção
  const EMULADOR = Boolean(cfg.emulador) || /(^|[?&])emulador(=|&|$)/.test(location.search);

  let app = null;
  let auth = null;
  let db = null;
  let iniciando = null;
  let perfilCache = null;

  const configurado = () => Boolean(cfg.apiKey) || EMULADOR;

  /** Mensagens em português para os erros que o funcionário pode ver. */
  function traduzir(e) {
    const codigo = String(e?.code || '');
    const mapa = {
      'auth/invalid-email': 'E-mail inválido.',
      'auth/missing-password': 'Digite a senha.',
      'auth/user-not-found': 'E-mail ou senha não conferem.',
      'auth/wrong-password': 'E-mail ou senha não conferem.',
      'auth/invalid-credential': 'E-mail ou senha não conferem.',
      'auth/invalid-login-credentials': 'E-mail ou senha não conferem.',
      'auth/email-already-in-use': 'Já existe uma conta com este e-mail.',
      'auth/weak-password': 'A senha precisa de pelo menos 6 caracteres.',
      'auth/too-many-requests': 'Muitas tentativas. Espere alguns minutos e tente de novo.',
      'auth/network-request-failed': 'Sem conexão. Tente quando tiver internet.',
      'auth/requires-recent-login': 'Entre de novo para trocar a senha.',
      'auth/operation-not-allowed': 'O login por e-mail não está ligado no banco.',
      'permission-denied': 'O banco recusou a gravação (regras do banco).',
      'unavailable': 'Sem conexão com o banco. Tente quando tiver internet.',
      'failed-precondition': 'O banco ainda não está pronto. Tente de novo em instantes.',
    };
    return mapa[codigo] || e?.message || 'Não foi possível falar com o banco.';
  }

  const falha = (e) => {
    const erro = new Error(traduzir(e));
    // quem chama (js/conta.js) separa falha de rede de falha que não adianta repetir
    erro.codigo = String(e?.code || e?.codigo || '');
    return erro;
  };

  function iniciar() {
    if (iniciando) return iniciando;
    iniciando = (async () => {
      if (!configurado()) throw new Error('O banco na nuvem ainda não foi ligado neste app.');
      if (!window.firebase) throw new Error('Biblioteca do banco não carregou.');
      app = window.firebase.apps?.length ? window.firebase.app() : window.firebase.initializeApp(cfg);
      auth = window.firebase.auth();
      db = window.firebase.firestore();
      if (EMULADOR) {
        auth.useEmulator('http://localhost:9099');
        db.useEmulator('localhost', 8080);
      }
      // o aparelho guarda os RDOs que já vieram: o app abre e mostra mesmo sem sinal
      try { await db.enablePersistence({ synchronizeTabs: true }); } catch { /* duas abas abertas: segue sem cache */ }
      return { auth, db };
    })().catch((e) => { iniciando = null; throw e; });
    return iniciando;
  }

  const atual = () => auth?.currentUser || null;

  /**
   * Prazo para uma conversa com o banco. Com sinal fraco (o celular diz que tem rede, mas
   * nada passa) a gravação do Firestore fica esperando para sempre e a sincronização
   * travava junto. Estourou o prazo: conta como falha de rede e a fila tenta de novo depois.
   */
  function comPrazo(promessa, ms = 45000) {
    let relogio = null;
    const estouro = new Promise((_, rejeitar) => {
      relogio = setTimeout(() => {
        const erro = new Error('O banco demorou para responder. Tente de novo com sinal melhor.');
        erro.codigo = 'deadline-exceeded';
        rejeitar(erro);
      }, ms);
    });
    return Promise.race([promessa, estouro]).finally(() => clearTimeout(relogio));
  }

  /**
   * Avisa quando o banco diz quem está logado. Se o banco nem conseguiu abrir (biblioteca
   * que não carregou, aparelho sem armazenamento), ninguém é avisado: antes isso chegava
   * como "ninguém logado" e derrubava a sessão guardada, justo quando não dava para entrar.
   */
  function aoMudar(cb) {
    iniciar().then(() => auth.onAuthStateChanged(cb)).catch(() => {});
  }

  const docUsuario = (uid) => db.collection('usuarios').doc(uid);
  const docRdo = (docId) => db.collection('rdos').doc(docId);
  const idDoc = (dono, rdoId) => `${dono}__${rdoId}`;

  /** Perfil da conta (nome, função, e-mail, assinatura, foto do rosto, se é a conta principal). */
  async function perfil({ recarregar = false } = {}) {
    await iniciar();
    const u = atual();
    if (!u) return null;
    if (perfilCache && perfilCache.id === u.uid && !recarregar) return perfilCache;
    let d = null;
    try {
      d = await comPrazo(docUsuario(u.uid).get(), 20000);
    } catch (e) {
      // não deu para ler agora (sem sinal): vale o que já se sabia. Antes a falha virava um
      // perfil vazio, que apagava nome, função, assinatura e foto guardados no aparelho.
      if (perfilCache && perfilCache.id === u.uid) return perfilCache;
      throw falha(e);
    }
    const dados = d?.data?.() || {};
    const email = String(u.email || dados.email || '').toLowerCase();
    perfilCache = {
      id: u.uid,
      email,
      nome: dados.nome || u.displayName || email,
      funcao: dados.funcao || '',
      assinatura: dados.assinatura || '',
      facial: dados.facial || '',
      deveTrocarSenha: dados.deveTrocarSenha === true,
      // conta principal só pelo e-mail confirmado do supervisor; nada que o cadastro mande vale
      mestre: u.emailVerified === true && email === MESTRE,
    };
    return perfilCache;
  }

  async function cadastrar({ nome, email, senha, assinatura, funcao, facial }) {
    await iniciar();
    const limpo = String(email || '').trim().toLowerCase();
    // com sinal fraco o pedido fica pendurado: com prazo, o app cai no cadastro sem internet (js/conta.js)
    const cred = await comPrazo(auth.createUserWithEmailAndPassword(limpo, senha), 25000).catch((e) => { throw falha(e); });
    // os campos vêm um por um de propósito: um "mestre" mandado de fora nunca chega ao documento
    const perfilNovo = {
      nome: String(nome || '').trim(),
      funcao: String(funcao || '').trim(),
      email: limpo,
      assinatura: assinatura || '',
      facial: facial || '',
      mestre: limpo === MESTRE && cred.user.emailVerified === true,
      criado: Date.now(),
    };
    try {
      await comPrazo(docUsuario(cred.user.uid).set(perfilNovo), 30000);
    } catch (e) {
      // o perfil não gravou: desfaz o login criado, senão o e-mail ficava preso numa conta
      // sem nome, função, assinatura nem foto, e a pessoa não conseguia cadastrar de novo
      try { await cred.user.delete(); } catch { try { await auth.signOut(); } catch { /* fica para a próxima */ } }
      throw falha(e);
    }
    perfilCache = { id: cred.user.uid, ...perfilNovo };
    try { await cred.user.updateProfile({ displayName: perfilNovo.nome }); } catch { /* só o nome de exibição */ }
    if (limpo === MESTRE && !cred.user.emailVerified) await cred.user.sendEmailVerification();
    return perfilCache;
  }

  async function entrar(email, senha) {
    await iniciar();
    const cred = await comPrazo(auth.signInWithEmailAndPassword(String(email || '').trim().toLowerCase(), senha), 25000)
      .catch((e) => { throw falha(e); });
    perfilCache = null;
    return perfil({ recarregar: true }).catch(() => ({
      id: cred.user.uid,
      email: String(cred.user.email || email).toLowerCase(),
      nome: cred.user.displayName || email,
      funcao: '',
      assinatura: '',
      facial: '',
      deveTrocarSenha: false,
      mestre: cred.user.emailVerified === true && String(cred.user.email || '').toLowerCase() === MESTRE,
    }));
  }

  async function sair() {
    if (!auth) return;
    try { await auth.signOut(); } catch { /* sem rede: a sessão local já saiu */ }
    perfilCache = null;
  }

  /** Link de senha nova por e-mail (o Firebase manda; não precisa de código do supervisor). */
  async function esqueci(email) {
    await iniciar();
    await auth.sendPasswordResetEmail(String(email || '').trim().toLowerCase())
      .catch((e) => { throw falha(e); });
  }

  async function trocarSenha(atualSenha, nova) {
    await iniciar();
    const u = atual();
    if (!u?.email) throw new Error('Entre de novo para trocar a senha.');
    const credencial = window.firebase.auth.EmailAuthProvider.credential(u.email, atualSenha);
    await u.reauthenticateWithCredential(credencial).catch((e) => { throw falha(e); });
    await u.updatePassword(nova).catch((e) => { throw falha(e); });
    // senha trocada: some o aviso de senha provisória (só existe para a conta principal)
    if (perfilCache?.deveTrocarSenha) {
      await docUsuario(u.uid).set({ deveTrocarSenha: false }, { merge: true }).catch(() => {});
      perfilCache = null;
    }
  }

  async function salvarPerfil(campos) {
    await iniciar();
    const u = atual();
    if (!u) throw new Error('Entre na sua conta.');
    await comPrazo(docUsuario(u.uid).set(campos, { merge: true }), 30000).catch((e) => { throw falha(e); });
    // já gravou: se a releitura falhar por falta de sinal, vale o que acabou de ser salvo
    if (perfilCache && perfilCache.id === u.uid) perfilCache = { ...perfilCache, ...campos };
    return perfil({ recarregar: true });
  }

  const mestre = async () => Boolean((await perfil())?.mestre);

  // ------------------------------------------------------------ RDOs

  /** JSON do RDO sem as imagens (as fotos têm lugar próprio); evita passar de 1 MB. */
  function semImagens(rdo) {
    const copia = JSON.parse(JSON.stringify(rdo));
    (copia.photos || []).forEach((p) => { delete p.data; });
    // campos só deste aparelho/uso do supervisor não sobem
    ['_docId', '_donoNome', '_baixado', '_fora'].forEach((k) => delete copia[k]);
    return copia;
  }

  function registro(rdo, dono, info) {
    return {
      dono,
      email: info?.email || '',
      nome: info?.nome || '',
      number: String(rdo.number || ''),
      date: String(rdo.date || ''),
      status: rdo.status || 'draft',
      atualizado: Number(rdo.atualizado) || Date.now(),
      json: JSON.stringify(semImagens(rdo)),
    };
  }

  /*
   * Quais fotos de cada RDO já estão no banco, por posição: docId → [id da foto no aparelho].
   * Serve para subir só a foto nova, e não todas de novo a cada mudança (300 KB cada).
   */
  const chaveFotos = (uid) => `gps_rdo_fotos_nuvem_v1:${uid}`;
  function fotosEnviadas(uid) {
    try { return JSON.parse(localStorage.getItem(chaveFotos(uid)) || '{}'); } catch { return {}; }
  }
  function marcarFotosEnviadas(uid, docId, ids) {
    const mapa = fotosEnviadas(uid);
    if (ids) mapa[docId] = ids;
    else delete mapa[docId];
    try { localStorage.setItem(chaveFotos(uid), JSON.stringify(mapa)); } catch { /* sem espaço: sobe de novo */ }
  }
  // foto guardada dentro do próprio RDO (aparelho sem IndexedDB) não tem id: vale o tamanho e
  // a hora dela, para não subir de novo a cada envio
  const idsDasFotos = (rdo) => (rdo.photos || []).map((p) => p?.foto || p?.id
    || (p?.data ? `d:${String(p.data).length}:${p.timestamp || ''}` : null));

  /** Fotos recém-baixadas do banco já estão lá: não precisam subir de volta. */
  function marcarFotosNoBanco(docId, rdo) {
    const u = atual();
    if (u) marcarFotosEnviadas(u.uid, docId, idsDasFotos(rdo));
  }

  /** Faz o aparelho conferir de novo as fotos deste RDO no próximo envio. */
  function esquecerFotos(docId) {
    const u = atual();
    if (u) marcarFotosEnviadas(u.uid, docId, null);
  }

  // documento do Firestore não passa de 1 MB; a foto vai com folga abaixo disso
  const LIMITE_FOTO = 900000;

  /**
   * Sobe as fotos do RDO, uma gravação por foto e só as que mudaram de lugar ou são novas.
   * Antes iam todas num pacote só: com 20 a 30 fotos o pacote passava do limite do banco
   * (10 MB por envio) e o RDO nunca subia. Cada foto que sobe já fica anotada, então uma
   * queda de sinal no meio não faz recomeçar do zero.
   */
  async function enviarFotos(docId, rdo, uid) {
    const fotos = rdo.photos || [];
    const ids = idsDasFotos(rdo);
    const antes = fotosEnviadas(uid)[docId] || [];
    const iguais = ids.length === antes.length && ids.every((id, i) => id && id === antes[i]);
    if (iguais) return 0;
    const colecao = docRdo(docId).collection('fotos');
    const feitas = antes.slice(0, ids.length);
    let n = 0;
    for (let i = 0; i < fotos.length; i += 1) {
      if (ids[i] && ids[i] === antes[i]) continue;
      let imagem = await (window.Fotos?.imagem?.(fotos[i]) || Promise.resolve(fotos[i]?.data || null));
      // imagem que não está neste aparelho: não há o que subir; o que já está no banco fica
      if (imagem) {
        if (imagem.length > LIMITE_FOTO && window.Fotos?.encolher) {
          imagem = await window.Fotos.encolher(imagem, LIMITE_FOTO).catch(() => imagem);
        }
        await comPrazo(colecao.doc(String(i)).set({ ordem: i, dados: imagem }), 90000);
        n += 1;
      }
      feitas[i] = ids[i];
      marcarFotosEnviadas(uid, docId, feitas.slice());
    }
    // fotos apagadas no aparelho também saem do banco. O nome de cada documento é a posição
    // da foto, então dá para apagar as que sobraram sem baixar nada para conferir.
    if (antes.length > fotos.length) {
      const lote = db.batch();
      for (let i = fotos.length; i < antes.length; i += 1) lote.delete(colecao.doc(String(i)));
      await comPrazo(lote.commit(), 30000);
    }
    marcarFotosEnviadas(uid, docId, ids);
    return n;
  }

  /** Publica um RDO da conta logada (cria ou regrava o mesmo documento). */
  async function publicar(rdo) {
    await iniciar();
    const u = atual();
    if (!u) throw new Error('Entre na sua conta.');
    const info = await perfil();
    const docId = idDoc(u.uid, rdo.id);
    await comPrazo(docRdo(docId).set(registro(rdo, u.uid, info))).catch((e) => { throw falha(e); });
    await enviarFotos(docId, rdo, u.uid).catch((e) => { throw falha(e); });
    return docId;
  }

  /**
   * O supervisor grava a correção no RDO de outra pessoa; o dono é mantido. As fotos
   * acompanham: a que ele tirou do RDO sai do banco, a que ele pôs sobe.
   */
  async function publicarComo(dono, rdo, infoDoDono) {
    await iniciar();
    const u = atual();
    if (!u) throw new Error('Entre na sua conta.');
    if (!(await mestre())) throw new Error('Só a conta principal corrige RDO dos outros.');
    const docId = idDoc(dono, rdo.id);
    const info = infoDoDono || (await comPrazo(docRdo(docId).get(), 20000).catch((e) => { throw falha(e); })).data() || {};
    await comPrazo(docRdo(docId).set(registro(rdo, dono, { email: info.email, nome: info.nome })))
      .catch((e) => { throw falha(e); });
    await enviarFotos(docId, rdo, u.uid).catch((e) => { throw falha(e); });
    return docId;
  }

  function registroDe(d) {
    const dados = d.data() || {};
    let json = null;
    try { json = JSON.parse(dados.json || 'null'); } catch { json = null; }
    return {
      docId: d.id,
      dono: dados.dono,
      email: dados.email,
      nome: dados.nome,
      atualizado: Number(dados.atualizado) || 0,
      json,
    };
  }

  const listaDe = (snap) => snap.docs.map(registroDe).filter((x) => x.json && x.json.id);

  /**
   * RDOs da própria conta, do banco. `doServidor` diz se a lista veio do banco de verdade
   * ou da cópia guardada no aparelho (sem sinal): só a lista de verdade serve para concluir
   * que um RDO foi apagado em outro lugar.
   */
  async function meusRdos() {
    await iniciar();
    // numa aba recém-aberta a sessão guardada ainda está voltando: esperar por ela
    const u = atual() || (await sessaoPronta());
    if (!u) throw Object.assign(new Error('Entre na sua conta.'), { codigo: 'sem-sessao' });
    const snap = await comPrazo(db.collection('rdos').where('dono', '==', u.uid).get(), 30000)
      .catch((e) => { throw falha(e); });
    const lista = listaDe(snap);
    lista.doServidor = snap.metadata?.fromCache !== true;
    lista.uid = u.uid;
    return lista;
  }

  /** Um RDO do banco pelo documento (a conta principal lê o de qualquer pessoa). null se não existe. */
  async function umRdo(docId) {
    await iniciar();
    const d = await comPrazo(docRdo(docId).get({ source: 'server' }), 20000).catch((e) => { throw falha(e); });
    if (!d.exists) return null;
    const r = registroDe(d);
    return r.json ? r : null;
  }

  /** Todos os RDOs (conta principal), opcionalmente por data de/até (AAAA-MM-DD). */
  async function todos(de, ate) {
    await iniciar();
    let consulta = db.collection('rdos');
    // duas comparações no mesmo campo não pedem índice composto
    if (de) consulta = consulta.where('date', '>=', de);
    if (ate) consulta = consulta.where('date', '<=', ate);
    const snap = await comPrazo(consulta.get(), 45000).catch((e) => { throw falha(e); });
    const lista = listaDe(snap).sort((a, b) => String(a.json.number).localeCompare(String(b.json.number)));
    // sem sinal a lista vem da cópia guardada no aparelho: a tela avisa que pode estar velha
    lista.doServidor = snap.metadata?.fromCache !== true;
    return lista;
  }

  /** Espera o banco devolver a sessão guardada: numa aba nova a consulta sairia sem login. */
  async function sessaoPronta() {
    await iniciar();
    if (auth.currentUser) return auth.currentUser;
    return new Promise((resolver) => {
      let parar = null;
      parar = auth.onAuthStateChanged((u) => { resolver(u); setTimeout(() => parar?.(), 0); });
    });
  }

  /**
   * Contas cadastradas, para o controle de quem fez o RDO do dia. Só a conta principal
   * consegue listar (regra de /usuarios); os demais recebem "permission-denied".
   */
  async function usuarios() {
    await iniciar();
    const snap = await comPrazo(db.collection('usuarios').get(), 30000).catch((e) => { throw falha(e); });
    // quem lista é a conta principal (a regra do banco só deixa ela listar): é ela mesma que
    // fica de fora do controle. O e-mail escrito no perfil não serve para isso: cada um
    // edita o próprio perfil, e quem pusesse lá o e-mail do supervisor sumia do Controle.
    const eu = atual()?.uid;
    return snap.docs.map((d) => {
      const x = d.data() || {};
      const email = String(x.email || '').toLowerCase();
      return {
        id: d.id,
        nome: String(x.nome || '').trim() || email || 'sem nome',
        email,
        funcao: String(x.funcao || '').trim(),
        // (o campo `mestre` do perfil só a própria conta principal consegue gravar como true)
        mestre: d.id === eu || x.mestre === true,
        criado: Number(x.criado) || 0,
      };
    });
  }

  /**
   * Imagens de um RDO do banco, cada uma na posição da foto dela (posição sem imagem fica
   * vazia). Antes a lista vinha "apertada": faltando uma no meio, as seguintes iam parar na
   * foto errada, com a legenda de outra.
   */
  async function fotosDe(docId) {
    await iniciar();
    const snap = await comPrazo(docRdo(docId).collection('fotos').get(), 120000).catch((e) => { throw falha(e); });
    const lista = [];
    snap.docs.forEach((d) => {
      const x = d.data() || {};
      const ordem = Number.isInteger(Number(x.ordem)) ? Number(x.ordem) : Number(d.id);
      if (x.dados && ordem >= 0) lista[ordem] = x.dados;
    });
    return lista;
  }

  /**
   * Apaga o RDO e as fotos dele do banco. Sabendo quantas fotos eram (`nFotos`), apaga pela
   * posição, sem baixar nada; sem saber, lista as fotos primeiro (e aí baixa todas só para
   * descobrir quais existem, por isso quem chama deve informar a quantidade).
   */
  async function apagar(docId, nFotos) {
    await iniciar();
    const colecao = docRdo(docId).collection('fotos');
    const lote = db.batch();
    if (Number.isInteger(nFotos) && nFotos >= 0) {
      const u = atual();
      const anotadas = u ? (fotosEnviadas(u.uid)[docId] || []).length : 0;
      for (let i = 0; i < Math.max(nFotos, anotadas); i += 1) lote.delete(colecao.doc(String(i)));
    } else {
      const fotos = await comPrazo(colecao.get(), 120000).catch((e) => { throw falha(e); });
      fotos.docs.forEach((d) => lote.delete(d.ref));
    }
    lote.delete(docRdo(docId));
    await comPrazo(lote.commit(), 30000).catch((e) => { throw falha(e); });
    esquecerFotos(docId);
  }

  return {
    configurado, emulador: EMULADOR, iniciar, aoMudar, atual,
    perfil, cadastrar, entrar, sair, esqueci, trocarSenha, salvarPerfil, mestre,
    publicar, publicarComo, meusRdos, umRdo, todos, usuarios, sessaoPronta, fotosDe, apagar, idDoc,
    marcarFotosNoBanco, esquecerFotos,
    MESTRE,
  };
})();
