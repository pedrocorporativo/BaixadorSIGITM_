(function (root) {
  "use strict";

  const KEYS = Object.freeze({ settings: "baixaSettings", current: "baixaCurrentResult", history: "baixaHistory", stop: "baixaStopRequested" });
  let historyWriteQueue = Promise.resolve();
  let codeLearningWriteQueue = Promise.resolve();

  function get(keys) {
    return new Promise((resolve, reject) => chrome.storage.local.get(keys, resultado => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(resultado);
    }));
  }

  function set(values) {
    return new Promise((resolve, reject) => chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    }));
  }

  async function obterConfiguracoes() {
    const resultado = await get(KEYS.settings);
    const stored = resultado[KEYS.settings] || {};
    const legacy = Boolean(stored.provider);
    return {
      apiKey: String((legacy ? stored.apiKeys?.groq : stored.apiKey) || ""),
      model: (legacy && stored.provider !== "groq") || !stored.model ? root.BaixaHelpers.DEFAULT_MODEL : stored.model,
      temperature: Number(stored.temperature ?? 0),
      minimumConfidence: Number(stored.minimumConfidence ?? 0.85),
      mode: stored.mode === "automatic" ? "automatic" : "analysis"
    };
  }

  function adicionarHistorico(record) {
    const task = historyWriteQueue.then(async () => {
      const stored = await get(KEYS.history);
      const history = Array.isArray(stored[KEYS.history]) ? stored[KEYS.history] : [];
      history.push({ ...record, dataHora: new Date().toISOString() });
      await set({ [KEYS.history]: history.slice(-500) });
      return history.length;
    });
    historyWriteQueue = task.catch(() => undefined);
    return task;
  }

  function limparHistorico() {
    const task = historyWriteQueue.then(() => set({ [KEYS.history]: [] }));
    historyWriteQueue = task.catch(() => undefined);
    return task;
  }

  function chaveAprendizadoCodigo(data) {
    const normalizar = value => root.BaixaHelpers.normalizarTexto(value);
    const fields = root.BaixaRules.canonizar(data || {});
    const automaticClientCode = root.BaixaRules.codigoAutomaticoParaCliente(fields.cliente);
    return JSON.stringify([
      automaticClientCode === "2A011" ? "cliente-prioritario-2A011" : "outro cliente", normalizar(fields.tipoAbertura), normalizar(fields.procedencia),
      normalizar(fields.tipoIncidencia), fields.intragov === null ? "" : String(fields.intragov), normalizar(fields.servicoAfetado)
    ]);
  }

  async function obterCodigoAprendido(data) {
    const stored = await get("baixaCodeLearning");
    const entry = stored.baixaCodeLearning?.[chaveAprendizadoCodigo(data)];
    return entry && root.BaixaRules.CODES.includes(entry.codigoBaixa) ? entry : null;
  }

  function salvarCodigoAprendido(data, code) {
    if (!root.BaixaRules.CODES.includes(code)) return Promise.reject(new Error("Código de baixa fora da lista permitida."));
    const task = codeLearningWriteQueue.then(async () => {
      const stored = await get("baixaCodeLearning");
      const learning = stored.baixaCodeLearning && typeof stored.baixaCodeLearning === "object"
        ? { ...stored.baixaCodeLearning } : {};
      const key = chaveAprendizadoCodigo(data);
      const previous = learning[key];
      learning[key] = {
        codigoBaixa: code,
        ocorrencias: Number(previous?.ocorrencias || 0) + 1,
        updatedAt: new Date().toISOString()
      };
      const entries = Object.entries(learning).sort((a, b) => String(b[1]?.updatedAt || "").localeCompare(String(a[1]?.updatedAt || "")));
      await set({ baixaCodeLearning: Object.fromEntries(entries.slice(0, 2000)) });
      return learning[key];
    });
    codeLearningWriteQueue = task.catch(() => undefined);
    return task;
  }

  function enfileirarGravacaoAprendizado(work) {
    const task = codeLearningWriteQueue.then(work);
    codeLearningWriteQueue = task.catch(() => undefined);
    return task;
  }

  async function listarCodigosAprendidos() {
    const stored = await get("baixaCodeLearning");
    const learning = stored.baixaCodeLearning && typeof stored.baixaCodeLearning === "object" ? stored.baixaCodeLearning : {};
    return Object.entries(learning)
      .filter(([, entry]) => root.BaixaRules.CODES.includes(entry?.codigoBaixa))
      .map(([key, entry]) => ({ key, codigoBaixa: entry.codigoBaixa, ocorrencias: Number(entry.ocorrencias) || 1, updatedAt: String(entry.updatedAt || "") }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  function excluirCodigoAprendido(key) {
    return enfileirarGravacaoAprendizado(async () => {
      const stored = await get("baixaCodeLearning");
      const learning = { ...(stored.baixaCodeLearning || {}) };
      const existed = Object.prototype.hasOwnProperty.call(learning, key);
      delete learning[key];
      await set({ baixaCodeLearning: learning });
      return existed;
    });
  }

  function limparCodigosAprendidos() {
    return enfileirarGravacaoAprendizado(async () => {
      await set({ baixaCodeLearning: {} });
      return true;
    });
  }

  function importarCodigosAprendidos(entries) {
    if (!Array.isArray(entries)) return Promise.reject(new Error("Backup inválido: esperado uma lista de códigos aprendidos."));
    return enfileirarGravacaoAprendizado(async () => {
      const stored = await get("baixaCodeLearning");
      const learning = { ...(stored.baixaCodeLearning || {}) };
      let imported = 0;
      let ignored = 0;
      for (const entry of entries.slice(0, 2000)) {
        const key = typeof entry?.key === "string" ? entry.key : "";
        let parsed = null;
        try { parsed = JSON.parse(key); } catch { }
        if (!key || key.length > 600 || !Array.isArray(parsed) || parsed.length !== 6 || !root.BaixaRules.CODES.includes(entry.codigoBaixa)) { ignored++; continue; }
        const updatedAt = Number.isFinite(Date.parse(entry.updatedAt)) ? new Date(entry.updatedAt).toISOString() : new Date().toISOString();
        const current = learning[key];
        if (current && String(current.updatedAt || "") >= updatedAt) { ignored++; continue; }
        learning[key] = { codigoBaixa: entry.codigoBaixa, ocorrencias: Math.max(1, Math.min(1e6, Math.floor(Number(entry.ocorrencias) || 1))), updatedAt };
        imported++;
      }
      const kept = Object.entries(learning).sort((a, b) => String(b[1]?.updatedAt || "").localeCompare(String(a[1]?.updatedAt || ""))).slice(0, 2000);
      await set({ baixaCodeLearning: Object.fromEntries(kept) });
      return { imported, ignored };
    });
  }

  const api = { KEYS, get, set, obterConfiguracoes, adicionarHistorico, limparHistorico, chaveAprendizadoCodigo, obterCodigoAprendido, salvarCodigoAprendido, listarCodigosAprendidos, excluirCodigoAprendido, limparCodigosAprendidos, importarCodigosAprendidos };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaixaStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
