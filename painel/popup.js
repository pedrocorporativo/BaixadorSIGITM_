"use strict";

const $ = id => document.getElementById(id);

function erroAmigavel(error) {
  const message = String(error?.message || error || "Falha desconhecida.");
  if (/could not establish connection|receiving end does not exist/i.test(message)) {
    return "A extensão ainda não conectou à página. Recarregue a extensão em chrome://extensions e depois atualize a página do SIGITM.";
  }
  return message;
}

function send(message) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else if (!response?.ok) reject(new Error(response?.error || "Falha de comunicação."));
    else resolve(response);
  }));
}

function atualizarAcaoPrincipal(mode = $("mode").value) {
  const automatic = mode === "automatic";
  $("executeLabel").textContent = automatic ? "Baixar automaticamente" : "Analisar chamado";
  $("executeIcon").textContent = automatic ? "▶" : "⌕";
  $("execute").setAttribute("aria-label", automatic ? "Baixar automaticamente" : "Analisar chamado");
}

function renderizarEstado(state) {
  const resultado = state.current;
  $("mode").value = state.mode || "analysis";
  atualizarAcaoPrincipal($("mode").value);
  $("modeHint").textContent = state.mode === "automatic"
    ? "Preenche e grava o chamado atual. Use PARAR a qualquer momento."
    : "Lê os campos e mostra o código recomendado; não altera o chamado.";
  const stopButton = $("stop");
  if (state.stopped) {
    stopButton.disabled = true;
    stopButton.dataset.state = "paused";
    stopButton.innerHTML = '<span aria-hidden="true">Ⅱ</span> Automação pausada';
  } else if (state.automationActive) {
    stopButton.disabled = false;
    stopButton.dataset.state = "active";
    stopButton.innerHTML = '<span aria-hidden="true">Ⅱ</span> Pausar automação';
  } else {
    stopButton.disabled = true;
    stopButton.dataset.state = "idle";
    stopButton.innerHTML = '<span aria-hidden="true">■</span> Automação inativa';
  }
  const live = state.liveStatus;
  const liveSection = $("liveStatus");
  if (liveSection) {
    const isActive = Boolean(state.automationActive);
    const liveType = live?.status === "error" ? "error"
      : live?.status === "success" ? "success"
      : isActive ? "active" : "idle";
    liveSection.dataset.state = liveType;
    $("liveTitle").textContent = isActive
      ? "Executando automação"
      : (live?.phase === "concluído" ? "Última execução concluída" : state.stopped ? "Automação pausada" : "Aguardando comando");
    $("liveMessage").textContent = live?.message || (state.stopped
      ? "A automação foi pausada pelo usuário."
      : "Abra um chamado SIGITM e inicie a automação.");
    $("liveBadge").textContent = liveType === "error" ? "ATENÇÃO"
      : liveType === "success" ? "CONCLUÍDO"
      : isActive ? "EM ANDAMENTO"
      : state.stopped ? "PAUSADO" : "PARADO";
  }

  const connection = state.aiConnection;
  if (!state.aiConfigured) {
    $("aiStatus").dataset.state = "fallback";
    $("aiStatusTitle").textContent = "Sem conexão — regras locais ativas";
    $("aiStatusText").textContent = "A IA não é necessária para baixar: as regras locais continuam classificando os chamados. Sem chave Groq, não há conferência online.";
  } else if (connection?.connected) {
    $("aiStatus").dataset.state = "ready";
    $("aiStatusTitle").textContent = `Conectada — validação adicional ativa (${connection.provider})`;
    const testedAt = connection.testedAt ? new Date(connection.testedAt).toLocaleString() : "";
    $("aiStatusText").textContent = `${connection.model || "Modelo configurado"} · teste aprovado. A IA confere as regras locais; se houver divergência, a baixa é bloqueada.${testedAt ? ` Testada: ${testedAt}.` : ""}`;
  } else if (connection?.connected === false) {
    $("aiStatus").dataset.state = "error";
    $("aiStatusTitle").textContent = `IA indisponível — regras locais continuam ativas`;
    $("aiStatusText").textContent = `${connection.message || "O último teste da IA falhou."} A IA é opcional; se a consulta falhar, as regras locais são usadas. Uma divergência válida continua bloqueando a baixa.`;
  } else {
    $("aiStatus").dataset.state = "saved";
    $("aiStatusTitle").textContent = "Chave salva — conexão ainda não testada (Groq)";
    $("aiStatusText").textContent = "A extensão tentará usar a IA e recorrerá às regras locais se ela falhar. Se a IA responder com uma classificação divergente, a baixa será bloqueada.";
  }
  if (!resultado) return;
  $("resultado").dataset.state = resultado.allowed ? "ready" : "bloqueado";
  $("resultTitle").textContent = resultado.executionResult || (resultado.allowed ? `${resultado.codigoBaixa} · ${resultado.validation?.status || "Validado"}` : (resultado.validation?.status || "Bloqueado"));
  const lines = [
    `Chamado: ${resultado.caseData?.numeroChamado || "não identificado"}`,
    `Tipo de Abertura: ${resultado.caseData?.tipoAbertura || "não identificado"}`,
    `Procedência: ${resultado.caseData?.procedencia || "não identificada"}`,
    `Tipo de Incidência: ${resultado.caseData?.tipoIncidencia || "não identificada"}`,
    `Cliente: ${resultado.caseData?.cliente || "não identificado"}`,
    `Intragov: ${resultado.caseData?.intragov === true ? "Sim" : resultado.caseData?.intragov === false ? "Não" : resultado.caseData?.intragov || "não identificado"}`,
    `Serviço Afetado: ${resultado.caseData?.servicoAfetado || "não identificado"}`,
    `Data Criação: ${resultado.caseData?.dataCriacao || "não identificada"}`,
    `Data de Reparo original: ${resultado.caseData?.dataReparoOriginal || "não identificada"}`,
    `Data/hora que será utilizada para a baixa: ${resultado.caseData?.dataReparo || resultado.caseData?.dataReparoPrevista || "não calculável"}`,
    `Validação de data e SLA: ${resultado.caseData?.validacaoDataBaixa || "não executada"}`,
    `Início do SLA: ${resultado.caseData?.dataInicioSla || "não identificado"}`,
    `Data Objetivo: ${resultado.caseData?.dataObjetivo || "não identificada"}`,
    `Pausa de Relógio: ${resultado.caseData?.paradaRelogio || "não identificada"}`,
    `Início da parada: ${resultado.caseData?.dataInicioParadaRelogio || resultado.caseData?.dataParadaRelogio || "não identificado"}`,
    `Fim da parada: ${resultado.caseData?.dataFimParadaRelogio || "não identificado"}`,
    `Acionamento: ${resultado.caseData?.codigoAcionamento || resultado.caseData?.acionamento || "não identificado"}`,
    `Código de baixa previsto: ${resultado.codigoBaixa || "não determinado — dados de classificação insuficientes"}`,
    `Diagnóstico previsto: ${resultado.diagnostico || "não determinado — incidência/regra não identificada"}`,
    `Origem/regra do código: ${resultado.codeSelection?.source || resultado.motivo || "não determinada"}`,
    `Motivo: ${resultado.motivo || resultado.validation?.reason || "—"}`,
    `Confiança IA: ${resultado.ai?.confidence == null ? "indisponível" : `${Math.round(resultado.ai.confidence * 100)}%`}`,
    `Validação: ${resultado.validation?.reason || resultado.validation?.status || "—"}`
  ];
  $("resultSummary").textContent = lines.join("\n");
}

async function atualizar() {
  try { renderizarEstado(await send({ type: "GET_EXTENSION_STATE" })); }
  catch (error) { $("resultTitle").textContent = "Extensão desconectada"; $("resultSummary").textContent = erroAmigavel(error); }
}

$("mode").addEventListener("change", async event => {
  const mode = event.target.value;
  if (mode === "automatic" && !confirm("O modo automático preencherá e acionará Gravar Baixa após todas as validações. Deseja ativá-lo?")) {
    event.target.value = "analysis";
    atualizarAcaoPrincipal("analysis");
    return;
  }
  atualizarAcaoPrincipal(mode);
  try {
    const options = await send({ type: "GET_OPTIONS" });
    await send({ type: "SAVE_OPTIONS", settings: { ...options.settings, mode } });
    atualizarAcaoPrincipal(mode);
    await atualizar();
  } catch (error) { $("resultSummary").textContent = erroAmigavel(error); }
});

async function iniciarExecucao() {
  const mode = $("mode").value;
  const button = $("execute");
  button.disabled = true;
  $("executeLabel").textContent = mode === "automatic" ? "Iniciando fluxo…" : "Iniciando análise…";
  try {
    const options = await send({ type: "GET_OPTIONS" });
    await send({ type: "SAVE_OPTIONS", settings: { ...options.settings, mode } });
    await send({ type: "RUN_ACTIVE_TAB" });
    window.close();
  } catch (error) {
    $("resultTitle").textContent = "Não foi possível iniciar";
    $("resultSummary").textContent = erroAmigavel(error);
    button.disabled = false;
    atualizarAcaoPrincipal($("mode").value);
  }
}

$("execute").addEventListener("click", async () => {
  if ($("mode").value === "automatic") {
    const approved = confirm("Executar a baixa automática deste chamado?");
    if (!approved) return;
  }
  await iniciarExecucao();
});

$("stop").addEventListener("click", async () => {
  try {
    $("stop").disabled = true;
    $("stop").textContent = "Pausando…";
    await send({ type: "STOP_AUTOMATION" });
    await atualizar();
    $("resultTitle").textContent = "Automação pausada";
    $("resultSummary").textContent = "A execução atual foi interrompida e nenhuma próxima ação será iniciada. Para rodar novamente, escolha o modo e use o botão principal.";
  }
  catch (error) {
    $("resultTitle").textContent = "Não foi possível parar";
    $("resultSummary").textContent = erroAmigavel(error);
    void atualizar();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.baixaCurrentResult || changes.baixaSettings || changes.baixaStopRequested || changes.baixaAiConnectionStatus || changes.baixaActiveRuns || changes.baixaLiveStatus)) void atualizar();
});
void atualizar();
