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
