/*
 * Fotos fora do localStorage. O localStorage tem uns 5 MB e uma foto de câmera de
 * celular passa disso sozinha: era por isso que a foto "não anexava". Aqui a foto é
 * reduzida (lado maior 1600 px, JPEG) e guardada no IndexedDB, que aguenta centenas.
 * O RDO guarda só a referência (`foto: id`) e os dados do carimbo.
 * Sem IndexedDB (arquivo aberto direto, navegador antigo) a foto volta para dentro do RDO.
 */
window.Fotos = (() => {
  'use strict';

  const BANCO = 'gps_rdo_fotos';
  const LOJA = 'fotos';
  // conta logada: cada uma tem o seu banco de fotos (gps_rdo_fotos:<id>), senão a foto do
  // RDO de um apareceria na lista do outro. Sem conta, fica o banco antigo.
  let conta = '';
  let conexao = null;
  const nomeBanco = () => (conta ? `${BANCO}:${conta}` : BANCO);

  function abrirBruto(nome) {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('sem IndexedDB')); return; }
      const pedido = indexedDB.open(nome, 1);
      pedido.onupgradeneeded = () => pedido.result.createObjectStore(LOJA, { keyPath: 'id' });
      pedido.onsuccess = () => resolve(pedido.result);
      pedido.onerror = () => reject(pedido.error);
    });
  }

  function abrir() {
    if (conexao) return conexao;
    conexao = abrirBruto(nomeBanco());
    conexao.catch(() => { conexao = null; });
    return conexao;
  }

  function fecharConexao() {
    const c = conexao;
    conexao = null;
    return c ? c.then((db) => db.close()).catch(() => {}) : Promise.resolve();
  }

  async function contar(nome) {
    const db = await abrirBruto(nome);
    try {
      return await new Promise((ok, falha) => {
        const pedido = db.transaction(LOJA).objectStore(LOJA).count();
        pedido.onsuccess = () => ok(pedido.result);
        pedido.onerror = () => falha(pedido.error);
      });
    } finally {
      db.close();
    }
  }

  /** Primeira vez desta conta no aparelho: as fotos que já estavam aqui passam a ser dela. */
  async function adotarAntigas() {
    // o nome fica guardado aqui: se a conta trocar no meio da cópia, o destino não muda
    const alvo = nomeBanco();
    if (!conta || (await contar(alvo)) > 0 || (await contar(BANCO)) === 0) return 0;
    const origem = await abrirBruto(BANCO);
    const destino = await abrirBruto(alvo);
    try {
      const todas = await new Promise((ok, falha) => {
        const pedido = origem.transaction(LOJA).objectStore(LOJA).getAll();
        pedido.onsuccess = () => ok(pedido.result || []);
        pedido.onerror = () => falha(pedido.error);
      });
      if (!todas.length) return 0;
      await new Promise((ok, falha) => {
        const tx = destino.transaction(LOJA, 'readwrite');
        const loja = tx.objectStore(LOJA);
        todas.forEach((f) => loja.put(f));
        tx.oncomplete = ok;
        tx.onerror = () => falha(tx.error);
        tx.onabort = () => falha(tx.error);
      });
      return todas.length;
    } finally {
      origem.close();
      destino.close();
    }
  }

  // cópia das fotos antigas em andamento: quem for ler ou gravar espera ela terminar
  let adocao = Promise.resolve();

  /**
   * Troca o banco de fotos ao entrar/sair de conta. `adotar` copia as fotos antigas na 1ª vez.
   * A troca vale na hora (sem esperar nada): antes ela só valia um instante depois, e uma
   * foto lida ou tirada nesse meio-tempo (app aberto pelo atalho "Fotos") ia parar no banco
   * de fotos errado e sumia na abertura seguinte.
   */
  function usarConta(id, { adotar = false } = {}) {
    const novo = id ? String(id) : '';
    if (novo === conta) return adocao;
    fecharConexao();
    conta = novo;
    adocao = novo && adotar
      ? adotarAntigas().then(() => {}, () => { /* sem IndexedDB: segue sem copiar */ })
      : Promise.resolve();
    return adocao;
  }

  async function operar(modo, fazer) {
    await adocao;
    const db = await abrir();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOJA, modo);
      const pedido = fazer(tx.objectStore(LOJA));
      tx.oncomplete = () => resolve(pedido?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  /**
   * Faixa escura no pé da foto com o carimbo (data, hora, GPS, RDO) escrito na própria
   * imagem: a informação vai junto mesmo quando a foto é mandada solta, fora do PDF.
   */
  function carimbar(ctx, largura, altura, linhas) {
    const texto = linhas.filter(Boolean);
    if (!texto.length) return;
    const fonte = Math.max(14, Math.round(Math.min(largura, altura * 1.4) / 42));
    const entre = Math.round(fonte * 1.3);
    const margem = Math.round(fonte * 0.6);
    const faixa = texto.length * entre + margem * 2 - (entre - fonte);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, altura - faixa, largura, faixa);
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${fonte}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
    ctx.textBaseline = 'top';
    texto.forEach((linha, i) => {
      let t = String(linha);
      // corta o que não cabe na largura, com reticências
      while (t.length > 3 && ctx.measureText(t).width > largura - margem * 2) t = `${t.slice(0, -2)}…`;
      ctx.fillText(t, margem, altura - faixa + margem + i * entre);
    });
  }

  /**
   * Lê o arquivo da câmera ou da galeria e reduz: lado maior 1600 px, JPEG 0,8 (~200–400 KB).
   * `carimbo`: linhas de texto gravadas na foto (opcional).
   */
  async function reduzir(arquivo, { lado = 1600, qualidade = 0.8, carimbo = [] } = {}) {
    const url = URL.createObjectURL(arquivo);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('imagem inválida'));
        i.src = url;
      });
      // o navegador já aplica a rotação da câmera (EXIF) ao desenhar
      const escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      carimbar(ctx, canvas.width, canvas.height, carimbo);
      return canvas.toDataURL('image/jpeg', qualidade);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Devolve a imagem (data URL) com no máximo `limite` caracteres, baixando a qualidade e o
   * tamanho aos poucos. O banco na nuvem recusa documento acima de 1 MB: uma foto cheia de
   * detalhe (brita, mato) passava disso e o RDO inteiro ficava sem subir.
   */
  async function encolher(dataUrl, limite = 900000) {
    if (!dataUrl || dataUrl.length <= limite || typeof Image === 'undefined') return dataUrl;
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('imagem inválida'));
      i.src = dataUrl;
    });
    let menor = dataUrl;
    for (const [lado, qualidade] of [[1600, 0.7], [1600, 0.6], [1280, 0.6], [1024, 0.6], [800, 0.5]]) {
      const escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      menor = canvas.toDataURL('image/jpeg', qualidade);
      if (menor.length <= limite) break;
    }
    return menor;
  }

  /** Guarda a imagem e devolve o que vai no RDO: { foto: id } ou, sem IndexedDB, { data }. */
  async function salvar(dataUrl) {
    const id = `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      await operar('readwrite', (loja) => loja.put({ id, data: dataUrl }));
      return { foto: id };
    } catch {
      return { data: dataUrl };
    }
  }

  /** Imagem (data URL) de uma foto do RDO, esteja ela no IndexedDB ou dentro do RDO. */
  async function imagem(p) {
    if (p?.data) return p.data;
    if (!p?.foto) return null;
    try {
      const registro = await operar('readonly', (loja) => loja.get(p.foto));
      return registro?.data ?? null;
    } catch {
      return null;
    }
  }

  /** Apaga do aparelho as imagens dessas fotos (ao remover a foto ou o RDO). */
  async function remover(lista) {
    const ids = (lista || []).map((p) => p?.foto).filter(Boolean);
    if (!ids.length) return;
    try {
      await operar('readwrite', (loja) => { ids.forEach((id) => loja.delete(id)); });
    } catch { /* sem IndexedDB não há o que apagar */ }
  }

  /** Fotos de versões antigas, gravadas dentro do RDO, passam para o IndexedDB. */
  async function migrar(store) {
    let mudou = false;
    for (const rdo of store.rdos) {
      for (const p of rdo.photos || []) {
        if (!p.data || p.foto) continue;
        const r = await salvar(p.data);
        if (!r.foto) return mudou;   // sem IndexedDB: tudo fica como está
        p.foto = r.foto;
        delete p.data;
        mudou = true;
      }
    }
    if (mudou) store.save();
    return mudou;
  }

  return { reduzir, encolher, salvar, imagem, remover, migrar, usarConta };
})();
