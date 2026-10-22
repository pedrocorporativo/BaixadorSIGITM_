"use strict";

importScripts(
  "../utilitarios/helpers.js",
  "../armazenamento/storage.js",
  "../regras/baixa-rules.js",
  "../regras/validation.js",
  "../inteligencia/ai-schema.js",
  "../inteligencia/ai-service.js",
  "run-guard.js"
);

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
