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
    erro.codigo = String(e?.code || '');
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

  function aoMudar(cb) {
    iniciar().then(() => auth.onAuthStateChanged(cb)).catch(() => cb(null));
  }

  const docUsuario = (uid) => db.collection('usuarios').doc(uid);
  const docRdo = (docId) => db.collection('rdos').doc(docId);
  const idDoc = (dono, rdoId) => `${dono}__${rdoId}`;

  /** Perfil da conta (nome, função, e-mail, assinatura, foto do rosto, se é a conta principal). */
  async function perfil({ recarregar = false } = {}) {
    await iniciar();
    const u = atual();
    if (!u) return null;
    if (perfilCache && !recarregar) return perfilCache;
    const d = await docUsuario(u.uid).get().catch(() => null);
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
    const cred = await auth.createUserWithEmailAndPassword(limpo, senha).catch((e) => { throw falha(e); });
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
    await docUsuario(cred.user.uid).set(perfilNovo);
    perfilCache = { id: cred.user.uid, ...perfilNovo };
    try { await cred.user.updateProfile({ displayName: perfilNovo.nome }); } catch { /* só o nome de exibição */ }
    if (limpo === MESTRE && !cred.user.emailVerified) await cred.user.sendEmailVerification();
    return perfilCache;
  }

  async function entrar(email, senha) {
    await iniciar();
    const cred = await auth
      .signInWithEmailAndPassword(String(email || '').trim().toLowerCase(), senha)
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
    await docUsuario(u.uid).set(campos, { merge: true });
    perfilCache = null;
    return perfil({ recarregar: true });
  }

  const mestre = async () => Boolean((await perfil())?.mestre);

  // ------------------------------------------------------------ RDOs

  /** JSON do RDO sem as imagens (as fotos têm lugar próprio); evita passar de 1 MB. */
  function semImagens(rdo) {
    const copia = JSON.parse(JSON.stringify(rdo));
    (copia.photos || []).forEach((p) => { delete p.data; });
    // campos só deste aparelho/uso do supervisor não sobem
    ['_docId', '_donoNome', '_baixado'].forEach((k) => delete copia[k]);
    return copia;
  }

  function registro(rdo, dono, info) {
    return {
      dono,
      email: info?.email || '',
      nome: info?.nome || '',
      assinatura: info?.assinatura || '',
      number: String(rdo.number || ''),
      date: String(rdo.date || ''),
      status: rdo.status || 'draft',
      atualizado: Number(rdo.atualizado) || Date.now(),
      json: JSON.stringify(semImagens(rdo)),
    };
  }

  /** Fotos que ainda não subiram deste RDO neste aparelho (evita reenviar 300 KB toda vez). */
  function fotosEnviadas(uid) {
    try { return JSON.parse(localStorage.getItem(`gps_rdo_fotos_nuvem_v1:${uid}`) || '{}'); } catch { return {}; }
  }
  function marcarFotosEnviadas(uid, docId, ids) {
    const mapa = fotosEnviadas(uid);
    mapa[docId] = ids;
    try { localStorage.setItem(`gps_rdo_fotos_nuvem_v1:${uid}`, JSON.stringify(mapa)); } catch { /* sem espaço: sobe de novo */ }
  }

  async function enviarFotos(docId, rdo, uid, { forcar = false } = {}) {
    const fotos = rdo.photos || [];
    const ids = fotos.map((p) => p.foto || p.id || null);
    const antes = fotosEnviadas(uid)[docId] || [];
    const iguais = ids.length === antes.length && ids.every((id, i) => id && id === antes[i]);
    if (!forcar && iguais && ids.every(Boolean)) return 0;
    const lote = db.batch();
    let n = 0;
    for (let i = 0; i < fotos.length; i += 1) {
      const imagem = await (window.Fotos?.imagem?.(fotos[i]) || Promise.resolve(fotos[i]?.data || null));
      if (!imagem) continue;
      lote.set(docRdo(docId).collection('fotos').doc(String(i)), { ordem: i, dados: imagem });
      n += 1;
    }
    // fotos apagadas no aparelho também saem do banco
    const antigas = await docRdo(docId).collection('fotos').get().catch(() => null);
    antigas?.docs?.forEach((d) => { if (Number(d.id) >= fotos.length) lote.delete(d.ref); });
    if (n || antigas?.size) await lote.commit();
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
    await docRdo(docId).set(registro(rdo, u.uid, info));
    await enviarFotos(docId, rdo, u.uid);
    return docId;
  }

  /** O supervisor grava a correção no RDO de outra pessoa; o dono é mantido. */
  async function publicarComo(dono, rdo, infoDoDono) {
    await iniciar();
    const u = atual();
    if (!u) throw new Error('Entre na sua conta.');
    if (!(await mestre())) throw new Error('Só a conta principal corrige RDO dos outros.');
    const docId = idDoc(dono, rdo.id);
    const info = infoDoDono || (await docRdo(docId).get()).data() || {};
    await docRdo(docId).set(registro(rdo, dono, { email: info.email, nome: info.nome, assinatura: info.assinatura }));
    return docId;
  }

  function listaDe(snap) {
    return snap.docs.map((d) => {
      const dados = d.data() || {};
      let json = null;
      try { json = JSON.parse(dados.json || 'null'); } catch { json = null; }
      return {
        docId: d.id,
        dono: dados.dono,
        email: dados.email,
        nome: dados.nome,
        assinatura: dados.assinatura,
        atualizado: Number(dados.atualizado) || 0,
        json,
      };
    }).filter((x) => x.json);
  }

  /** RDOs da própria conta, do banco. */
  async function meusRdos() {
    await iniciar();
    const u = atual();
    if (!u) return [];
    const snap = await db.collection('rdos').where('dono', '==', u.uid).get();
    return listaDe(snap);
  }

  /** Todos os RDOs (conta principal), opcionalmente por data de/até (AAAA-MM-DD). */
  async function todos(de, ate) {
    await iniciar();
    let consulta = db.collection('rdos');
    // duas comparações no mesmo campo não pedem índice composto
    if (de) consulta = consulta.where('date', '>=', de);
    if (ate) consulta = consulta.where('date', '<=', ate);
    const snap = await consulta.get();
    return listaDe(snap).sort((a, b) => String(a.json.number).localeCompare(String(b.json.number)));
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
    const snap = await db.collection('usuarios').get().catch((e) => { throw falha(e); });
    return snap.docs.map((d) => {
      const x = d.data() || {};
      const email = String(x.email || '').toLowerCase();
      return {
        id: d.id,
        nome: String(x.nome || '').trim() || email || 'sem nome',
        email,
        funcao: String(x.funcao || '').trim(),
        // o documento do supervisor pode ter nascido com mestre=false (e-mail ainda não confirmado)
        mestre: x.mestre === true || email === MESTRE,
        criado: Number(x.criado) || 0,
      };
    });
  }

  /** Imagens de um RDO do banco, na ordem original. */
  async function fotosDe(docId) {
    await iniciar();
    const snap = await docRdo(docId).collection('fotos').get();
    return snap.docs
      .map((d) => ({ ordem: Number(d.data().ordem) || 0, dados: d.data().dados }))
      .filter((f) => f.dados)
      .sort((a, b) => a.ordem - b.ordem)
      .map((f) => f.dados);
  }

  async function apagar(docId) {
    await iniciar();
    const fotos = await docRdo(docId).collection('fotos').get().catch(() => null);
    const lote = db.batch();
    fotos?.docs?.forEach((d) => lote.delete(d.ref));
    lote.delete(docRdo(docId));
    await lote.commit();
  }

  return {
    configurado, emulador: EMULADOR, iniciar, aoMudar, atual,
    perfil, cadastrar, entrar, sair, esqueci, trocarSenha, salvarPerfil, mestre,
    publicar, publicarComo, meusRdos, todos, usuarios, sessaoPronta, fotosDe, apagar, idDoc,
    MESTRE,
  };
})();
