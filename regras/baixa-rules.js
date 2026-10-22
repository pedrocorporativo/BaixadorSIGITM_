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
