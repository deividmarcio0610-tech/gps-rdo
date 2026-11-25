/*
 * Lista de equipamentos do cliente (tarefa 5 do plano de 24/11/2026). Pedido do dono em 24/11:
 * "essa lista já vai ter os equipamentos, só selecionar eles".
 *
 * A lista fica no banco, em `config/equipamentos` (lê quem está logado, grava só a conta
 * principal; ver firestore.rules), e nunca no repositório: o site é público. O aparelho guarda
 * uma cópia, a mesma para todas as contas dele. Sem cópia, a tela de Equipamentos segue como
 * antes, tudo digitado.
 *
 * A conta principal importa a planilha (.xlsx) no próprio aparelho: o app abre o zip e lê o
 * XML sem biblioteca nova, acha os blocos com cabeçalho "LOCAL DE INSTALAÇÃO" (o "FROTA
 * COMPLETA" primeiro) e a coluna "LOCAIS DE INSTALAÇÃO CONVENCIONAIS", tira TAG repetida e
 * mostra uma prévia antes de gravar.
 *
 * No RDO, cada equipamento escolhido vira { name, code, lista, status, hoursStart, hoursEnd }:
 * `name` é modelo e frota (exemplo fictício: "Modelo A FR0001"), `code` é a TAG e `lista: true`
 * marca que veio da lista. O código antigo "Código / patrimônio" (até a v19) também fica em
 * `code`, mas sem a marca: é equipamento digitado, não TAG da lista (revisão de 25/11/2026).
 *
 * A lista guarda só grupo, modelo, frota e TAG. A série e a nota da planilha não são lidas
 * (revisão de 25/11/2026): o app não usa a série, e qualquer conta logada lê a lista.
 */
window.Equipamentos = (() => {
  'use strict';

  const CHAVE = 'gps-rdo:equipamentos';            // cópia da lista (a mesma para as contas do aparelho)
  const CHAVE_BUSCA = 'gps-rdo:equipamentos:busca'; // quando o aparelho perguntou ao banco pela última vez
  const INTERVALO = 6 * 60 * 60 * 1000;            // com lista no aparelho, pergunta no máximo a cada 6 h
  const INTERVALO_SEM_LISTA = 10 * 60 * 1000;      // sem lista, a tela de Equipamentos pergunta a cada 10 min
  const MAX_ITENS = 1000;                          // a regra do banco recusa lista maior
  const LIMITES = { grupo: 40, modelo: 40, frota: 40, tag: 60 };
  const LIMITE_ARQUIVO = 5 * 1024 * 1024;          // planilha maior que isso não é a lista de máquinas
  const LIMITE_DESCOMPRIMIDO = 20 * 1024 * 1024;   // contra zip-bomba (soma das partes lidas)
  // contra planilha montada para travar o aparelho; a lista de máquinas fica muito abaixo disso
  const LIMITE_CELULAS = 200000;                   // células com valor na primeira aba
  const LIMITE_MESCLA = 200000;                    // células preenchidas por mescla, somadas
  // texto de uma célula: a lista usa no máximo 60 letras; texto enorme citado por muitas células
  // levava minutos para ler (revisão de 25/11/2026)
  const LIMITE_TEXTO = 200;
  // acento solto em sequência longa (marcas combinantes de classes misturadas) deixa o
  // normalize('NFD') quadrático no tamanho da sequência: dentro do corte de 200 caracteres, uma
  // célula custava ~150 µs, e uma planilha de 0,49 MB travava a importação por ~65 s num PC.
  // Texto de verdade tem 1 ou 2 marcas seguidas: ficam as 3 primeiras de cada sequência.
  const MARCAS_DEMAIS = /(\p{M}{3})\p{M}+/gu;
  const semMarcasDemais = (texto) => texto.replace(MARCAS_DEMAIS, '$1');

  // ------------------------------------------------------------ zip

  const erro = (msg, codigo = 'planilha') => Object.assign(new Error(msg), { codigo });

  /** Diretório central do zip: nome -> { metodo, crc, comp, desc, local }. */
  function entradasDoZip(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    // fim do diretório central: assinatura 0x06054b50, procurada de trás para frente (comentário até 64 KB)
    let fim = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i -= 1) {
      if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; }
    }
    if (fim < 0) throw erro('O arquivo não é uma planilha .xlsx.');
    const total = dv.getUint16(fim + 10, true);
    let p = dv.getUint32(fim + 16, true);
    if (total === 0xffff || p === 0xffffffff) throw erro('Planilha grande demais.');
    const lista = new Map();
    for (let k = 0; k < total; k += 1) {
      if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) throw erro('Planilha corrompida.');
      const nLen = dv.getUint16(p + 28, true);
      const xLen = dv.getUint16(p + 30, true);
      const cLen = dv.getUint16(p + 32, true);
      const nome = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nLen));
      lista.set(nome, {
        metodo: dv.getUint16(p + 10, true),
        crc: dv.getUint32(p + 16, true),
        comp: dv.getUint32(p + 20, true),
        desc: dv.getUint32(p + 24, true),
        local: dv.getUint32(p + 42, true),
      });
      p += 46 + nLen + xLen + cLen;
    }
    return lista;
  }

  function suporta(formato) {
    try { new DecompressionStream(formato); return true; } catch { return false; }
  }

  /**
   * Descomprime aos pedaços e para quando passa de `limite` (o tamanho que o zip declarou):
   * zip-bomba que declara pouco e abre muito não chega a ocupar a memória.
   */
  async function porStream(bytes, formato, limite) {
    const leitor = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(formato)).getReader();
    const partes = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        total += value.length;
        if (total > limite) throw erro('Planilha corrompida.');
        partes.push(value);
      }
    } catch (e) {
      leitor.cancel().catch(() => {});
      // dado comprimido estragado (ou CRC errado no gzip) também é planilha corrompida
      throw e?.codigo ? e : erro('Planilha corrompida.');
    }
    const bytesLidos = new Uint8Array(total);
    let p = 0;
    for (const v of partes) { bytesLidos.set(v, p); p += v.length; }
    return bytesLidos;
  }

  /** Deflate cru dentro de um gzip montado à mão: o CRC-32 e o tamanho vêm do próprio zip. */
  function comoGzip(cru, crc, tamanho) {
    const out = new Uint8Array(10 + cru.length + 8);
    out.set([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff], 0);
    out.set(cru, 10);
    const dv = new DataView(out.buffer);
    dv.setUint32(10 + cru.length, crc >>> 0, true);
    dv.setUint32(14 + cru.length, tamanho >>> 0, true);
    return out;
  }

  /** Abre uma parte do zip como texto. `conta` soma o que já foi aberto (limite contra zip-bomba). */
  async function lerEntrada(buf, e, conta, { soGzip = false } = {}) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (e.local + 30 > buf.length || dv.getUint32(e.local, true) !== 0x04034b50) throw erro('Planilha corrompida.');
    // tamanho e CRC valem os do diretório central (o cabeçalho local pode vir zerado, bit 3)
    const ini = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
    if (ini + e.comp > buf.length) throw erro('Planilha corrompida.');
    const cru = buf.subarray(ini, ini + e.comp);
    conta.usado += e.desc;
    if (conta.usado > LIMITE_DESCOMPRIMIDO) throw erro('Planilha grande demais.');
    let bytes;
    if (e.metodo === 0) bytes = cru;
    else if (e.metodo !== 8) throw erro('Planilha com compressão que o app não abre.');
    else if (!soGzip && suporta('deflate-raw')) bytes = await porStream(cru, 'deflate-raw', e.desc);
    // aparelho sem deflate-raw (Safari antigo): o gzip confere o CRC sozinho
    else if (suporta('gzip')) bytes = await porStream(comoGzip(cru, e.crc, e.desc), 'gzip', e.desc);
    else throw erro('Este aparelho não consegue abrir planilha. Use outro telefone ou o computador.', 'sem-descompressao');
    if (bytes.length !== e.desc) throw erro('Planilha corrompida.');
    return new TextDecoder('utf-8').decode(bytes);
  }

  // ------------------------------------------------------------ XML (só o pedaço que o xlsx usa)

  const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const textoXml = (s) => s
    .replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, e) => {
      if (e[0] !== '#') return ENTIDADES[e] ?? m;
      const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

  // A leitura do XML anda só para a frente (indexOf), sem regex que volte atrás: XML torto,
  // com etiqueta que não fecha, não trava o aparelho (revisão de 25/11/2026).
  const FIM_DO_NOME = new Set(['>', '/', ' ', '\t', '\n', '\r']);

  /**
   * Cada <nome ...>...</nome> do XML, em ordem: { cabeca: '<nome ...>', corpo }. `<nome .../>`
   * vem com corpo vazio. Para no primeiro que não fecha.
   */
  function* elementos(xml, nome) {
    const abre = `<${nome}`;
    const fecha = `</${nome}>`;
    let i = 0;
    while ((i = xml.indexOf(abre, i)) >= 0) {
      // <c ...> sim; <col> ou <cfRule> não
      if (!FIM_DO_NOME.has(xml[i + abre.length])) { i += abre.length; continue; }
      const fimAbre = xml.indexOf('>', i);
      if (fimAbre < 0) return;
      const cabeca = xml.slice(i, fimAbre + 1);
      if (xml[fimAbre - 1] === '/') { yield { cabeca, corpo: '' }; i = fimAbre + 1; continue; }
      const fim = xml.indexOf(fecha, fimAbre + 1);
      if (fim < 0) return;
      yield { cabeca, corpo: xml.slice(fimAbre + 1, fim) };
      i = fim + fecha.length;
    }
  }

  /** Texto entre `a` e `b` (a primeira vez que aparece), ou undefined. */
  const entre = (s, a, b) => {
    const i = s.indexOf(a);
    if (i < 0) return undefined;
    const j = s.indexOf(b, i + a.length);
    return j < 0 ? undefined : s.slice(i + a.length, j);
  };

  /** Tira a leitura fonética (<rPh>..</rPh>), que não faz parte do texto da célula. */
  function semFonetica(xml) {
    let saida = '';
    let i = 0;
    for (;;) {
      const a = xml.indexOf('<rPh', i);
      const f = a < 0 ? -1 : xml.indexOf('</rPh>', a);
      if (f < 0) return saida + xml.slice(i);
      saida += xml.slice(i, a);
      i = f + '</rPh>'.length;
    }
  }

  // texto de uma célula com formatação (<r><t>..</t></r>), sem a leitura fonética (<rPh>)
  const textosT = (xml) => [...elementos(semFonetica(xml), 't')].map(({ corpo }) => textoXml(corpo)).join('');
  const atributo = (tag, nome) => (new RegExp(`\\b${nome}="([^"]*)"`).exec(tag) || [])[1];

  // fora da grade do Excel (1.048.576 linhas, 16.384 colunas) não é célula: linha absurda numa
  // mescla deixava o aparelho num laço sem fim (revisão de 25/11/2026)
  function linhaColuna(ref) {
    const m = /^([A-Z]{1,3})(\d{1,7})$/.exec(ref);
    if (!m) return null;
    let c = 0;
    for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
    const linha = Number(m[2]);
    if (!Number.isInteger(linha) || linha < 1 || linha > 1048576 || c < 1 || c > 16384) return null;
    return [linha, c - 1];
  }

  /**
   * Primeira aba da planilha como grade: 'linha:coluna' -> texto (só célula com valor). Célula
   * mesclada vale o valor de cima/esquerda (o modelo vem mesclado na vertical).
   */
  async function lerPlanilha(bytes, opcoes = {}) {
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (buf.length > LIMITE_ARQUIVO) throw erro('Arquivo grande demais para ser a lista de equipamentos.');
    if (typeof DecompressionStream !== 'function') {
      throw erro('Este aparelho não consegue abrir planilha. Use outro telefone ou o computador.', 'sem-descompressao');
    }
    const zip = entradasDoZip(buf);
    const conta = { usado: 0 };
    const pegar = async (nome) => (zip.has(nome) ? lerEntrada(buf, zip.get(nome), conta, opcoes) : '');
    // primeira aba: workbook.xml -> r:id -> workbook.xml.rels -> caminho da folha
    const wb = await pegar('xl/workbook.xml');
    if (!wb) throw erro('O arquivo não é uma planilha .xlsx.');
    const rels = await pegar('xl/_rels/workbook.xml.rels');
    // [^<>] e não [^>]: a busca de cada etiqueta para na próxima "<" (tempo linear)
    const primeira = /<sheet\b[^<>]*>/.exec(wb)?.[0] || '';
    const rid = atributo(primeira, 'r:id');
    const alvo = [...rels.matchAll(/<Relationship\b[^<>]*>/g)].map((m) => m[0]).find((t) => atributo(t, 'Id') === rid);
    let caminho = atributo(alvo || '', 'Target') || 'worksheets/sheet1.xml';
    caminho = caminho.startsWith('/') ? caminho.slice(1) : `xl/${caminho}`;
    const compartilhadas = [...elementos(await pegar('xl/sharedStrings.xml'), 'si')].map(({ corpo }) => semMarcasDemais(textosT(corpo).trim().slice(0, LIMITE_TEXTO)));
    const folha = await pegar(caminho);
    if (!folha) throw erro('Não achei a primeira aba da planilha.');
    const grade = new Map();
    for (const { cabeca, corpo } of elementos(folha, 'c')) {
      const pos = linhaColuna(atributo(cabeca, 'r') || '');
      if (!pos) continue;
      const t = atributo(cabeca, 't') || 'n';
      const v = entre(corpo, '<v>', '</v>');
      let val = '';
      if (t === 's' && v != null) val = compartilhadas[Number(v)] ?? '';
      else if (t === 'inlineStr') val = textosT(corpo);
      else if (v != null) val = textoXml(v);
      val = semMarcasDemais(String(val).trim().slice(0, LIMITE_TEXTO));
      if (!val) continue;
      grade.set(pos.join(':'), val);
      if (grade.size > LIMITE_CELULAS) throw erro('Planilha grande demais.');
    }
    let mescla = LIMITE_MESCLA;
    for (const m of folha.matchAll(/<mergeCell\b[^<>]*ref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
      const a = linhaColuna(m[1]);
      const b = linhaColuna(m[2]);
      if (!a || !b || b[0] < a[0] || b[1] < a[1]) continue;
      const topo = grade.get(a.join(':'));
      if (topo == null) continue;
      const area = (b[0] - a[0] + 1) * (b[1] - a[1] + 1);
      // faixa absurda (mescla da planilha inteira) não vira milhões de células
      if (area > 20000) continue;
      mescla -= area;
      if (mescla < 0) throw erro('Planilha grande demais.');
      for (let l = a[0]; l <= b[0]; l += 1) {
        for (let c = a[1]; c <= b[1]; c += 1) if (!grade.has(`${l}:${c}`)) grade.set(`${l}:${c}`, topo);
      }
    }
    return grade;
  }

  // ------------------------------------------------------------ blocos da planilha

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const pareceTag = (s) => s.length >= 8 && s.length <= 60 && (s.match(/-/g) || []).length >= 2 && /^[A-Z0-9][A-Z0-9_-]*$/.test(s);
  // cabeçalho de outro bloco empilhado na mesma coluna: ali acaba o bloco de cima
  const ehCabecalho = (s) => {
    const n = norm(s);
    return n === 'LOCAL DE INSTALACAO' || n.startsWith('LOCAIS DE INSTALACAO CONVENCIONAIS');
  };

  /**
   * Equipamentos da grade. Cada bloco começa numa célula "LOCAL DE INSTALAÇÃO": à esquerda,
   * o título ("FROTA COMPLETA" ou "FROTA <grupo>") e, nas linhas de baixo, o modelo. A série e
   * a nota, à direita, não são lidas. A coluna "LOCAIS DE INSTALAÇÃO CONVENCIONAIS" só tem TAG.
   * TAG repetida vira um item só: vale o primeiro bloco (o "FROTA COMPLETA"), e os outros só
   * completam o que faltou.
   */
  function extrair(grade) {
    const cel = (l, c) => grade.get(`${l}:${c}`) || '';
    const pos = [...grade.keys()].map((k) => k.split(':').map(Number));
    // linhas com valor de cada coluna, em ordem. Cada bloco anda só por elas (há TAG depois de
    // linha em branco) e para no cabeçalho do bloco de baixo: o trabalho é do tamanho das células
    // que existem. Antes cada bloco descia linha a linha até a última linha usada, e um valor
    // solto lá embaixo (Z1048576) recusava a planilha como grande demais (revisão de 25/11/2026).
    const linhasDe = new Map();
    for (const [l, c] of pos) {
      if (!linhasDe.has(c)) linhasDe.set(c, []);
      linhasDe.get(c).push(l);
    }
    for (const linhas of linhasDe.values()) linhas.sort((a, b) => a - b);
    /** Valores da coluna `c` abaixo da linha `l0`, de cima para baixo, até o cabeçalho de outro bloco. */
    function* abaixo(l0, c) {
      const linhas = linhasDe.get(c) || [];
      let a = 0;
      let b = linhas.length;
      while (a < b) { // primeira linha depois de l0
        const m = (a + b) >> 1;
        if (linhas[m] <= l0) a = m + 1; else b = m;
      }
      for (let i = a; i < linhas.length; i += 1) {
        const valor = cel(linhas[i], c);
        if (ehCabecalho(valor)) return;
        yield [linhas[i], valor];
      }
    }
    const blocos = [];
    const convencionais = [];
    for (const [l, c] of pos) {
      const n = norm(cel(l, c));
      if (n === 'LOCAL DE INSTALACAO') {
        const titulo = norm(cel(l, c - 1));
        blocos.push({ l, titulo, modelo: titulo.startsWith('FROTA') ? c - 1 : null, tag: c });
      } else if (n.startsWith('LOCAIS DE INSTALACAO CONVENCIONAIS')) convencionais.push([l, c]);
    }
    const completa = blocos.some((b) => b.titulo === 'FROTA COMPLETA');
    blocos.sort((a, b) => (b.titulo === 'FROTA COMPLETA') - (a.titulo === 'FROTA COMPLETA') || a.l - b.l || a.tag - b.tag);
    const itens = new Map();
    let recusadas = 0;
    let repetidas = 0;
    const por = (tag, novo) => {
      const atual = itens.get(tag);
      if (!atual) { itens.set(tag, novo); return; }
      repetidas += 1;
      for (const k of ['modelo', 'grupo']) if (!atual[k] && novo[k]) atual[k] = novo[k];
    };
    const corta = (s, k) => String(s || '').slice(0, LIMITES[k]);
    for (const b of blocos) {
      const grupo = b.titulo === 'FROTA COMPLETA' ? '' : b.titulo.replace(/^FROTA /, '');
      for (const [l, valor] of abaixo(b.l, b.tag)) {
        const tag = valor.toUpperCase();
        if (!pareceTag(tag)) { recusadas += 1; continue; }
        por(tag, {
          grupo: corta(grupo, 'grupo'),
          modelo: b.modelo != null ? corta(cel(l, b.modelo), 'modelo') : '',
          frota: corta(tag.split('-').pop(), 'frota'),
          tag,
        });
      }
    }
    for (const [l0, c] of convencionais) {
      for (const [, valor] of abaixo(l0, c)) {
        const tag = valor.toUpperCase();
        if (!pareceTag(tag)) { recusadas += 1; continue; }
        por(tag, { grupo: 'CONVENCIONAIS', modelo: '', frota: corta(tag.split('-').pop(), 'frota'), tag });
      }
    }
    const lista = normalizar({ itens: [...itens.values()] }).itens;
    return { itens: lista, blocos: blocos.length, completa, convencionais: convencionais.length, recusadas, repetidas, cortados: Math.max(0, itens.size - lista.length) };
  }

  /** Planilha inteira -> itens (o que a tela da conta principal usa). */
  async function importar(bytes, opcoes) {
    return extrair(await lerPlanilha(bytes, opcoes));
  }

  // ------------------------------------------------------------ lista

  // texto de fora (planilha, banco, aparelho): sem caractere de controle, espaço único, com limite
  const limpo = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).replace(MARCAS_DEMAIS, '$1');

  /** Lista vinda do banco ou do aparelho, saneada: itens válidos, sem TAG repetida, no máximo 1000. */
  function normalizar(dados) {
    const brutos = Array.isArray(dados?.itens) ? dados.itens : [];
    const vistos = new Set();
    const itens = [];
    for (const x of brutos) {
      if (itens.length >= MAX_ITENS) break;
      if (!x || typeof x !== 'object') continue;
      const item = {};
      for (const [k, max] of Object.entries(LIMITES)) item[k] = limpo(x[k], max);
      item.tag = item.tag.toUpperCase();
      if (!item.tag || vistos.has(item.tag)) continue;
      vistos.add(item.tag);
      if (!item.frota) item.frota = limpo(item.tag.split('-').pop(), LIMITES.frota);
      itens.push(item);
    }
    const atualizado = Number(dados?.atualizado);
    return {
      itens,
      total: itens.length,
      atualizado: Number.isFinite(atualizado) && atualizado > 0 ? Math.floor(atualizado) : 0,
      por: limpo(dados?.por, 120),
    };
  }

  /** Nome do equipamento no RDO: modelo e frota ("Modelo A FR0001"); sem modelo, a TAG. */
  const nome = (it) => (it.modelo ? [it.modelo, it.frota].filter(Boolean).join(' ') : it.tag);

  /** Equipamento da lista do jeito que o RDO guarda: com a marca `lista`, sem status e sem horímetro. */
  const paraRdo = (it) => ({ name: nome(it), code: it.tag, lista: true, status: '', hoursStart: null, hoursEnd: null });

  const chaveTag = (v) => String(v || '').trim().toUpperCase();
  const chaveNome = (v) => String(v || '').trim().toLowerCase();
  /** Equipamento do RDO que veio da lista (marca e TAG); o resto é digitado, mesmo com código antigo. */
  const daLista = (e) => Boolean(e?.lista) && Boolean(chaveTag(e?.code));

  /**
   * Já está no RDO? O da lista, pela TAG. O digitado (sem a marca, mesmo com o código antigo
   * "Código / patrimônio") conta pelo nome; dois da lista com o mesmo nome e TAG diferente são
   * dois equipamentos (revisão de 25/11/2026).
   */
  function noRdo(equipmentList) {
    const lista = Array.isArray(equipmentList) ? equipmentList : [];
    const tags = new Set(lista.filter(daLista).map((e) => chaveTag(e.code)));
    const digitados = new Set(lista.filter((e) => !daLista(e)).map((e) => chaveNome(e?.name)).filter(Boolean));
    return (it) => tags.has(chaveTag(it.tag)) || digitados.has(chaveNome(nome(it)));
  }

  const comparar = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });

  /**
   * Grupos para a folha de marcar: por modelo (sem modelo, pelo grupo da planilha). Cada linha
   * mostra frota e modelo, com a TAG em letra menor; quem já está no RDO vem marcado e travado.
   */
  function grupos(itens, equipmentList) {
    const ja = noRdo(equipmentList);
    const mapa = new Map();
    for (const it of itens || []) {
      const titulo = it.modelo || it.grupo || 'Outros';
      if (!mapa.has(titulo)) mapa.set(titulo, []);
      const esta = ja(it);
      mapa.get(titulo).push({
        value: it.tag,
        label: [it.frota, it.modelo].filter(Boolean).join(' · ') || it.tag,
        nota: esta ? `${it.tag} · já no RDO` : it.tag,
        checked: esta,
        disabled: esta,
      });
    }
    return [...mapa.entries()]
      .sort(([a], [b]) => comparar(a, b))
      .map(([titulo, lista]) => ({ titulo, itens: lista.sort((a, b) => comparar(a.label, b.label)) }));
  }

  /** Itens marcados na folha -> equipamentos novos do RDO (o que já está no RDO não entra de novo). */
  function escolhidos(tags, itens, equipmentList) {
    const porTag = new Map((itens || []).map((it) => [chaveTag(it.tag), it]));
    const ja = noRdo(equipmentList);
    const vistos = new Set();
    const novos = [];
    for (const t of tags || []) {
      const it = porTag.get(chaveTag(t));
      if (!it || vistos.has(it.tag) || ja(it)) continue;
      vistos.add(it.tag);
      novos.push(paraRdo(it));
    }
    return novos;
  }

  /** Contagem por grupo, para a prévia antes de gravar. */
  function resumo(itens) {
    const mapa = new Map();
    for (const it of itens || []) {
      const titulo = it.modelo || it.grupo || 'Outros';
      mapa.set(titulo, (mapa.get(titulo) || 0) + 1);
    }
    return [...mapa.entries()].sort(([a], [b]) => comparar(a, b)).map(([titulo, n]) => ({ titulo, n }));
  }

  // ------------------------------------------------------------ cópia no aparelho

  /** Lista guardada no aparelho ({ itens, total, atualizado, por }) ou null. */
  function lista() {
    try {
      const x = JSON.parse(localStorage.getItem(CHAVE) || 'null');
      if (!x) return null;
      const n = normalizar(x);
      return n.itens.length ? n : null;
    } catch { return null; }
  }

  function guardar(dados) {
    const n = normalizar(dados);
    try { localStorage.setItem(CHAVE, JSON.stringify(n)); return true; } catch { return false; }
  }

  const ultimaBusca = () => {
    try { return Number(localStorage.getItem(CHAVE_BUSCA)) || 0; } catch { return 0; }
  };
  const marcarBusca = () => {
    try { localStorage.setItem(CHAVE_BUSCA, String(Date.now())); } catch { /* sem espaço: pergunta de novo depois */ }
  };

  let emCurso = null;

  // logo depois de abrir o app, o Firebase ainda está trazendo a sessão guardada no aparelho
  const ESPERA_SESSAO = 5000;

  /**
   * Quem está logado. Sem ninguém ainda, espera até ESPERA_SESSAO pela sessão que o Firebase
   * traz ao abrir o app; banco que nem abriu rejeita com o motivo (2ª revisão de 25/11/2026:
   * antes os dois casos pediam para entrar de novo na conta).
   */
  function sessao(Nuvem) {
    if (Nuvem.atual?.()) return Promise.resolve(Nuvem.atual());
    if (typeof Nuvem.sessaoPronta !== 'function') return Promise.resolve(null);
    let relogio = null;
    const prazo = new Promise((resolver) => { relogio = setTimeout(() => resolver(null), ESPERA_SESSAO); });
    return Promise.race([Nuvem.sessaoPronta(), prazo]).finally(() => clearTimeout(relogio));
  }

  /**
   * Traz a lista do banco quando a versão de lá é outra que a do aparelho. Sem conta, sem
   * banco ou cedo demais desde a última pergunta, não faz nada. Nunca lança: devolve
   * { mudou, semConta?, vazio?, naFila?, erro?, codigo? }. `semConta`: sem conta para falar com
   * o banco; `vazio`: o banco ainda não tem lista (revisão de 25/11/2026: antes os dois casos, e
   * a falta de espaço no aparelho, diziam "a lista do aparelho já é a mais nova"); `naFila`: o que
   * veio é a gravação deste aparelho que ainda espera na fila do Firestore (2ª revisão).
   */
  function atualizar({ forcar = false, intervalo } = {}) {
    if (emCurso) return emCurso;
    const Nuvem = window.Nuvem;
    if (!Nuvem?.configurado?.() || typeof Nuvem.listaEquipamentos !== 'function') {
      return Promise.resolve({ mudou: false, semConta: true });
    }
    const espera = intervalo ?? (lista() ? INTERVALO : INTERVALO_SEM_LISTA);
    const agora = Date.now();
    const ultima = ultimaBusca();
    // última pergunta "no futuro" (relógio do aparelho voltou): vale como vencida
    if (!forcar && ultima <= agora && agora - ultima < espera) return Promise.resolve({ mudou: false });
    emCurso = (async () => {
      try {
        if (!(await sessao(Nuvem))) return { mudou: false, semConta: true };
        const remoto = await Nuvem.listaEquipamentos();
        // a gravação deste aparelho que ainda está na fila aparece na leitura antes de chegar ao
        // banco: não é versão nova do banco, e a cópia do aparelho só muda quando ela subir
        if (remoto?.pendente) return { mudou: false, naFila: true };
        marcarBusca();
        if (!remoto) return { mudou: false, vazio: true };
        const local = lista();
        const novo = normalizar(remoto);
        if (!novo.itens.length) return { mudou: false, vazio: true };
        // o banco manda: versão diferente troca a do aparelho, mesmo com data mais velha (a data
        // vem do relógio do aparelho de quem importou, que pode estar errado)
        if (local && local.atualizado === novo.atualizado) return { mudou: false };
        if (!guardar(novo)) return { mudou: false, erro: 'Sem espaço no aparelho para guardar a lista.', codigo: 'sem-espaco' };
        return { mudou: true };
      } catch (e) {
        if (e?.codigo === 'sem-conta') return { mudou: false, semConta: true };
        // regra ainda não publicada: não adianta perguntar de novo a cada gravação
        if (e?.codigo === 'permission-denied') marcarBusca();
        return { mudou: false, erro: e?.message || 'Não foi possível ler a lista.', codigo: e?.codigo || '' };
      } finally {
        emCurso = null;
      }
    })();
    return emCurso;
  }

  // ------------------------------------------------------------ tela da conta principal

  const quando = (ms) => {
    const d = new Date(ms);
    if (!ms || Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} às ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  let aviso = '';
  // a fila do Firestore é da conta: quem sai dela segura a gravação até entrar de novo (2ª revisão
  // de 25/11/2026)
  const AVISO_FILA = 'O banco não respondeu a tempo. A gravação ficou na fila deste aparelho e sobe sozinha quando o sinal voltar, '
    + 'desde que você não saia da conta (deixe o app aberto). Se era a planilha errada, importe a certa aqui mesmo: vale a última. '
    + 'Gravar em outro aparelho antes disso não adianta, a deste chega depois.';

  function tela(app) {
    const { esc, icon, toast, sheet } = window.UI;
    const atual = lista();
    return {
      titulo: 'Lista de Equipamentos',
      html: `
        <div class="card">
          <div class="body">
            <div class="name">${atual ? `${atual.total} equipamento(s) na lista` : 'Nenhuma lista neste aparelho'}</div>
            <div class="sub">${atual?.atualizado
              ? `Importada em ${esc(quando(atual.atualizado))}${atual.por ? ` por ${esc(atual.por)}` : ''}.`
              : 'Importe a planilha das máquinas para a equipe escolher os equipamentos no RDO.'}</div>
          </div>
        </div>
        <button class="btn primary block" data-act="importar">${icon('file', 16)}Importar planilha (.xlsx)</button>
        <input type="file" data-arquivo hidden
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
        <button class="btn ghost block" data-act="buscar">${icon('refresh', 16)}Buscar a lista no banco</button>
        ${aviso ? `<p class="dica">${esc(aviso)}</p>` : ''}
        <p class="dica">A planilha é lida aqui no aparelho. Vai para o banco só a lista (grupo, modelo, frota e TAG),
          que qualquer conta logada no app consegue ler. A série e a nota da planilha não são lidas. No RDO entram o nome e a TAG.</p>`,
      bind(root) {
        const arquivo = root.querySelector('[data-arquivo]');
        root.querySelector('[data-act="importar"]').addEventListener('click', () => arquivo.click());

        root.querySelector('[data-act="buscar"]').addEventListener('click', async () => {
          const r = await atualizar({ forcar: true });
          if (r.codigo === 'permission-denied') aviso = 'O banco recusou a leitura: a regra da lista ainda não foi publicada no console do Firebase. Avise quem cuida do app.';
          else if (r.erro) aviso = r.erro;
          else if (r.naFila) aviso = AVISO_FILA;
          else aviso = '';
          toast(r.erro ? 'Não deu para buscar a lista agora.'
            : r.semConta ? 'Entre de novo na conta para falar com o banco.'
              : r.naFila ? 'A lista ainda está na fila deste aparelho e sobe quando o sinal voltar.'
                : r.vazio ? 'O banco ainda não tem lista. Importe a planilha.'
                  : r.mudou ? 'Lista atualizada.'
                    : 'A lista do aparelho já é a mais nova.');
          app.render();
        });

        arquivo.addEventListener('change', async () => {
          const escolhido = arquivo.files?.[0];
          arquivo.value = '';
          if (!escolhido) return;
          if (escolhido.size > LIMITE_ARQUIVO) { toast('Arquivo grande demais para ser a lista de equipamentos.'); return; }
          let r;
          try {
            r = await importar(new Uint8Array(await escolhido.arrayBuffer()));
          } catch (e) {
            toast(e?.message || 'Não deu para ler a planilha.');
            return;
          }
          if (!r.itens.length) {
            toast('Não achei equipamentos na planilha (procuro o cabeçalho "LOCAL DE INSTALAÇÃO").');
            return;
          }
          const partes = resumo(r.itens).map((g) => `${g.titulo}: ${g.n}`).join(' · ');
          const extras = [
            r.completa ? '' : 'Não achei o bloco "FROTA COMPLETA": usei todos os blocos com "LOCAL DE INSTALAÇÃO".',
            r.repetidas ? `${r.repetidas} TAG(s) repetida(s) entraram uma vez só.` : '',
            r.recusadas ? `${r.recusadas} célula(s) fora do formato de TAG ficaram de fora.` : '',
            r.cortados ? `${r.cortados} equipamento(s) passaram do limite de ${MAX_ITENS} e ficaram de fora.` : '',
          ].filter(Boolean).join(' ');
          const ok = await sheet({
            title: `Gravar ${r.itens.length} equipamento(s)?`,
            text: `${partes}. ${extras} A lista nova substitui a que está no banco. Os RDOs já lançados não mudam.`,
            submit: 'Gravar no banco',
          });
          if (!ok) return;
          const gravou = (gravado) => {
            // o banco aceitou, mas a lista pode não caber neste aparelho: aí não marca a busca, para
            // a próxima tentativa não esperar 6 h (2ª revisão de 25/11/2026)
            if (!guardar(gravado)) {
              aviso = 'A lista foi gravada no banco, mas não coube neste aparelho: falta espaço. Libere espaço no aparelho e toque em Buscar a lista no banco.';
              toast('A lista foi gravada no banco, mas não coube neste aparelho.');
              return;
            }
            marcarBusca();
            aviso = '';
            toast(`Lista gravada: ${gravado.total} equipamento(s).`);
          };
          const recusou = (e) => {
            aviso = e?.codigo === 'permission-denied'
              ? 'O banco recusou a gravação: a regra da lista ainda não foi publicada no console do Firebase. Avise quem cuida do app.'
              : (e?.message || 'Não deu para gravar a lista.');
            toast('A lista não foi gravada.');
          };
          try {
            gravou(await window.Nuvem.salvarListaEquipamentos(r.itens));
          } catch (e) {
            if (e?.naFila) {
              // o banco não respondeu a tempo, mas a gravação não foi cancelada: o Firestore guarda
              // na fila do aparelho e manda quando o sinal voltar (revisão de 25/11/2026; antes a
              // tela dizia que a lista não tinha sido gravada, e ela subia depois mesmo assim)
              aviso = AVISO_FILA;
              toast('A lista ficou na fila e sobe quando o sinal voltar.');
              // quando a fila sobe, a pessoa pode estar digitando em outra tela: o redesenho seguro
              // espera o formulário fechar (2ª revisão de 25/11/2026)
              e.naFila.then(gravou, recusou).finally(() => (app.renderSeguro ? app.renderSeguro() : app.render()));
            } else recusou(e);
          }
          app.render();
        });
      },
    };
  }

  return {
    lerPlanilha, extrair, importar,
    normalizar, nome, paraRdo, grupos, escolhidos, resumo,
    lista, guardar, atualizar, tela,
    CHAVE, CHAVE_BUSCA, MAX_ITENS,
  };
})();
