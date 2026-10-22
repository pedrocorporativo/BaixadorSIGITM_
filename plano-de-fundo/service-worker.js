
(function (root) {
  "use strict";

  const CASE_FIELDS = Object.freeze([
    "tipoAbertura", "procedencia", "tipoIncidencia", "cliente", "intragov", "servicoAfetado",
    "numeroChamado", "dataCriacao", "dataObjetivo", "dataReparo", "dataInicioSla", "paradaRelogio",
    "dataParadaRelogio", "acionamento", "codigoAcionamento"
  ]);

  function normalizarTexto(value) {
    return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function montarCargaIa(input = {}) {
    const intragovText = normalizarTexto(input.intragov);
    const intragov = typeof input.intragov === "boolean" ? input.intragov
      : ["sim", "marcado", "true", "1"].includes(intragovText) ? true
        : ["nao", "desmarcado", "false", "0"].includes(intragovText) ? false : null;
    return {
      tipoAbertura: String(input.tipoAbertura ?? "").trim(),
      procedencia: String(input.procedencia ?? "").trim(),
      tipoIncidencia: String(input.tipoIncidencia ?? "").trim(),
      cliente: String(input.cliente ?? "").trim(),
      intragov,
      servicoAfetado: String(input.servicoAfetado ?? "").trim()
    };
  }

  function assinaturaCaso(input = {}) {
    return CASE_FIELDS.map(key => `${key}:${String(input[key] ?? "").trim()}`).join("|");
  }

  function escaparCsv(value) {
    const raw = String(value ?? "");
    const text = /^[\s\u0000-\u001f]*[=+@-]/.test(raw) ? `'${raw}` : raw;
    return `"${text.replace(/"/g, '""')}"`;
  }

  const VERSION = "4.0.0";
  const STOP_MESSAGE = "Automação interrompida pelo usuário.";
  const DEFAULT_MODEL = "openinteligencia/gpt-oss-120b";

  function pausar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function aguardarPor(predicate, timeout = 12000, shouldStop = () => false, pollMs = 250) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (shouldStop()) throw new Error(STOP_MESSAGE);
      const value = predicate();
      if (value) return value;
      await pausar(pollMs);
    }
    return false;
  }

  const SUCCESS_RESULTS = Object.freeze(["TICKET LIBERADO", "GRAVAR BAIXA ACIONADO", "BAIXA REALIZADA"]);

  function resumirHistorico(history) {
    const list = Array.isArray(history) ? history : [];
    const byResult = {};
    const byCode = {};
    const byDay = {};
    let success = 0;
    for (const item of list) {
      const resultado = String(item?.resultado || "SEM RESULTADO");
      byResult[resultado] = (byResult[resultado] || 0) + 1;
      const isSuccess = SUCCESS_RESULTS.includes(resultado);
      if (isSuccess) {
        success++;
        const code = String(item?.codigoBaixa || "—");
        byCode[code] = (byCode[code] || 0) + 1;
        const day = String(item?.dataHora || "").slice(0, 10);
        if (day) byDay[day] = (byDay[day] || 0) + 1;
      }
    }
    const total = list.length;
    return { total, success, failed: total - success, successRate: total ? success / total : 0, byResult, byCode, byDay };
  }

  function filtrarHistorico(history, { text = "", resultado = "" } = {}) {
    const needle = normalizarTexto(text);
    return (Array.isArray(history) ? history : []).filter(item => {
      if (resultado && String(item?.resultado || "") !== resultado) return false;
      if (!needle) return true;
      return normalizarTexto(Object.values(item || {}).join(" ")).includes(needle);
    });
  }

  function descreverChaveAprendizado(key) {
    try {
      const [client, opening, procedure, incidence, intragov, service] = JSON.parse(key);
      return {
        cliente: client === "cliente-prioritario-2A011" ? "Cliente prioritário" : "Outro cliente",
        tipoAbertura: opening || "—", procedencia: procedure || "—", tipoIncidencia: incidence || "—",
        intragov: intragov === "true" ? "Sim" : intragov === "false" ? "Não" : "—", servicoAfetado: service || "—"
      };
    } catch { return null; }
  }

  const api = { VERSION, SUCCESS_RESULTS, resumirHistorico, filtrarHistorico, descreverChaveAprendizado, STOP_MESSAGE, DEFAULT_MODEL, CASE_FIELDS, normalizarTexto, montarCargaIa, assinaturaCaso, escaparCsv, pausar, aguardarPor };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaixaHelpers = api;
})(typeof globalThis !== "undefined" ? globalThis : this);


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


(function (root) {
  "use strict";

  const CODES = Object.freeze(["57033", "6Y200", "2A082", "2A011"]);
  const SAI = "sai servico de acesso a internet";
  const DIAGNOSIS_STANDARD = "00000017 Testado OK";
  const DIAGNOSIS_DDR = "00000032 Testado OK";

  function codigoAutomaticoParaCliente(clientName) {
    const client = root.BaixaHelpers.normalizarTexto(clientName);
    const hasEducationDepartment = client.includes("secretaria") && client.includes("educacao");
    const hasEducationDevelopmentFund = /(^| )(fundo|fundacao)( |$)/.test(client) && client.includes("desenvolvimento") && client.includes("educacao");
    const hasSeducAcronym = /(^| )seduc( |$)/.test(client);
    const hasFedAcronym = /(^| )fed( |$)/.test(client);
    if (hasEducationDepartment || hasEducationDevelopmentFund || hasSeducAcronym || hasFedAcronym) return "2A011";
    return "";
  }

  function canonizar(input = {}) {
    const norm = root.BaixaHelpers.normalizarTexto;
    const openingText = norm(input.tipoAbertura);
    const procedureText = norm(input.procedencia);
    const incidenceText = norm(input.tipoIncidencia);
    const serviceText = norm(input.servicoAfetado);
    const boolIntragov = typeof input.intragov === "boolean"
      ? input.intragov
      : ["sim", "marcado", "true", "1"].includes(norm(input.intragov))
        ? true
        : ["nao", "desmarcado", "false", "0"].includes(norm(input.intragov)) ? false : null;

    const opening = new Map([
      ["inicial", "INICIAL"],
      ["repetida", "REPETIDA"],
      ["repetido", "REPETIDA"],
      ["repetido 7 dias", "REPETIDA 7 DIAS"],
      ["repetida 7 dias", "REPETIDA 7 DIAS"],
      ["instalacao 30 dias", "REPETIDA 30 DIAS"],
      ["repetido 30 dias", "REPETIDA 30 DIAS"],
      ["repetida 30 dias", "REPETIDA 30 DIAS"]
    ]).get(openingText) || "";
    const procedure = new Map([["proativo", "PROATIVO"], ["reativo", "REATIVO"], ["preventivo", "PREVENTIVO"]]).get(procedureText) || "";
    const incidence = new Map([["dados", "DADOS"], ["convergente", "CONVERGENTE"], ["ddr", "DDR"]]).get(incidenceText) || "";
    const service = serviceText === SAI ? "SAI - Serviço de Acesso à Internet" : (String(input.servicoAfetado ?? "").trim());

    return {
      tipoAbertura: opening,
      procedencia: procedure,
      tipoIncidencia: incidence,
      cliente: String(input.cliente ?? "").trim(),
      intragov: boolIntragov,
      servicoAfetado: service
    };
  }

  function decidir(input = {}) {
    const fields = canonizar(input);
    const missing = [];
    const automaticClientCode = codigoAutomaticoParaCliente(fields.cliente);
    if (automaticClientCode) {
      return resultado(automaticClientCode, "Cliente SEDUC/FED (sem perguntar)", fields, []);
    }

    if (fields.tipoIncidencia === "DDR") {
      return resultado("57033", "Incidência DDR (independente dos demais campos)", fields, []);
    }

    if (fields.intragov === true) {
      return resultado("6Y200", "Intragov marcado (independente dos demais campos)", fields, []);
    }

    if (!fields.tipoIncidencia) missing.push("Tipo de Incidência");
    if (missing.length) return bloqueado(`Dados necessários não identificados: ${[...new Set(missing)].join(", ")}.`, fields);

    const repeated = ["REPETIDA", "REPETIDA 7 DIAS", "REPETIDA 30 DIAS"].includes(fields.tipoAbertura);
    const is2A011Combination = (fields.tipoAbertura === "INICIAL" && ["PREVENTIVO", "REATIVO", "PROATIVO"].includes(fields.procedencia)) ||
      (repeated && fields.procedencia === "REATIVO");

    if (repeated && fields.procedencia === "PROATIVO") {
      return resultado("2A082", "Repetida + Proativo (prioridade 3)", fields, []);
    }
    if (is2A011Combination) {
      return resultado("2A011", `${fields.tipoAbertura} + ${fields.procedencia}`, fields, []);
    }
    if (!fields.tipoAbertura) missing.push("Tipo de Abertura");
    if (!fields.procedencia) missing.push("Procedência");
    if (missing.length) return bloqueado(`Dados necessários não identificados: ${[...new Set(missing)].join(", ")}.`, fields);
    return bloqueado("Regra não identificada para esta combinação.", fields);
  }

  function resultado(code, reason, fields, missing) {
    return {
      allowed: true,
      codigoBaixa: code,
      diagnostico: fields.tipoIncidencia === "DDR" ? DIAGNOSIS_DDR : DIAGNOSIS_STANDARD,
      motivo: reason,
      normalizedFields: fields,
      missing,
      confidence: 1
    };
  }

  function bloqueado(reason, fields = {}) {
    return { allowed: false, codigoBaixa: "", diagnostico: "", motivo: reason, normalizedFields: fields, missing: [], confidence: 0 };
  }

  const api = { CODES, DIAGNOSIS_STANDARD, DIAGNOSIS_DDR, canonizar, codigoAutomaticoParaCliente, decidir };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaixaRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this);


(function (root) {
  "use strict";

  function compararIaComRegras(ai, deterministic, minimumConfidence = 0.85) {
    if (!deterministic?.allowed) return { allowed: false, status: "BLOQUEADO", reason: deterministic?.motivo || "Regra não identificada." };
    if (!ai || ai.available === false) {
      return {
        allowed: true,
        status: "FALLBACK DETERMINÍSTICO",
        reason: ai?.reason || "IA indisponível; decisão obtida somente pelo motor determinístico.",
        confidence: null,
        provider: "Motor determinístico"
      };
    }
    const verdict = ai.decision;
    if (!verdict || verdict.podeExecutar !== true || verdict.codigoBaixa !== deterministic.codigoBaixa || verdict.diagnostico !== deterministic.diagnostico) {
      return {
        allowed: false,
        status: "DIVERGÊNCIA IA × REGRAS",
        reason: "Divergência entre IA e regras do sistema. Baixa bloqueada para segurança.",
        confidence: verdict?.confianca ?? null,
        provider: ai.provider || "IA"
      };
    }
    const expectedFields = deterministic.normalizedFields || {};
    const aiFields = verdict.normalizedFields || {};
    const fieldMismatch = Object.keys(expectedFields).some(key => key === "intragov"
      ? aiFields[key] !== expectedFields[key]
      : root.BaixaHelpers.normalizarTexto(aiFields[key]) !== root.BaixaHelpers.normalizarTexto(expectedFields[key]));
    if (fieldMismatch) {
      return {
        allowed: false,
        status: "DIVERGÊNCIA IA × REGRAS",
        reason: "A interpretação de campos da IA diverge dos valores normalizados localmente. Baixa bloqueada para segurança.",
        confidence: verdict.confianca,
        provider: ai.provider || "IA"
      };
    }
    if (verdict.confianca < minimumConfidence) {
      return { allowed: false, status: "BLOQUEADO", reason: "Confiança da IA abaixo do limite configurado.", confidence: verdict.confianca, provider: ai.provider };
    }
    return { allowed: true, status: "VALIDADO IA × REGRAS", reason: verdict.motivo, confidence: verdict.confianca, provider: ai.provider };
  }

  const api = { compararIaComRegras };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaixaValidation = api;
})(typeof globalThis !== "undefined" ? globalThis : this);


(function (root) {
  "use strict";

  const codes = ["", "57033", "6Y200", "2A082", "2A011"];
  const diagnoses = ["", "00000017 Testado OK", "00000032 Testado OK"];
  const openings = ["", "INICIAL", "REPETIDA 7 DIAS", "REPETIDA 30 DIAS"];
  const procedures = ["", "PROATIVO", "REATIVO", "PREVENTIVO"];
  const incidences = ["", "DADOS", "CONVERGENTE", "DDR"];
  const outputSchema = Object.freeze({
    type: "OBJECT",
    additionalProperties: false,
    properties: {
      codigoBaixa: { type: "STRING", enum: codes },
      diagnostico: { type: "STRING", enum: diagnoses },
      motivo: { type: "STRING" },
      confianca: { type: "NUMBER" },
      podeExecutar: { type: "BOOLEAN" },
      normalizedFields: {
        type: "OBJECT",
        additionalProperties: false,
        properties: {
          tipoAbertura: { type: "STRING", enum: openings },
          procedencia: { type: "STRING", enum: procedures },
          tipoIncidencia: { type: "STRING", enum: incidences },
          cliente: { type: "STRING" },
          intragov: { type: "BOOLEAN" },
          servicoAfetado: { type: "STRING" }
        },
        required: ["tipoAbertura", "procedencia", "tipoIncidencia", "cliente", "intragov", "servicoAfetado"]
      }
    },
    required: ["codigoBaixa", "diagnostico", "motivo", "confianca", "podeExecutar", "normalizedFields"]
  });

  function validarDecisao(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Resposta da IA não é um objeto JSON.");
    if (!codes.includes(value.codigoBaixa) || !diagnoses.includes(value.diagnostico)) throw new Error("Código ou diagnóstico fora da lista permitida.");
    if (typeof value.motivo !== "string") throw new Error("Motivo inválido.");
    if (typeof value.confianca !== "number" || !Number.isFinite(value.confianca) || value.confianca < 0 || value.confianca > 1) throw new Error("Confiança inválida.");
    if (typeof value.podeExecutar !== "boolean") throw new Error("Campo podeExecutar inválido.");
    const fields = value.normalizedFields;
    if (!fields || !openings.includes(fields.tipoAbertura) || !procedures.includes(fields.procedencia) || !incidences.includes(fields.tipoIncidencia) ||
      typeof fields.cliente !== "string" || typeof fields.intragov !== "boolean" || typeof fields.servicoAfetado !== "string") {
      throw new Error("Campos normalizados pela IA fora do schema permitido.");
    }
    return {
      codigoBaixa: value.codigoBaixa,
      diagnostico: value.diagnostico,
      motivo: value.motivo.slice(0, 300),
      confianca: value.confianca,
      podeExecutar: value.podeExecutar,
      normalizedFields: fields
    };
  }

  const api = { outputSchema, validarDecisao };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaixaAISchema = api;
})(typeof globalThis !== "undefined" ? globalThis : this);


(function (root) {
  "use strict";

  const PROVIDER_LABEL = "Groq Cloud";
  const REQUIRED = ["tipoAbertura", "procedencia", "tipoIncidencia"];

  const CLASSIFICATION_INSTRUCTIONS = [
    "Sua única tarefa é classificar os campos do chamado e retornar o código e diagnóstico no JSON. Você não controla o navegador, não clica em abas, botões, popups ou lupa; a extensão executa a sequência de interface separadamente.",
    "Classifique os campos de chamados usando EXCLUSIVAMENTE as regras fechadas abaixo.",
    "Não invente valores, campos, códigos nem combinações; não complete dados vazios.",
    "Normalize Intragov como verdadeiro apenas quando estiver marcado/Sim; essa informação também é usada pela automação local para aplicar o preenchimento de telefones. Intragov/Serviço ausentes não impedem combinações que já determinam o código.",
    "Prioridade: cliente SEDUC ou FED => 2A011, independente dos demais campos e sem perguntar ao usuário. Considere SEDUC quando o cliente contém SECRETARIA e EDUCAÇÃO/EDUCACAO, inclusive nomes como SAO PAULO SECRETARIA DA EDUCACAO, ou a sigla SEDUC. Considere FED quando o cliente contém FUNDO ou FUNDAÇÃO/FUNDACAO, DESENVOLVIMENTO e EDUCAÇÃO/EDUCACAO, ou a sigla FED. Para os demais clientes: 1) Tipo de Incidência DDR => 57033, independente dos demais campos; 2) Intragov true => 6Y200, independente do serviço e dos demais campos; 3) REPETIDA, REPETIDA 7 DIAS ou REPETIDA 30 DIAS + PROATIVO => 2A082; 4) INICIAL + PREVENTIVO/REATIVO/PROATIVO ou REPETIDA, REPETIDA 7 DIAS ou REPETIDA 30 DIAS + REATIVO => 2A011. Durante a baixa automática, a extensão pergunta ao usuário somente quando nenhuma regra nem escolha já aprendida identificar o código; escolhas anteriores iguais são reutilizadas.",
    "Diagnóstico: use 00000032 Testado OK quando Tipo de Incidência for DDR; nos demais casos use 00000017 Testado OK. A regra do diagnóstico depende somente da incidência e vale mesmo quando o código de baixa for definido pela prioridade do cliente.",
    "Retorne somente um objeto json válido conforme o schema. A palavra json neste pedido indica o formato obrigatório da resposta. Use exatamente as chaves e os tipos definidos; não inclua markdown, cercas de código nem texto antes ou depois do objeto. Confiança deve ser entre 0 e 1. Repita campos ausentes sem inventar valores."
  ].join(" ");
  const SYSTEM_PROMPT = `${CLASSIFICATION_INSTRUCTIONS} O objeto deve conter codigoBaixa, diagnostico, motivo, confianca (0 a 1), podeExecutar e normalizedFields com os seis campos originais normalizados. Não inclua texto fora do JSON.`;

  function sinalCancelavel(signal, timeoutMs = 25000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const stop = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", stop, { once: true });
    return {
      signal: controller.signal,
      cleanup() {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", stop);
      }
    };
  }

  function erroRede(error) {
    if (error?.name === "AbortError") return error;
    return new Error(`Sem conexão com api.groq.com. Verifique a internet e se a rede/proxy/firewall da empresa libera esse endereço. (${error?.message || "falha de rede"})`);
  }

  function erroHttp(status, message, model) {
    const raw = String(message || "").replace(/\s+/g, " ").slice(0, 220);
    let hint = "";
    if (status === 401 || status === 403 || /invalid api key|api_key_invalid/i.test(raw)) hint = "Chave recusada: confira se a API Key está correta e ativa.";
    else if (status === 404) hint = `Modelo '${model}' não encontrado: troque o modelo nas configurações.`;
    else if (status === 429) hint = "Limite de uso do Groq atingido (por minuto ou por dia). Aguarde ou troque de modelo.";
    else if (status >= 500) hint = "O Groq está instável no momento; tente novamente.";
    return new Error(`Groq API (HTTP ${status}): ${hint ? `${hint} ` : ""}${raw}`.trim());
  }

  async function solicitarGroq({ apiKey, model, temperature, payload, signal }) {
    if (!apiKey) throw new Error("API Key do Groq não configurada.");
    const selectedModel = String(model || root.BaixaHelpers.DEFAULT_MODEL).trim();
    if (!/^[a-zA-Z0-9._/-]{3,100}$/.test(selectedModel)) throw new Error("Modelo Groq inválido.");
    const requestControl = sinalCancelavel(signal);
    let response;
    try {
      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: selectedModel,
          temperature: Number(temperature),
          max_completion_tokens: 2000,
          ...(/gpt-oss/i.test(selectedModel) ? { reasoning_effort: "low" } : {}),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `Classifique estes campos e responda somente com json válido: ${JSON.stringify(payload)}` }
          ]
        }),
        signal: requestControl.signal
      });
    } catch (error) {
      requestControl.cleanup();
      throw erroRede(error);
    }
    const body = await response.json().catch(() => ({})).finally(requestControl.cleanup);
    if (!response.ok) {
      if (body.error?.code === "json_validate_failed" || /failed to generate json/i.test(body.error?.message || "")) {
        throw new Error("Groq não conseguiu gerar uma resposta JSON válida neste modelo. Nenhuma decisão da IA foi aceita; tente novamente ou use o motor determinístico.");
      }
      throw erroHttp(response.status, body.error?.message, selectedModel);
    }
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error(`Groq retornou resposta vazia (finish_reason: ${body.choices?.[0]?.finish_reason || "desconhecido"}).`);
    try { return JSON.parse(text); }
    catch { throw new Error("Groq retornou JSON inválido."); }
  }

  async function analisarCaso(input, settings, signal) {
    const payload = root.BaixaHelpers.montarCargaIa(input);
    const missing = REQUIRED.filter(key => !String(payload[key] || "").trim());
    if (missing.length) return { available: false, reason: `Campos ausentes; IA não consultada: ${missing.join(", ")}.`, payload };
    if (payload.intragov === null || !payload.servicoAfetado) {
      return { available: false, reason: "Intragov ou Serviço Afetado não identificado; usando as regras determinísticas locais.", payload };
    }
    if (!settings?.apiKey) return { available: false, reason: "IA não configurada; usando somente as regras determinísticas.", payload };

    try {
      const raw = await solicitarGroq({
        apiKey: settings.apiKey,
        model: settings.model,
        temperature: Number(settings.temperature ?? 0),
        payload,
        signal
      });
      return { available: true, provider: PROVIDER_LABEL, decision: root.BaixaAISchema.validarDecisao(raw), payload };
    } catch (error) {
      return {
        available: false,
        reason: `IA indisponível: ${error.message} A decisão será avaliada pelo motor determinístico local.`,
        payload
      };
    }
  }

  const api = { solicitarGroq, analisarCaso, PROVIDER_LABEL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaixaAI = api;
})(typeof globalThis !== "undefined" ? globalThis : this);


(function (root) {
  "use strict";

  function autorizarExecucao({ tabId, runId, persistentRun, memoryRun, stopRequested = false, hasOtherActiveRun = false }) {
    if (!runId) return { allowed: false, reason: "ID da execução ausente." };

    const memoryMatches = memoryRun?.runId === runId;
    const storageMatches = persistentRun?.tabId === tabId && persistentRun?.runId === runId;

    if (memoryMatches && memoryRun.controller?.signal?.aborted) {
      return { allowed: false, reason: "A automação foi interrompida." };
    }
    if (storageMatches && persistentRun.stopped) {
      return { allowed: false, reason: "A automação foi interrompida." };
    }
    if (storageMatches) return { allowed: true, repairStorage: false, source: "storage" };

    if (memoryMatches && !memoryRun.controller?.signal?.aborted) {
      if (stopRequested) return { allowed: false, reason: "A automação foi interrompida." };
      return { allowed: true, repairStorage: true, source: "memory" };
    }

    if (persistentRun?.tabId === tabId && persistentRun.runId !== runId && !persistentRun.stopped) {
      return { allowed: false, reason: "Esta solicitação foi substituída por uma execução mais recente." };
    }

    if (!persistentRun && !memoryRun && !stopRequested) {
      return { allowed: true, repairStorage: true, source: "recovered-request" };
    }

    return { allowed: false, reason: "A execução não está ativa ou foi interrompida." };
  }

  const api = { autorizarExecucao };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaixaRunGuard = api;
})(typeof globalThis !== "undefined" ? globalThis : this);


"use strict";

const SIGITM_HOSTS = new Set(["sigitm.redecorp.br", "10.240.59.14"]);
const ACTIVE_RUNS_KEY = "baixaActiveRuns";
const CONTENT_PROTOCOL = "baixa-controller-v26";
const CONTENT_MESSAGES = Object.freeze({ status: "GET_BAIXADOR_CONTENT_STATUS_V26", start: "START_ANALYSIS_V9" });
const CONTENT_FILES = [
  "utilitarios/helpers.js",
  "regras/baixa-rules.js",
  "regras/validation.js",
  "automacao/navigation.js",
  "automacao/date-handler.js",
  "automacao/form-handler.js",
  "automacao/baixa-handler.js",
  "interface/notifications.js",
  "conteudo/content.js"
];
const AI_PREFETCH_TTL_MS = 60000;

const activeRuns = new Map();
const aiPrefetch = new Map();
let serial = Promise.resolve();
let activeRunStorageQueue = Promise.resolve();
let activeRunsLoaded = false;

function executarSerial(work) {
  const task = serial.then(work);
  serial = task.catch(() => undefined);
  return task;
}

function eHospedeiroSigitm(hostname) { return SIGITM_HOSTS.has(String(hostname || "").toLowerCase()); }

function urlChamado(value) {
  try {
    const url = new URL(value || "");
    const valid = /^https?:$/.test(url.protocol) && eHospedeiroSigitm(url.hostname) && url.pathname.startsWith("/SIGITMWeb/");
    return valid && !url.pathname.toLowerCase().endsWith("/listconsulta.jsf") ? url : null;
  } catch { return null; }
}

function senderIsExtension(sender) {
  return sender.id === chrome.runtime.id && String(sender.url || "").startsWith(chrome.runtime.getURL(""));
}
function senderIsSigitm(sender) {
  try {
    const url = new URL(sender.url || "");
    return /^https?:$/.test(url.protocol) && eHospedeiroSigitm(url.hostname) && url.pathname.startsWith("/SIGITMWeb/") && typeof sender.tab?.id === "number";
  } catch { return false; }
}

function consultarAbas() {
  return new Promise((resolve, reject) => chrome.tabs.query({}, tabs => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else resolve(tabs || []);
  }));
}

function enviarMensagemAba(tabId, message) {
  return new Promise((resolve, reject) => chrome.tabs.sendMessage(tabId, message, response => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else resolve(response);
  }));
}

function persistirExecucoesAtivas() {
  const snapshot = [...activeRuns.entries()].map(([tabId, run]) => ({
    tabId, runId: run.runId, title: run.title, startedAt: run.startedAt, stopped: run.controller.signal.aborted
  }));
  const task = activeRunStorageQueue.then(() => BaixaStorage.set({ [ACTIVE_RUNS_KEY]: snapshot }));
  activeRunStorageQueue = task.catch(() => undefined);
  return task;
}

async function restaurarExecucoesAtivas() {
  if (activeRunsLoaded) return;
  activeRunsLoaded = true;
  const [stored, tabs] = await Promise.all([BaixaStorage.get(ACTIVE_RUNS_KEY), consultarAbas().catch(() => [])]);
  const openTabIds = new Set(tabs.map(tab => tab.id));
  for (const run of Array.isArray(stored[ACTIVE_RUNS_KEY]) ? stored[ACTIVE_RUNS_KEY] : []) {
    if (run?.stopped || !run.runId || !openTabIds.has(run.tabId) || activeRuns.has(run.tabId)) continue;
    activeRuns.set(run.tabId, {
      runId: run.runId, title: run.title || `Chamado ${run.tabId}`, startedAt: run.startedAt || "", controller: new AbortController()
    });
  }
  await persistirExecucoesAtivas();
}

async function execucaoArmazenadaDaAba(tabId) {
  await restaurarExecucoesAtivas();
  const run = activeRuns.get(tabId);
  return run ? { tabId, runId: run.runId, startedAt: run.startedAt, stopped: run.controller.signal.aborted } : null;
}

async function removerExecucao(tabId, runId = "") {
  await restaurarExecucoesAtivas();
  const run = activeRuns.get(tabId);
  if (run && (!runId || run.runId === runId)) {
    run.controller.abort();
    activeRuns.delete(tabId);
  }
  descartarPreConsultaIa(tabId, runId);
  await persistirExecucoesAtivas();
}

function definirStatusAoVivo(message, status = "info", extra = {}) {
  return BaixaStorage.set({
    baixaLiveStatus: {
      message: String(message || ""),
      status: status === "error" ? "error" : status === "success" ? "success" : "info",
      updatedAt: new Date().toISOString(),
      ...extra
    }
  }).catch(() => undefined);
}

function criarIconeBarra(size) {
  if (typeof OffscreenCanvas === "undefined") return null;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");
  if (!context) return null;
  const center = size / 2;
  context.fillStyle = "#d8f522";
  context.beginPath();
  context.arc(center, center, size * 0.48, 0, Math.PI * 2);
  context.fill();
  const globe = context.createRadialGradient(center - size * 0.15, center - size * 0.18, size * 0.03, center, center, size * 0.34);
  globe.addColorStop(0, "#4264e8");
  globe.addColorStop(1, "#07105b");
  context.fillStyle = globe;
  context.beginPath();
  context.arc(center, center, size * 0.34, 0, Math.PI * 2);
  context.fill();
  context.save();
  context.beginPath();
  context.arc(center, center, size * 0.32, 0, Math.PI * 2);
  context.clip();
  context.strokeStyle = "#dfe6ff";
  context.globalAlpha = 0.45;
  context.lineWidth = Math.max(1, size * 0.025);
  context.beginPath();
  context.ellipse(center, center, size * 0.19, size * 0.32, 0, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.ellipse(center, center, size * 0.32, size * 0.12, 0, 0, Math.PI * 2);
  context.stroke();
  context.restaurar();
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const [color, width] of [["#11143a", 0.16], ["#e3262e", 0.09]]) {
    context.strokeStyle = color;
    context.lineWidth = size * width;
    context.beginPath();
    context.moveTo(size * 0.27, size * 0.27);
    context.lineTo(size * 0.73, size * 0.73);
    context.moveTo(size * 0.73, size * 0.27);
    context.lineTo(size * 0.27, size * 0.73);
    context.stroke();
  }
  return context.getImageData(0, 0, size, size);
}

function definirIconeBarra() {
  if (!chrome.action?.setIcon) return;
  const imageData = Object.fromEntries([16, 32, 48, 128].map(size => [size, criarIconeBarra(size)]).filter(([, image]) => image));
  if (Object.keys(imageData).length) chrome.action.setIcon({ imageData }, () => void chrome.runtime.lastError);
}

definirIconeBarra();

async function injetarConteudo(tabId) {
  try { await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES }); }
  catch (error) { throw new Error(`falha ao carregar os scripts da extensão: ${error.message || "erro desconhecido do Chrome"}`); }
}

async function possuiConteudoAtual(tabId) {
  try {
    const response = await enviarMensagemAba(tabId, { type: CONTENT_MESSAGES.status });
    return response?.ok === true && response.protocol === CONTENT_PROTOCOL;
  } catch { return false; }
}

async function iniciarConteudo(tabId, runId, mode) {
  if (!await possuiConteudoAtual(tabId)) {
    try { await injetarConteudo(tabId); }
    catch (error) {
      throw new Error(`Não foi possível carregar os scripts da extensão nesta guia (${error.message}). Recarregue a extensão em chrome://extensions e atualize a página SIGITM antes de iniciar novamente.`);
    }
    if (!await possuiConteudoAtual(tabId)) {
      throw new Error("O content script atualizado não respondeu após a reinjeção. Atualize a página SIGITM e tente novamente.");
    }
  }
  const response = await enviarMensagemAba(tabId, { type: CONTENT_MESSAGES.start, runId, mode, protocol: CONTENT_PROTOCOL });
  if (!response?.ok) throw new Error(response?.error || "O content script não confirmou o início do chamado.");
}

async function iniciarExecucao(tab) {
  await restaurarExecucoesAtivas();
  const previous = activeRuns.get(tab.id);
  if (previous && !previous.controller.signal.aborted) {
    previous.controller.abort();
    chrome.tabs.sendMessage(tab.id, { type: "STOP_AUTOMATION", runId: previous.runId }, () => void chrome.runtime.lastError);
  }
  const settings = await BaixaStorage.obterConfiguracoes();
  const runId = crypto.randomUUID();
  const title = String(tab.title || `Chamado ${tab.id}`);
  activeRuns.set(tab.id, { runId, controller: new AbortController(), title, startedAt: new Date().toISOString() });
  await Promise.all([
    persistirExecucoesAtivas(),
    BaixaStorage.set({ [BaixaStorage.KEYS.stop]: false, baixaActiveTabId: tab.id }),
    definirStatusAoVivo(`Iniciando: ${title}.`, "info", { phase: "processando", tabId: tab.id, runId })
  ]);
  try { await iniciarConteudo(tab.id, runId, settings.mode); }
  catch (error) {
    await removerExecucao(tab.id, runId);
    throw error;
  }
}

async function pararTudo() {
  await restaurarExecucoesAtivas();
  const stopped = [...activeRuns].map(([tabId, run]) => [tabId, run.runId]);
  activeRuns.forEach(run => run.controller.abort());
  await Promise.all([persistirExecucoesAtivas(), BaixaStorage.set({ [BaixaStorage.KEYS.stop]: false })]);
  for (const [tabId, runId] of stopped) chrome.tabs.sendMessage(tabId, { type: "STOP_AUTOMATION", runId }, () => void chrome.runtime.lastError);
}

const BLOCKED_PAGE_FUNCTIONS = /^(?:eval|alert|confirm|prompt|open|print|close|logout|setTimeout|setInterval|fetch|Function)$/i;

async function fecharJanelaNaPagina(tabId, request) {
  const kind = request?.kind === "richfaces" ? "richfaces" : request?.kind === "function" ? "function" : "";
  const value = String(request?.value || "");
  const valid = kind === "richfaces" ? /^[\w$.:\-]{1,200}$/.test(value)
    : kind === "function" && /^[A-Za-z_$][\w$]{0,80}$/.test(value) && !BLOCKED_PAGE_FUNCTIONS.test(value);
  if (!valid) throw new Error("Pedido de fechamento de popup inválido.");
  const executions = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [kind, value],
    func: (requestKind, requestValue) => {
      const windows = [];
      const collect = current => {
        windows.push(current);
        for (let index = 0; index < current.frames.length; index++) {
          try { collect(current.frames[index]); } catch { }
        }
      };
      collect(window);
      for (const view of windows) {
        try {
          if (requestKind === "richfaces") {
            const richFaces = view.RichFaces || view.Richfaces;
            if (typeof richFaces?.hideModalPanel === "function") { richFaces.hideModalPanel(requestValue); return true; }
          } else if (typeof view[requestValue] === "function") {
            view[requestValue]();
            return true;
          }
        } catch { }
      }
      return false;
    }
  });
  return executions?.some(item => item.resultado === true) === true;
}

function chavePreConsultaIa(tabId, runId, data, settings) {
  return JSON.stringify([tabId, runId, settings.model, settings.temperature, BaixaHelpers.montarCargaIa(data)]);
}

function descartarPreConsultaIa(tabId, runId = "") {
  for (const [key, entry] of aiPrefetch) {
    if (entry.tabId === tabId && (!runId || entry.runId === runId)) aiPrefetch.delete(key);
  }
}

function iniciarPreConsultaIa(tabId, runId, data, settings, signal) {
  const now = Date.now();
  for (const [key, entry] of aiPrefetch) if (now - entry.startedAt > AI_PREFETCH_TTL_MS) aiPrefetch.delete(key);
  const key = chavePreConsultaIa(tabId, runId, data, settings);
  const existing = aiPrefetch.get(key);
  if (existing) return existing.promise;
  const promise = BaixaAI.analisarCaso(data, settings, signal);
  aiPrefetch.set(key, { tabId, runId, startedAt: now, promise });
  return promise;
}

function obterPreConsultaIa(tabId, runId, data, settings) {
  const key = chavePreConsultaIa(tabId, runId, data, settings);
  const entry = aiPrefetch.get(key);
  aiPrefetch.delete(key);
  return entry && Date.now() - entry.startedAt <= AI_PREFETCH_TTL_MS ? entry.promise : null;
}

function casoDaMensagem(rawCase) {
  if (!rawCase || typeof rawCase !== "object" || Array.isArray(rawCase)) return null;
  return Object.fromEntries(BaixaHelpers.CASE_FIELDS.map(key => [key, rawCase[key] ?? ""]));
}

async function salvarAtual(resultado) {
  const record = { ...resultado, updatedAt: new Date().toISOString() };
  await BaixaStorage.set({ [BaixaStorage.KEYS.current]: record });
  return record;
}

async function tratarCaso(message, sender) {
  if (!senderIsSigitm(sender)) throw new Error("Origem de chamado não autorizada.");
  await restaurarExecucoesAtivas();
  const tabId = sender.tab.id;
  const runId = String(message.runId || "");
  const memoryRun = activeRuns.get(tabId);
  const authorization = BaixaRunGuard.autorizarExecucao({
    tabId, runId, persistentRun: await execucaoArmazenadaDaAba(tabId), memoryRun, stopRequested: false
  });
  if (!authorization.allowed) {
    throw new Error(authorization.reason === "ID da execução ausente."
      ? "ID da execução ausente. Feche e reabra a página SIGITM, depois inicie pela extensão."
      : authorization.reason === "A automação foi interrompida."
        ? "A execução foi parada ou abortada. Escolha o modo de operação e use o botão principal para iniciar uma nova execução."
        : authorization.reason);
  }

  let activeRun = memoryRun;
  if (!activeRun || activeRun.runId !== runId) {
    activeRun = { runId, controller: new AbortController(), title: String(sender.tab.title || `Chamado ${tabId}`), startedAt: new Date().toISOString() };
    activeRuns.set(tabId, activeRun);
    await Promise.all([persistirExecucoesAtivas(), BaixaStorage.set({ baixaActiveTabId: tabId })]);
  }
  const controller = activeRun.controller;
  if (controller.signal.aborted) throw new Error("Automação interrompida pelo usuário.");
  const data = casoDaMensagem(message.caseData);
  if (!data) throw new Error("Dados do chamado inválidos.");

  const deterministic = BaixaRules.decidir(data);
  const automaticClientCode = BaixaRules.codigoAutomaticoParaCliente(data.cliente);
  const settings = await BaixaStorage.obterConfiguracoes();
  const requestedMode = message.mode === "automatic" || message.mode === "analysis" ? message.mode : settings.mode;

  const [ai, learnedCode] = await Promise.all([
    obterPreConsultaIa(tabId, runId, data, settings) || BaixaAI.analisarCaso(data, settings, controller.signal),
    BaixaStorage.obterCodigoAprendido(data)
  ]);
  if (controller.signal.aborted) throw new Error("Automação interrompida pelo usuário.");
  const validation = automaticClientCode
    ? {
      allowed: deterministic.allowed,
      status: "REGRA PRIORITÁRIA DO CLIENTE",
      reason: `Cliente SEDUC/FED: código ${automaticClientCode} aplicado sem perguntar e sem depender da resposta da IA.`
    }
    : BaixaValidation.compararIaComRegras(ai, deterministic, settings.minimumConfidence);
  const decision = {
    ...deterministic,
    runId,
    validation,
    ai: ai.available ? {
      available: true,
      provider: ai.provider,
      confidence: ai.decision.confianca,
      motivo: ai.decision.motivo,
      proposedCode: ai.decision.codigoBaixa
    } : {
      available: false,
      provider: BaixaAI.PROVIDER_LABEL,
      confidence: null,
      motivo: ai.reason
    },
    allowed: deterministic.allowed && validation.allowed,
    mode: requestedMode,
    caseData: {
      ...data,
      dataReparoOriginal: String(message.caseData.dataReparoOriginal ?? ""),
      dataInicioParadaRelogio: String(message.caseData.dataInicioParadaRelogio ?? ""),
      dataFimParadaRelogio: String(message.caseData.dataFimParadaRelogio ?? ""),
      dataReparoPrevista: String(message.caseData.dataReparoPrevista ?? ""),
      validacaoDataBaixa: String(message.caseData.validacaoDataBaixa ?? "")
    },
    learnedCode,
    analyzedAt: new Date().toISOString()
  };
  await salvarAtual(decision);
  return decision;
}

async function salvarAprendizadoCodigo(message, sender) {
  const code = String(message.codigoBaixa || "");
  const caseData = casoDaMensagem(message.caseData);
  if (!BaixaRules.CODES.includes(code) || !caseData) throw new Error("Código ou dados de aprendizagem inválidos.");
  const run = await execucaoArmazenadaDaAba(sender.tab.id);
  if (run?.runId !== message.runId || run.stopped) throw new Error("A execução não está mais ativa para salvar a escolha.");
  const learning = await BaixaStorage.salvarCodigoAprendido(caseData, code);
  const currentState = await BaixaStorage.get(BaixaStorage.KEYS.current);
  const current = currentState[BaixaStorage.KEYS.current] || {};
  const source = message.source === "aprendido" ? "aprendido" : "usuário";
  const sourceLabel = source === "aprendido" ? "reutilizado da escolha salva" : "escolhido pelo usuário";
  if (current.runId === message.runId) {
    await salvarAtual({
      ...current,
      codigoBaixa: code,
      motivo: `Código ${code} ${sourceLabel}.`,
      validation: {
        ...current.validation,
        allowed: true,
        status: source === "aprendido" ? "CÓDIGO APRENDIDO" : "CÓDIGO CONFIRMADO PELO USUÁRIO",
        reason: `Código ${code} ${sourceLabel}.`
      },
      codeSelection: { source, codigoBaixa: code, ocorrencias: learning.ocorrencias }
    });
  }
  return { codigoBaixa: code, ocorrencias: learning.ocorrencias };
}

async function finalizarExecucao(message, sender) {
  const tabId = sender.tab.id;
  const run = await execucaoArmazenadaDaAba(tabId);
  const matchesRun = run?.runId === message.runId;
  if (matchesRun) await removerExecucao(tabId, message.runId);
  const failed = message.finalStatus === "error";
  const interrupted = message.finalStatus === "info";
  const finalMessage = failed
    ? `BAIXA NÃO REALIZADA\n${String(message.finalMessage || "Erro informado pelo SIGITM.")}\nNenhuma ação adicional será iniciada.`
    : interrupted ? "Processamento interrompido pelo usuário." : "Execução encerrada. O resultado final foi salvo no histórico.";
  await definirStatusAoVivo(finalMessage, failed ? "error" : interrupted ? "info" : "success", {
    phase: failed ? "atenção" : interrupted ? "pausado" : "concluído", tabId, runId: message.runId
  });
  return { cleared: matchesRun };
}

async function registrarResultadoFinal(message, sender) {
  const run = await execucaoArmazenadaDaAba(sender.tab.id);
  if (run?.runId !== message.runId) return;
  const record = message.record || {};
  await BaixaStorage.adicionarHistorico(record);
  if (record.resultado === "PROCESSAMENTO INTERROMPIDO") return;
  const currentState = await BaixaStorage.get(BaixaStorage.KEYS.current);
  const current = currentState[BaixaStorage.KEYS.current] || {};
  if (current.runId === message.runId) {
    await salvarAtual({ ...current, executionResult: record.resultado || "", executionError: record.erro || "" });
  }
}

async function estadoExtensao() {
  await restaurarExecucoesAtivas();
  const [stored, settings] = await Promise.all([
    BaixaStorage.get([BaixaStorage.KEYS.current, BaixaStorage.KEYS.stop, "baixaAiConnectionStatus", "baixaLiveStatus"]),
    BaixaStorage.obterConfiguracoes()
  ]);
  const stopped = stored[BaixaStorage.KEYS.stop] === true;
  return {
    current: stored[BaixaStorage.KEYS.current] || null,
    stopped,
    automationActive: !stopped && [...activeRuns.values()].some(run => !run.controller.signal.aborted),
    mode: settings.mode,
    aiConfigured: Boolean(settings.apiKey),
    aiConnection: stored.baixaAiConnectionStatus || null,
    liveStatus: stored.baixaLiveStatus || null
  };
}

async function testarIa(message) {
  const current = await BaixaStorage.obterConfiguracoes();
  const apiKey = current.apiKey;
  if (!apiKey) throw new Error("Informe e salve uma API Key antes de testar.");
  const sample = {
    tipoAbertura: "INICIAL",
    procedencia: "REATIVO",
    tipoIncidencia: "DADOS",
    cliente: "SEDUC - SECRETARIA DE EDUCAÇÃO",
    intragov: false,
    servicoAfetado: "Internet"
  };
  const model = String(message.settings?.model || current.model).trim();
  const resultado = await BaixaAI.analisarCaso(sample, {
    apiKey, model, temperature: Number(message.settings?.temperature ?? current.temperature)
  });
  if (!resultado.available) throw new Error(String(resultado.reason || "Falha desconhecida.").split(apiKey).join("[chave ocultada]"));
  return { provider: BaixaAI.PROVIDER_LABEL, model, structuredJson: true };
}

async function salvarOpcoes(value) {
  const current = await BaixaStorage.obterConfiguracoes();
  const temperature = Number(value.temperature);
  const confidence = Number(value.minimumConfidence);
  await BaixaStorage.set({
    [BaixaStorage.KEYS.settings]: {
      apiKey: value.deleteApiKey ? "" : String(value.apiKey || "").trim() || current.apiKey,
      model: String(value.model || BaixaHelpers.DEFAULT_MODEL).trim(),
      temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : current.temperature,
      minimumConfidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : current.minimumConfidence,
      mode: value.mode === "automatic" ? "automatic" : "analysis"
    }
  });
}

const EXTENSION_HANDLERS = {
  RUN_ACTIVE_TAB: () => new Promise((resolve, reject) => chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    if (!tab?.id || !urlChamado(tab.url)) reject(new Error("Abra um chamado SIGITM na aba atual."));
    else executarSerial(() => iniciarExecucao(tab)).then(() => resolve({}), reject);
  })),
  STOP_AUTOMATION: () => executarSerial(pararTudo).then(() => ({})),
  CLEAR_HISTORY: () => BaixaStorage.limparHistorico().then(() => ({})),
  LIST_LEARNING: () => BaixaStorage.listarCodigosAprendidos().then(entries => ({ entries })),
  DELETE_LEARNING: message => BaixaStorage.excluirCodigoAprendido(String(message.key || "")).then(deleted => ({ deleted })),
  CLEAR_LEARNING: () => BaixaStorage.limparCodigosAprendidos().then(() => ({})),
  IMPORT_LEARNING: message => BaixaStorage.importarCodigosAprendidos(message.entries),
  GET_EXTENSION_STATE: estadoExtensao,
  GET_OPTIONS: async () => {
    const [settings, stored] = await Promise.all([BaixaStorage.obterConfiguracoes(), BaixaStorage.get(BaixaStorage.KEYS.history)]);
    return {
      settings: {
        model: settings.model, temperature: settings.temperature, minimumConfidence: settings.minimumConfidence, mode: settings.mode
      },
      hasApiKey: Boolean(settings.apiKey),
      history: stored[BaixaStorage.KEYS.history] || []
    };
  },
  TEST_AI_API: async message => {
    try {
      const test = await testarIa(message);
      await BaixaStorage.set({ baixaAiConnectionStatus: { connected: true, ...test, testedAt: new Date().toISOString(), message: "Conexão e resposta JSON validadas." } });
      return { test };
    } catch (error) {
      const status = { connected: false, provider: BaixaAI.PROVIDER_LABEL, testedAt: new Date().toISOString(), message: error.message || "Não foi possível testar a API." };
      await BaixaStorage.set({ baixaAiConnectionStatus: status }).catch(() => undefined);
      throw new Error(status.message);
    }
  },
  SAVE_OPTIONS: message => salvarOpcoes(message.settings || {}).then(() => ({}))
};

const SIGITM_HANDLERS = {
  PAGE_CLOSE_POPUP: (message, sender) => fecharJanelaNaPagina(sender.tab.id, message).then(closed => ({ closed })),
  PREFETCH_ANALYSIS: async (message, sender) => {
    const activeRun = activeRuns.get(sender.tab.id);
    const data = casoDaMensagem(message.caseData);
    if (!activeRun || activeRun.runId !== String(message.runId || "") || activeRun.controller.signal.aborted || !data) return { started: false };
    iniciarPreConsultaIa(sender.tab.id, activeRun.runId, data, await BaixaStorage.obterConfiguracoes(), activeRun.controller.signal);
    return { started: true };
  },
  ANALYZE_CASE: async (message, sender) => ({ decision: await tratarCaso(message, sender) }),
  SAVE_CODE_LEARNING: async (message, sender) => ({ learning: await salvarAprendizadoCodigo(message, sender) }),
  AUTOMATION_STATUS: (message, sender) => definirStatusAoVivo(message.message, message.status, {
    phase: message.status === "error" ? "atenção" : "processando", tabId: sender.tab.id, runId: String(message.runId || "")
  }).then(() => ({})),
  RUN_FINISHED: finalizarExecucao,
  RECORD_FINAL_RESULT: (message, sender) => registrarResultadoFinal(message, sender).then(() => ({}))
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;
  const handlers = Object.hasOwn(EXTENSION_HANDLERS, type) ? EXTENSION_HANDLERS : Object.hasOwn(SIGITM_HANDLERS, type) ? SIGITM_HANDLERS : null;
  if (!handlers) return false;
  const authorized = handlers === EXTENSION_HANDLERS ? senderIsExtension(sender) : senderIsSigitm(sender);
  if (!authorized) { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
  Promise.resolve().then(() => handlers[type](message, sender))
    .then(resultado => sendResponse({ ok: true, ...resultado }))
    .catch(error => sendResponse({ ok: false, error: error.message || "Falha desconhecida." }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  void restaurarExecucoesAtivas().then(() => removerExecucao(tabId)).catch(() => undefined);
});
