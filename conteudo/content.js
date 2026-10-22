(() => {
  "use strict";
  if (window.top !== window || !["sigitm.redecorp.br", "10.240.59.14"].includes(location.hostname.toLowerCase())) return;
  const CONTENT_PROTOCOL = "baixa-controller-v26";
  const controllerKey = "__BAIXADOR_AUTOMATICO_V26__";
  if (globalThis[controllerKey]) return;
  globalThis[controllerKey] = true;

  let stopRequested = false;
  let processing = false;
  let currentRunId = "";
  let queuedRunId = "";
  let queuedMode = "";

  const stopCheck = () => stopRequested;
  const norm = value => BaixaHelpers.normalizarTexto(value);
  const notify = (message, type = "info") => {
    try { BaixaNotifications.mostrar(message, type); } catch { }
    try {
      chrome.runtime.sendMessage({
        type: "AUTOMATION_STATUS",
        runId: currentRunId,
        status: type,
        message: String(message || "")
      }, () => { try { void chrome.runtime.lastError; } catch { } });
    } catch { }
  };

  function enviarMensagemRuntime(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, response => {
          let runtimeError = null;
          try { runtimeError = chrome.runtime.lastError; } catch { }
          if (runtimeError) reject(new Error(runtimeError.message));
          else if (!response?.ok) reject(new Error(response?.error || "Falha na comunicação da extensão."));
          else resolve(response);
        });
      } catch (error) {
        reject(new Error(/context invalidated/i.test(String(error?.message || error))
          ? "A extensão foi recarregada durante a execução. Atualize a página SIGITM antes de tentar novamente."
          : String(error?.message || error || "Falha na comunicação da extensão.")));
      }
    });
  }

  function enviarFinal(record) {
    return enviarMensagemRuntime({ type: "RECORD_FINAL_RESULT", runId: currentRunId, record })
      .catch(error => { console.warn("[Baixador Automático] Não foi possível registrar o resultado final:", error?.message || error); });
  }

  function resumoCertificacao(resultado) {
    const skipped = Array.isArray(resultado.skipped) && resultado.skipped.length
      ? ` Campo(s) ausente(s) ignorado(s): ${resultado.skipped.join(", ")}.`
      : "";
    return `Certificação verificada somente nos controles autorizados (${resultado.checked?.length ?? 7} localizado(s), ${resultado.changed} alteração(ões)); os demais campos não foram consultados nem alterados.${skipped}`;
  }

  function eBooleanoSim(value) { return value === true || norm(value) === "sim"; }
  function eBooleanoNao(value) { return value === false || norm(value) === "nao"; }

  function exibirDados(data) {
    return [
      `Chamado: ${data.numeroChamado || "não identificado"}`,
      `Tipo de Abertura: ${data.tipoAbertura || "não identificado"}`,
      `Procedência: ${data.procedencia || "não identificada"}`,
      `Tipo de Incidência: ${data.tipoIncidencia || "não identificada"}`,
      `Cliente: ${data.cliente || "não identificado"}`,
      `Intragov: ${eBooleanoSim(data.intragov) ? "Sim" : eBooleanoNao(data.intragov) ? "Não" : "não identificado"}`,
      `Serviço Afetado: ${data.servicoAfetado || "não identificado"}`,
      `Data Criação: ${data.dataCriacao || "não identificada"}`,
      `Data de Reparo original: ${data.dataReparoOriginal || "não identificada"}`,
      `Data de Reparo que será utilizada no Encerramento: ${data.dataReparo || data.dataReparoPrevista || "não calculável"}`,
      `Início do SLA: ${data.dataInicioSla || "não identificado"}`,
      `Data Objetivo: ${data.dataObjetivo || "não identificada"}`,
      `Parada de Relógio: ${data.paradaRelogio || "não identificada"}`,
      `Início da parada: ${data.dataInicioParadaRelogio || "não identificado"}`,
      `Fim da parada: ${data.dataFimParadaRelogio || "não identificado"}`,
      `Data/hora que será utilizada para a baixa: ${data.dataReparo || data.dataReparoPrevista || "não calculável"}`,
      `Validação de data e SLA: ${data.validacaoDataBaixa || "não executada"}`,
      `Acionamento: ${data.codigoAcionamento ? `${data.codigoAcionamento} (${data.acionamento})` : data.acionamento || "não identificado"}`
    ].join("\n");
  }

  function adicionarPrevisaoOperacional(data) {
    const validation = BaixaDateHandler.validarDatas(data);
    data.dataReparoPrevista = validation.repairValue || "";
    data.dataReparo = validation.repairValue || "";
    data.validacaoDataBaixa = validation.valid
      ? validation.warnings?.length ? `Aprovada com avisos: ${validation.warnings.join(" ")}` : "Aprovada"
      : validation.reason;
  }

  async function solicitarDecisao(data, mode = "") {
    const response = await enviarMensagemRuntime({ type: "ANALYZE_CASE", runId: currentRunId, caseData: data, mode });
    return response.decision;
  }

  function pedirCodigoBaixa(data, shouldStop = () => false) {
    return new Promise((resolve, reject) => {
      const style = document.createElement("style");
      style.textContent = `
        #baixa-code-choice-overlay{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:20px;background:#101828b3;backdrop-filter:blur(3px);font:14px 'Segoe UI',system-ui,sans-serif;color:#172033}
        #baixa-code-choice-dialog{width:min(540px,100%);max-height:90vh;overflow:auto;padding:28px;border-radius:24px;background:#fff;box-shadow:0 30px 90px #0006,0 0 0 1px #ffffff22}
        #baixa-code-choice-dialog h2{margin:0 0 8px;font-size:22px;font-weight:800;letter-spacing:-.03em}#baixa-code-choice-dialog p{margin:0 0 18px;color:#596579;line-height:1.55}
        #baixa-code-choice-dialog .baixa-case-fields{display:grid;grid-template-columns:minmax(110px,auto) 1fr;gap:8px 14px;margin:0 0 20px;padding:15px;border:1px solid #e3e7f0;border-radius:16px;background:#f8f9fc;font-size:12px}
        #baixa-code-choice-dialog .baixa-case-fields dt{color:#697386;font-size:11px;letter-spacing:.02em}#baixa-code-choice-dialog .baixa-case-fields dd{margin:0;color:#1b2640;font-weight:700;overflow-wrap:anywhere}
        #baixa-code-choice-dialog .baixa-choice-list{display:grid;gap:10px}
        #baixa-code-choice-dialog button{width:100%;padding:14px 16px;border:1px solid #d8deea;border-radius:16px;background:#fff;color:#1b2640;text-align:left;font:inherit;cursor:pointer;transition:border-color .15s,background .15s,transform .15s}
        #baixa-code-choice-dialog button:hover,#baixa-code-choice-dialog button:focus{border-color:#63308b;background:#f8f3fc;outline:3px solid #63308b2e;transform:translateY(-1px)}
        #baixa-code-choice-dialog button strong{display:block;color:#57247d;font-size:16px;font-weight:800;letter-spacing:.02em}#baixa-code-choice-dialog button span{display:block;margin-top:3px;color:#626d80;font-size:12px}
        #baixa-code-choice-dialog .baixa-cancel{margin-top:16px;text-align:center;border-radius:99px;color:#a02d2d;font-weight:700}
      `;
      const overlay = document.createElement("div");
      overlay.id = "baixa-code-choice-overlay";
      overlay.innerHTML = `
        <section id="baixa-code-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="baixa-code-choice-title">
          <h2 id="baixa-code-choice-title">Confirme o código de baixa</h2>
          <p>Confira os dados coletados e selecione o código que deve ser usado. Sua escolha será guardada neste computador para esta combinação.</p>
          <dl class="baixa-case-fields">
            <dt>Tipo de Abertura</dt><dd data-case-field="tipoAbertura"></dd>
            <dt>Procedência</dt><dd data-case-field="procedencia"></dd>
            <dt>Cliente</dt><dd data-case-field="cliente"></dd>
            <dt>Tipo de Incidência</dt><dd data-case-field="tipoIncidencia"></dd>
            <dt>Intragov</dt><dd data-case-field="intragov"></dd>
            <dt>Serviço Afetado</dt><dd data-case-field="servicoAfetado"></dd>
          </dl>
          <div class="baixa-choice-list">
            <button type="button" data-code="57033"><strong>57033</strong><span>Tipo de Incidência DDR</span></button>
            <button type="button" data-code="6Y200"><strong>6Y200</strong><span>Intragov marcado</span></button>
            <button type="button" data-code="2A082"><strong>2A082</strong><span>Repetido + Proativo</span></button>
            <button type="button" data-code="2A011"><strong>2A011</strong><span>Inicial + Preventivo/Reativo/Proativo ou Repetido + Reativo</span></button>
          </div>
          <button type="button" class="baixa-cancel" data-cancel>Cancelar execução</button>
        </section>`;
      const intragovValue = eBooleanoSim(data.intragov) ? "Marcada (Sim)"
        : eBooleanoNao(data.intragov) ? "Desmarcada (Não)" : "Não identificado";
      const caseFields = {
        tipoAbertura: data.tipoAbertura || "Não identificado",
        procedencia: data.procedencia || "Não identificada",
        cliente: data.cliente || "Não identificado",
        tipoIncidencia: data.tipoIncidencia || "Não identificada",
        intragov: intragovValue,
        servicoAfetado: data.servicoAfetado || "Não identificado"
      };
      for (const [key, value] of Object.entries(caseFields)) {
        overlay.querySelector(`[data-case-field="${key}"]`).textContent = value;
      }
      document.head.append(style);
      document.body.append(overlay);
      const list = overlay.querySelector(".baixa-choice-list");
      const cancelButton = overlay.querySelector("[data-cancel]");
      const stopTimer = setInterval(() => {
        if (shouldStop()) finish(new Error("Automação interrompida pelo usuário."));
      }, 200);
      const onKeyDown = event => {
        if (event.key === "Escape") finish(new Error("Seleção de código cancelada; nenhuma ação adicional será iniciada."));
      };
      let settled = false;
      const cleanup = () => {
        clearInterval(stopTimer);
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
        style.remove();
      };
      const finish = (error, code = "") => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(code);
      };
      list.addEventListener("click", event => {
        const button = event.target.closest("button[data-code]");
        if (button) finish(null, button.dataset.code);
      });
      cancelButton.addEventListener("click", () => finish(new Error("Seleção de código cancelada; nenhuma ação adicional será iniciada.")));
      document.addEventListener("keydown", onKeyDown, true);
      list.querySelector("button")?.focus();
    });
  }

  function aplicarCodigoSelecionado(decision, data, code, source) {
    const sourceLabel = source === "aprendido" ? "reutilizado da escolha salva"
      : source === "regra de cliente" ? "definido automaticamente pela regra do cliente" : "confirmado pelo usuário";
    const incidence = norm(decision?.normalizedFields?.tipoIncidencia || data?.tipoIncidencia);
    const diagnostico = incidence === "ddr" ? "00000032 Testado OK" : "00000017 Testado OK";
    return {
      ...decision,
      codigoBaixa: code,
      diagnostico,
      allowed: true,
      motivo: `Código ${code} ${sourceLabel}.`,
      codeSelection: { source, codigoBaixa: code },
      validation: {
        ...decision.validation,
        allowed: true,
        status: source === "aprendido" ? "CÓDIGO APRENDIDO" : source === "regra de cliente" ? "REGRA AUTOMÁTICA DO CLIENTE" : "CÓDIGO CONFIRMADO PELO USUÁRIO",
        reason: `Código ${code} ${sourceLabel}.`
      }
    };
  }

  async function escolherCodigoParaExecucaoAutomatica(data, decision, shouldStop = () => false) {
    const automaticCode = BaixaRules.codigoAutomaticoParaCliente(data.cliente);
    if (automaticCode) {
      if (!decision.allowed) return { decision, code: automaticCode };
      return { decision: aplicarCodigoSelecionado(decision, data, automaticCode, "regra de cliente"), code: automaticCode };
    }

    if (decision.allowed && BaixaRules.CODES.includes(decision.codigoBaixa)) {
      return { decision, code: "", source: "regras locais" };
    }

    const learnedCode = BaixaRules.CODES.includes(decision.learnedCode?.codigoBaixa)
      ? decision.learnedCode.codigoBaixa : "";
    const selectedCode = learnedCode || await pedirCodigoBaixa(data, shouldStop);
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    const response = await enviarMensagemRuntime({
      type: "SAVE_CODE_LEARNING", runId: currentRunId, caseData: data, codigoBaixa: selectedCode,
      source: learnedCode ? "aprendido" : "usuário"
    });
    const source = learnedCode ? "aprendido" : "usuário";
    return { decision: aplicarCodigoSelecionado(decision, data, selectedCode, source), code: selectedCode, learning: response.learning };
  }

  function criarRegistro(data, decision, resultado, error = "") {
    return {
      numeroChamado: data.numeroChamado || "",
      tipoAbertura: data.tipoAbertura || "",
      procedencia: data.procedencia || "",
      tipoIncidencia: data.tipoIncidencia || "",
      cliente: data.cliente || "",
      intragov: data.intragov ?? "",
      servicoAfetado: data.servicoAfetado || "",
      dataObjetivo: data.dataObjetivo || "",
      dataReparo: data.dataReparo || "",
      paradaRelogio: data.paradaRelogio ?? "",
      acionamento: data.codigoAcionamento || (data.acionamentoProcessado6Z036 ? "6Z036 (tratado)" : "Nenhum identificado"),
      codigoBaixa: decision?.codigoBaixa || "",
      origemCodigoBaixa: decision?.codeSelection?.source || "regras locais",
      diagnostico: decision?.diagnostico || "",
      resultado: resultado,
      iaUtilizada: decision?.ai?.available ? decision.ai.provider : "Motor determinístico (fallback)",
      confianca: decision?.ai?.confidence ?? "",
      motivo: decision?.allowed ? decision.motivo : decision?.validation?.reason || decision?.motivo || "",
      erro: error
    };
  }

  async function executarAnalise(runId, requestedMode = "") {
    if (processing) {
      if (runId && runId !== currentRunId) {
        stopRequested = true;
        queuedRunId = runId;
        queuedMode = requestedMode;
        notify("Substituindo a execução anterior pela nova solicitação…");
      }
      return;
    }
    processing = true;
    currentRunId = runId;
    stopRequested = false;
    let data = {};
    let decision = null;
    let mainClosureSubmitted = false;
    let finalRunStatus = "success";
    let finalRunMessage = "";
    let currentStage = "Leitura inicial do chamado";
    let stageStartedAt = Date.now();
    const stageTimings = [];
    const setStage = stage => {
      const now = Date.now();
      stageTimings.push({ stage: currentStage, durationMs: Math.max(0, now - stageStartedAt) });
      currentStage = stage;
      stageStartedAt = now;
    };
    const currentTimings = () => [
      ...stageTimings,
      { stage: currentStage, durationMs: Math.max(0, Date.now() - stageStartedAt) }
    ];
    const makeTimedRecord = (...args) => ({ ...criarRegistro(...args), temposEtapas: currentTimings() });
    notify("Iniciando leitura rápida das abas do chamado…");
    try {
      data = await BaixaNavigation.lerCaso(stopCheck, tab => notify(`Leitura inicial: aguardando a aba ${tab}…`), partial => {
        void enviarMensagemRuntime({ type: "PREFETCH_ANALYSIS", runId: currentRunId, caseData: partial }).catch(() => undefined);
      });
      if (stopCheck()) throw new Error("Automação interrompida pelo usuário.");
      adicionarPrevisaoOperacional(data);
      setStage("Classificação e validação das regras");
      notify("Campos lidos. Enviando apenas os campos de classificação à IA e às regras locais…");
      decision = await solicitarDecisao(data, requestedMode);
      if (stopCheck()) throw new Error("Automação interrompida pelo usuário.");
      if (decision.mode === "automatic") {
        const selection = await escolherCodigoParaExecucaoAutomatica(data, decision, stopCheck);
        decision = selection.decision;
      }
      const allowed = Boolean(decision.allowed);
      const validationText = decision.validation.reason || decision.motivo || "Classificação aprovada pelas regras locais.";
      decision = {
        ...decision,
        allowed,
        validation: {
          ...decision.validation,
          allowed,
          status: allowed ? decision.validation.status : "BLOQUEADO",
          reason: validationText
        }
      };
      const summary = [
        exibirDados(data),
        "",
        `Código de baixa previsto: ${decision.codigoBaixa || "não determinado — dados de classificação insuficientes"}`,
        `Diagnóstico previsto: ${decision.diagnostico || "não determinado — incidência/regra não identificada"}`,
        `Origem/regra do código: ${decision.motivo || decision.validation.reason}`,
        `Motivo: ${decision.motivo || decision.validation.reason}`,
        `Confiança da IA: ${decision.ai?.confidence == null ? "indisponível (fallback)" : `${Math.round(decision.ai.confidence * 100)}%`}`,
        `IA utilizada: ${decision.ai?.available ? decision.ai.provider : "Não — motor determinístico"}`,
        `Validação: ${allowed ? decision.validation.status : "BLOQUEADO — " + validationText}`
      ].join("\n");
      notify(summary, allowed ? "success" : "error");

      if (!allowed) {
        await enviarFinal(makeTimedRecord(data, decision, decision.validation.status === "DIVERGÊNCIA IA × REGRAS" ? "DIVERGÊNCIA IA × REGRAS" : "BAIXA NÃO REALIZADA", validationText));
        return;
      }
      if (decision.mode !== "automatic") {
        await enviarFinal(makeTimedRecord(data, decision, "ANÁLISE CONCLUÍDA"));
        notify(`${summary}\n\nModo análise: a leitura terminou; nenhuma baixa foi executada. Para prosseguir com as etapas automáticas, selecione “Modo automático” no popup.`, "success");
        return;
      }

      if (stopCheck()) throw new Error("Automação interrompida.");
      setStage("Validação das datas e do SLA");
      const dateValidation = BaixaDateHandler.validarDatas(data);
      if (!dateValidation.valid) throw new Error(dateValidation.reason);
      data.dataReparo = dateValidation.repairValue;
      const dateWarnings = dateValidation.warnings || [];
      const validationSummary = dateWarnings.length
        ? `Parada de relógio priorizada; aviso(s) não bloqueante(s): ${dateWarnings.join(" ")}`
        : "Validação de Data Objetivo, pausa de relógio e SLA de 4 horas aprovada.";
      notify(`Data de Reparo para Encerramento calculada: ${data.dataReparo}${dateValidation.pauseEnd ? " (Fim da parada + 1 minuto)" : " (Data Criação + 1 hora)"}${data.dataReparoOriginal ? "; sem copiar a Data de Reparo original" : ""}. ${validationSummary}`);

      if (stopCheck()) throw new Error("Automação interrompida pelo usuário.");
      setStage("Bloquear e Baixar");
      notify("Executando sequência solicitada: Bloquear → tratar acionamento ativo, se houver → Baixar…");
      await BaixaHandler.iniciarEncerramentoPrincipal(stopCheck, async () => {
        setStage("Tratamento do acionamento ativo");
        const actionClosed = await BaixaHandler.fecharAcionamentoAtivo(decision.codigoBaixa, stopCheck);
        if (data.acionamento === "Sim" && !actionClosed) {
          throw new Error("O acionamento estava ativo na leitura inicial, mas não foi possível localizar sua linha ativa após bloquear o chamado.");
        }
        if (actionClosed) notify("Acionamento ativo gravado com o código de baixa do chamado. Continuando a baixa principal…");
        setStage("Baixa principal - localizar botão Baixar");
      });
      if (stopCheck()) throw new Error("Automação interrompida pelo usuário.");
      setStage("Preenchimento do Diagnóstico");
      notify("Bloquear e clique no botão Baixar concluídos. Abrindo Definição para preencher e selecionar o Diagnóstico pela lupa…");
      const diagnosisSkipped = await BaixaFormHandler.preencherDiagnostico(decision, stopCheck);
      if (diagnosisSkipped.length) notify(`Diagnóstico não editável; mantendo valor atual: ${diagnosisSkipped.join(", ")}.`);
      if (stopCheck()) throw new Error("Automação interrompida pelo usuário.");
      setStage("Preenchimento do Encerramento");
      notify("Diagnóstico selecionado. Seguindo para Encerramento sem repetir a ação Baixar.");
      const skippedFields = await BaixaFormHandler.preencherEncerramento(decision, eBooleanoSim(data.intragov), data.dataReparo, stopCheck, true);
      if (skippedFields.length) notify(`Tentativa continuará; campos não editáveis ou sem dado foram deixados como estão: ${skippedFields.join(", ")}.`);
      if (stopCheck()) throw new Error("Automação interrompida pelo usuário.");

      setStage("Pré-validação da Certificação");
      notify("Encerramento preenchido. Verificando a aba Certificação antes de clicar em Gravar Baixa…");
      const certificationPrecheck = await BaixaFormHandler.prepararCertificacaoParaGravar(stopCheck);
      notify(resumoCertificacao(certificationPrecheck) + " Voltando para Encerramento…");
      if (stopCheck()) throw new Error("Automação interrompida pelo usuário.");
      setStage("Gravar Baixa");
      notify("Certificação preenchida e confirmada. Agora sim, acionando Gravar Baixa…");
      let saveResult = await BaixaHandler.gravarEncerramentoPrincipal(stopCheck);

      if (saveResult?.validationError) {
        setStage("Correção da Certificação após Validation Error");
        notify("Gravar Baixa encontrou campos obrigatórios na Certificação. Fechando o aviso pelo X (ou aproveitando o fechamento manual) e abrindo a aba Certificação…");
        const validationPopupClosed = await BaixaHandler.fecharJanelaErroValidacao(stopCheck);
        if (validationPopupClosed) {
          notify("Aviso de validação fechado. Abrindo Certificação para corrigir somente os status pendentes…");
        } else if (saveResult.popupCloseObserved) {
          notify("O aviso de validação já foi fechado. Continuando automaticamente para a aba Certificação…");
        } else {
          notify("O SIGITM não expôs um popup identificável. A extensão seguirá diretamente para Certificação…");
        }
        const certification = await BaixaFormHandler.corrigirValidacaoCertificacao(stopCheck);
        notify(`${resumoCertificacao(certification)} Tentando Gravar Baixa novamente…`);
        setStage("Nova tentativa de Gravar Baixa");
        saveResult = await BaixaHandler.gravarEncerramentoPrincipal(stopCheck);
        if (saveResult?.validationError) {
          throw new Error("O SIGITM ainda retornou 'Validation Error: Value is required.' após corrigir a aba Certificação.");
        }
      }

      mainClosureSubmitted = true;
      setStage("Baixa gravada");
      notify("Gravar Baixa aceito sem erros.");
      const resultLabel = "GRAVAR BAIXA ACIONADO";
      await enviarFinal(makeTimedRecord(data, decision, resultLabel));
      notify("Gravar Baixa acionado automaticamente após o preenchimento e validação dos campos.", "success");
    } catch (error) {
      const stopped = stopCheck() || /interrompida pelo usuário/i.test(error.message);
      const status = stopped ? "PROCESSAMENTO INTERROMPIDO" : mainClosureSubmitted ? "BAIXA INCERTA - CONFERIR" : "BAIXA NÃO REALIZADA";
      finalRunStatus = stopped ? "info" : "error";
      const errorMessage = String(error.message || error || "Erro desconhecido no SIGITM.");
      const failureDetails = `Etapa: ${currentStage}\n${errorMessage}`;
      finalRunMessage = failureDetails;
      const diagnosticLog = {
        stage: currentStage,
        message: errorMessage,
        stack: String(error.stack || "").slice(0, 5000)
      };
      console.error(`[Baixador Automático] Falha no fluxo SIGITM\n${JSON.stringify(diagnosticLog, null, 2)}`);
      const replacementPending = stopped && queuedRunId && queuedRunId !== currentRunId;
      if (!replacementPending) queuedRunId = "";
      if (replacementPending) {
        notify("Execução anterior cancelada; iniciando a solicitação mais recente…");
      } else {
        await enviarFinal(makeTimedRecord(data, decision, status, failureDetails));
        notify(`${status}\n${failureDetails}\nNenhuma ação adicional será iniciada.`, "error");
      }
    } finally {
      const finalTimings = currentTimings();
      const totalDurationMs = finalTimings.reduce((total, item) => total + item.durationMs, 0);
      console.info("[Baixador Automático] Tempos por etapa", JSON.stringify({ runId: currentRunId, totalDurationMs, stages: finalTimings }));
      processing = false;
      const finishedRunId = currentRunId;
      try {
        chrome.runtime.sendMessage({
          type: "RUN_FINISHED", runId: finishedRunId,
          finalStatus: finalRunStatus, finalMessage: finalRunMessage
        }, () => { try { void chrome.runtime.lastError; } catch { } });
      } catch { }
      currentRunId = "";
      if (queuedRunId) {
        const nextRunId = queuedRunId;
        const nextMode = queuedMode;
        queuedRunId = "";
        queuedMode = "";
        void executarAnalise(nextRunId, nextMode);
      }
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "GET_BAIXADOR_CONTENT_STATUS_V26") {
      sendResponse({ ok: true, protocol: CONTENT_PROTOCOL });
      return false;
    }
    if (message?.type === "START_ANALYSIS_V9" && message.protocol === CONTENT_PROTOCOL && message.runId) {
      void executarAnalise(message.runId, message.mode || "");
      sendResponse({ ok: true, started: true, runId: message.runId });
      return false;
    }
    if (message?.type === "STOP_AUTOMATION") {
      if (message.runId && message.runId !== currentRunId) {
        if (message.runId === queuedRunId) {
          queuedRunId = "";
          queuedMode = "";
        }
        return false;
      }
      stopRequested = true;
      notify("PARAR AUTOMAÇÃO — processamento interrompido. O resultado atual foi mantido.", "error");
      return false;
    }
    return false;
  });
})();
