/* Persistência local — chave `rdo_digital_db_v1` conforme especificação. */
window.Store = (() => {
  'use strict';

  const KEY = 'rdo_digital_db_v1';

  // Nada vem preenchido: sem pessoas, equipamentos, contrato ou empresa de exemplo.
  // Tudo o que aparece no RDO é digitado por quem preenche.
  const seed = () => ({
    config: { companyName: '', logoUrl: '', darkMode: false },
    rdos: [],
    // maior número já dado em cada dia (AAAAMMDD → NN): apagar um RDO não libera o número dele
    ultimos: {},
    employees: [],
    equipment: [],
    contracts: [],
  });

  /*
   * Versões antigas gravavam no aparelho um cadastro de exemplo (pessoas, equipamentos,
   * "Contrato Mina Norte", "Mineração Brasil S.A.") e rascunhos com turno A, Sol e
   * 07:00–17:00 já marcados. Ao abrir, isso sai. RDOs com conteúdo não são tocados.
   */
  const EXEMPLO = new Set([
    'e1:Carlos Silva', 'e2:João Santos', 'e3:Pedro Oliveira', 'e4:Lucas Lima',
    'eq1:Escavadeira Hidráulica', 'eq2:Gerador 50kVA', 'eq3:Compressor Ar',
    'c1:Contrato Mina Norte',
  ]);
  const semExemplo = (lista) => (Array.isArray(lista) ? lista : [])
    .filter((x) => !EXEMPLO.has(`${x?.id}:${x?.name}`));

  /** Rascunho nunca preenchido: limpa os valores que a versão antiga marcava sozinha. */
  function limparRascunhoAntigo(r) {
    const vazio = r && r.status === 'draft' && !r.supervisor && !r.notes && !r.location
      && ['workforce', 'equipmentList', 'tasks', 'occurrences', 'photos'].every((k) => !r[k]?.length);
    if (!vazio) return r;
    const padroes = { shift: 'A', weather: 'Sol', startTime: '07:00', endTime: '17:00', contractId: 'c1', contractName: 'Contrato Mina Norte' };
    for (const [k, v] of Object.entries(padroes)) if (r[k] === v) r[k] = '';
    return r;
  }

  let db = read();

  function read() {
    const base = seed();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return base;
      const parsed = JSON.parse(raw);
      const config = { ...base.config, ...(parsed.config || {}) };
      if (config.companyName === 'Mineração Brasil S.A.') config.companyName = '';
      return {
        ...base,
        ...parsed,
        config,
        rdos: Array.isArray(parsed.rdos) ? parsed.rdos.map(limparRascunhoAntigo) : [],
        ultimos: parsed.ultimos && typeof parsed.ultimos === 'object' ? parsed.ultimos : {},
        employees: semExemplo(parsed.employees),
        equipment: semExemplo(parsed.equipment),
        contracts: semExemplo(parsed.contracts),
      };
    } catch {
      return base;
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
      return true;
    } catch {
      return false;
    }
  }

  const uid = () => Math.random().toString(36).slice(2, 11);

  /** AAAAMMDD-NN, contador por dia. Conta também números de RDOs já apagados. */
  function nextNumber(dateIso) {
    const dia = String(dateIso || todayIso()).slice(0, 10).replace(/-/g, '');
    const usados = db.rdos
      .filter((r) => String(r.number || '').startsWith(`${dia}-`))
      .map((r) => Number(String(r.number).split('-')[1]))
      .filter((n) => Number.isInteger(n));
    const proximo = Math.max(0, ...usados, Number(db.ultimos?.[dia]) || 0) + 1;
    return `${dia}-${String(proximo).padStart(2, '0')}`;
  }

  /** Guarda o número como já dado no dia dele, para não repetir depois de apagar. */
  function marcarNumero(numero) {
    const [dia, seq] = String(numero || '').split('-');
    const n = Number(seq);
    if (!dia || !Number.isInteger(n)) return;
    db.ultimos = db.ultimos || {};
    db.ultimos[dia] = Math.max(Number(db.ultimos[dia]) || 0, n);
  }

  function todayIso() {
    const d = new Date();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
  }

  function emptyRdo() {
    const agora = new Date();
    const data = todayIso();
    return {
      id: uid(),
      number: nextNumber(data),
      date: data,
      status: 'draft',
      // só número e data saem sozinhos; o resto começa vazio e é digitado
      contractId: '',
      contractName: '',
      location: '',  // local / mina digitado à mão no cabeçalho
      shift: '',
      weather: '',
      startTime: '',
      endTime: '',
      supervisor: '',
      notes: '',
      createdAt: agora.toISOString(),
      workforce: [],
      equipmentList: [],
      tasks: [],
      occurrences: [],
      photos: [],
    };
  }

  return {
    get all() { return db; },
    get config() { return db.config; },
    get employees() { return db.employees; },
    get equipment() { return db.equipment; },
    get contracts() { return db.contracts; },
    get rdos() { return db.rdos; },

    uid,
    todayIso,
    nextNumber,
    emptyRdo,
    save,

    setDarkMode(on) {
      db.config.darkMode = Boolean(on);
      save();
    },

    /** Cria um RDO já persistido (usado só pelo botão Novo RDO). */
    createRdo() {
      const rdo = emptyRdo();
      marcarNumero(rdo.number);
      db.rdos.unshift(rdo);
      save();
      return rdo;
    },

    find(id) { return db.rdos.find((r) => r.id === id) || null; },
    get recentes() { return db.rdos.slice(0, 3); },

    /** Apaga o RDO de vez, com as fotos. Não há lixeira. */
    remove(id) {
      const rdo = db.rdos.find((r) => r.id === id);
      if (!rdo) return false;
      marcarNumero(rdo.number);
      db.rdos = db.rdos.filter((r) => r.id !== id);
      return save();
    },

    /** Tamanho aproximado dos dados salvos, em bytes (as fotos pesam quase tudo). */
    tamanho() {
      try { return (localStorage.getItem(KEY) || '').length; } catch { return 0; }
    },

    /** Salva alterações de um RDO; devolve false quando a cota estoura. */
    update(id, mutate) {
      const rdo = db.rdos.find((r) => r.id === id);
      if (!rdo) return false;
      mutate(rdo);
      return save();
    },
  };
})();
