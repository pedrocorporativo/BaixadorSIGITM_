"use strict";

const $ = id => document.getElementById(id);
let hasSavedKey = false;
let allHistory = [];

function definirHistorico(history) {
  allHistory = Array.isArray(history) ? history : [];
  renderizarEstatisticas(allHistory);
  const select = $("historyResult");
  const current = select.value;
  const results = [...new Set(allHistory.map(item => String(item.resultado || "")).filter(Boolean))].sort();
  select.replaceChildren(new Option("Todos os resultados", ""), ...results.map(value => new Option(value, value)));
  select.value = results.includes(current) ? current : "";
  aplicarFiltroHistorico();
}

function aplicarFiltroHistorico() {
  const filtered = BaixaHelpers.filtrarHistorico(allHistory, { text: $("historySearch").value, resultado: $("historyResult").value });
  renderizarHistorico(filtered);
  $("historyCount").textContent = `${filtered.length} de ${allHistory.length}`;
}

function cartaoEstatistica(label, value, className = "") {
  const card = document.createElement("div");
  card.className = `stat ${className}`.trim();
  const strong = document.createElement("strong");
  strong.textContent = value;
  const span = document.createElement("span");
  span.textContent = label;
  card.append(strong, span);
  return card;
}

function renderizarEstatisticas(history) {
  const summary = BaixaHelpers.resumirHistorico(history);
  const grid = $("statsGrid");
  grid.replaceChildren(
    cartaoEstatistica("Execuções registradas", String(summary.total)),
    cartaoEstatistica("Baixas concluídas", String(summary.success), "ok"),
    cartaoEstatistica("Falhas / bloqueios", String(summary.failed), summary.failed ? "bad" : ""),
    cartaoEstatistica("Taxa de sucesso", summary.total ? `${Math.round(summary.successRate * 100)}%` : "—")
  );
  const codes = Object.entries(summary.byCode).sort((a, b) => b[1] - a[1]);
  if (codes.length) {
    const card = cartaoEstatistica("Baixas por código", "");
    card.querySelector("strong").remove();
    const list = document.createElement("ul");
    codes.forEach(([code, count]) => { const item = document.createElement("li"); item.textContent = `${code}: ${count}`; list.appendChild(item); });
    card.appendChild(list);
    grid.appendChild(card);
  }
  const days = Object.entries(summary.byDay).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 5);
  if (days.length) {
    const card = cartaoEstatistica("Últimos dias com baixas", "");
    card.querySelector("strong").remove();
    const list = document.createElement("ul");
    days.forEach(([day, count]) => { const item = document.createElement("li"); item.textContent = `${day.split("-").reverse().join("/")}: ${count}`; list.appendChild(item); });
    card.appendChild(list);
    grid.appendChild(card);
  }
}

function renderizarAprendizado(entries) {
  const body = $("learningBody");
  body.replaceChildren();
  if (!entries.length) {
    const row = document.createElement("tr");
    const empty = cell("Nenhuma escolha aprendida.");
    empty.colSpan = 9;
    empty.className = "empty";
    row.appendChild(empty);
    body.appendChild(row);
    return;
  }
  for (const entry of entries) {
    const info = BaixaHelpers.descreverChaveAprendizado(entry.key) || {};
    const row = document.createElement("tr");
    [entry.codigoBaixa, info.tipoAbertura, info.procedencia, info.tipoIncidencia, info.intragov, info.servicoAfetado, entry.ocorrencias,
      entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : ""].forEach(value => row.appendChild(cell(value)));
    const actions = document.createElement("td");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary subtle delete-learning";
    remove.textContent = "Remover";
    remove.addEventListener("click", async () => {
      try { await send({ type: "DELETE_LEARNING", key: entry.key }); await carregarAprendizado(); }
      catch (error) { $("saveStatus").textContent = error.message; }
    });
    actions.appendChild(remove);
    row.appendChild(actions);
    body.appendChild(row);
  }
}

let learningEntries = [];
async function carregarAprendizado() {
  learningEntries = (await send({ type: "LIST_LEARNING" })).entries || [];
  renderizarAprendizado(learningEntries);
}

function downloadJson(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

$("historySearch").addEventListener("input", aplicarFiltroHistorico);
$("historyResult").addEventListener("change", aplicarFiltroHistorico);

$("exportLearning").addEventListener("click", () => {
  downloadJson(`codigos-aprendidos-${new Date().toISOString().slice(0, 10)}.json`, { versao: 1, entries: learningEntries });
});
$("importLearning").addEventListener("click", () => $("importLearningFile").click());
$("importLearningFile").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error("Arquivo de backup grande demais.");
    const data = JSON.parse(await file.text());
    const resultado = await send({ type: "IMPORT_LEARNING", entries: Array.isArray(data) ? data : data?.entries });
    $("saveStatus").textContent = `Backup importado: ${resultado.imported} código(s) novo(s)/atualizado(s), ${resultado.ignored} ignorado(s).`;
    await carregarAprendizado();
  } catch (error) { $("saveStatus").textContent = `Não foi possível importar: ${error.message}`; }
});
$("clearLearning").addEventListener("click", async () => {
  if (!confirm("Apagar todos os códigos aprendidos? A extensão voltará a perguntar nas combinações sem regra.")) return;
  try { await send({ type: "CLEAR_LEARNING" }); await carregarAprendizado(); }
  catch (error) { $("saveStatus").textContent = error.message; }
});

function send(message) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else if (!response?.ok) reject(new Error(response?.error || "Falha de comunicação."));
    else resolve(response);
  }));
}

function cell(text) {
  const element = document.createElement("td");
  element.textContent = text == null || text === "" ? "—" : String(text);
  return element;
}

function renderizarHistorico(history) {
  const body = $("historyBody");
  body.replaceChildren();
  if (!Array.isArray(history) || !history.length) {
    const row = document.createElement("tr");
    const empty = cell("Nenhuma execução registrada.");
    empty.colSpan = 7;
    empty.className = "empty";
    row.appendChild(empty);
    body.appendChild(row);
    return;
  }
  [...history].reverse().forEach(item => {
    const row = document.createElement("tr");
    [item.dataHora, item.numeroChamado, item.codigoBaixa, item.resultado, item.iaUtilizada, item.confianca == null || item.confianca === "" ? "" : `${Math.round(Number(item.confianca) * 100)}%`, item.erro || item.motivo].forEach(value => row.appendChild(cell(value)));
    body.appendChild(row);
  });
}

async function load() {
  const resultado = await send({ type: "GET_OPTIONS" });
  const settings = resultado.settings;
  hasSavedKey = resultado.hasApiKey;
  $("model").value = settings.model || BaixaHelpers.DEFAULT_MODEL;
  $("temperature").value = String(settings.temperature ?? 0);
  $("confidence").value = String(settings.minimumConfidence ?? 0.85);
  $("mode").value = settings.mode || "analysis";
  $("keyStatus").textContent = hasSavedKey ? "Chave salva · conexão não testada" : "Chave não salva";
  definirHistorico(resultado.history);
  await carregarAprendizado();
}

$("showKey").addEventListener("change", event => { $("apiKey").type = event.target.checked ? "text" : "password"; });
$("removeKey").addEventListener("change", event => {
  $("apiKey").disabled = event.target.checked;
  if (event.target.checked) $("apiKey").value = "";
});

async function salvarConfiguracoesFormulario() {
  const apiKey = $("apiKey").value.trim();
  const settings = {
    apiKey,
    deleteApiKey: $("removeKey").checked,
    model: $("model").value.trim(),
    temperature: Number($("temperature").value),
    minimumConfidence: Number($("confidence").value),
    mode: $("mode").value
  };
  if (settings.mode === "automatic" && !confirm("O modo automático altera os campos e aciona Gravar Baixa após as validações. Deseja manter este modo?")) {
    $("mode").value = "analysis";
    settings.mode = "analysis";
  }
  await send({ type: "SAVE_OPTIONS", settings });
  $("apiKey").value = "";
  $("removeKey").checked = false;
  $("apiKey").disabled = false;
  hasSavedKey = settings.deleteApiKey ? false : Boolean(apiKey) || hasSavedKey;
  return settings;
}

$("settingsForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("saveStatus").textContent = "Salvando…";
  try {
    await salvarConfiguracoesFormulario();
    $("saveStatus").textContent = "Configurações salvas no armazenamento local.";
    await load();
  } catch (error) { $("saveStatus").textContent = error.message; }
});

$("testApi").addEventListener("click", async () => {
  const apiKey = $("apiKey").value.trim();
  if ($("removeKey").checked && !apiKey) {
    $("saveStatus").textContent = "A chave está marcada para remoção. Cole uma nova chave ou desmarque “Remover a chave salva” antes de testar.";
    return;
  }
  if (!apiKey && !hasSavedKey) {
    $("saveStatus").textContent = "Cole uma chave Groq nova para conectar a IA.";
    return;
  }
  const button = $("testApi");
  button.disabled = true;
  button.textContent = "Salvando e testando…";
  const model = $("model").value.trim();
  const temperature = Number($("temperature").value);
  $("saveStatus").textContent = "Salvando a configuração e testando a conexão com o Groq usando dados sintéticos…";
  try {
    await salvarConfiguracoesFormulario();
    const resultado = await send({ type: "TEST_AI_API", settings: { model, temperature } });
    $("keyStatus").textContent = `Conexão ${resultado.test.provider} validada`;
    $("saveStatus").textContent = `API respondeu com JSON estruturado (${resultado.test.model}). Teste sintético concluído; a classificação do chamado ainda será comparada às regras locais.`;
  } catch (error) {
    $("keyStatus").textContent = "Conexão não validada";
    $("saveStatus").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Salvar e testar Groq";
  }
});

$("exportCsv").addEventListener("click", async () => {
  let resultado;
  try { resultado = await send({ type: "GET_OPTIONS" }); }
  catch (error) { $("saveStatus").textContent = error.message; return; }
  const rows = [
    ["Data/hora", "Chamado", "Código", "Resultado", "IA", "Confiança", "Motivo", "Erro"],
    ...(resultado.history || []).map(item => [item.dataHora, item.numeroChamado, item.codigoBaixa, item.resultado, item.iaUtilizada, item.confianca, item.motivo, item.erro])
  ];
  const csv = "\uFEFF" + rows.map(row => row.map(BaixaHelpers.escaparCsv).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `historico-baixa-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

$("limparHistorico").addEventListener("click", async () => {
  if (!confirm("Apagar todo o histórico local desta extensão?")) return;
  try {
    await send({ type: "CLEAR_HISTORY" });
    await load();
  } catch (error) { $("saveStatus").textContent = error.message; }
});

void load().catch(error => { $("saveStatus").textContent = error.message; });
