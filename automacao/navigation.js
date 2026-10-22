(function (root) {
  "use strict";
  let lastActivatedTabName = "";

  function documentos() {
    const resultado = [];
    const queue = [document];
    const seen = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      resultado.push(current);
      for (const frame of current.querySelectorAll("iframe, frame")) {
        try { if (frame.contentDocument) queue.push(frame.contentDocument); } catch { }
      }
    }
    return resultado;
  }

  function visivel(element) {
    if (!element || element.hidden) return false;
    const style = getComputedStyleSafe(element);
    if (style && (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0)) return false;
    if (style?.pointerEvents === "none" && (style.position === "fixed" || style.position === "absolute")) return false;
    const rects = element.getClientRects?.();
    if (rects?.length) {
      const rect = element.getBoundingClientRect?.();
      if (rect && rect.width === 0 && rect.height === 0) return false;
      return true;
    }
    return Boolean(element.offsetParent);
  }

  function normalizar(value) { return root.BaixaHelpers.normalizarTexto(value); }
  function textoDe(element) { return String(element?.innerText || element?.textContent || "").trim(); }

  function indicadoresCarregamento() {
    const selectors = "[aria-busy='true'], [data-loading='true'], [role='progressbar'], .loading, .loader, .spinner, .blockUI, .block-ui, .ui-blockui, .ajax-loader, .rf-st-start, [id*='loading' i], [class*='loading' i], [id*='carregando' i], [class*='carregando' i], [id*='spinner' i], [class*='spinner' i], [id*='processing' i], [class*='processing' i], [id*='processando' i], [class*='processando' i], img[src*='loading' i], img[src*='spinner' i], img[src*='processando' i]";
    return documentos().flatMap(doc => [...doc.querySelectorAll(selectors)])
      .filter(eIndicadorCarregamentoBloqueante);
  }

  function eIndicadorCarregamentoBloqueante(element) {
    if (!visivel(element)) return false;
    const style = getComputedStyleSafe(element);
    const rect = element.getBoundingClientRect?.();
    if (!style || !rect) return false;
    const width = Math.max(0, Number(rect.width) || 0);
    const height = Math.max(0, Number(rect.height) || 0);
    const area = width * height;
    const metadata = normalizar([
      element.id, element.className, element.getAttribute?.("src"), element.getAttribute?.("alt"),
      element.getAttribute?.("aria-label")
    ].filter(Boolean).join(" "));
    const explicitBlock = element.matches?.("[aria-busy='true'], [data-loading='true'], .blockUI, .block-ui, .ui-blockui");
    if (explicitBlock) return true;
    return /loading|loader|spinner|aguarde|carregando|processing|processando/.test(metadata);
  }

  function getComputedStyleSafe(element) {
    try { return element.ownerDocument.defaultView.getComputedStyle(element); }
    catch { return null; }
  }

  function aguardarMudancaDom(timeout = 250, shouldStop = () => false) {
    return new Promise((resolve, reject) => {
      if (shouldStop()) return reject(new Error("Automação interrompida pelo usuário."));
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        observer?.disconnect();
        clearTimeout(timer);
        resolve(value);
      };
      const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(() => finish(true)) : null;
      for (const doc of documentos()) {
        if (doc.documentElement) observer?.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      }
      const timer = setTimeout(() => finish(false), timeout);
      if (shouldStop()) {
        settled = true;
        observer?.disconnect(); clearTimeout(timer);
        reject(new Error("Automação interrompida pelo usuário."));
      }
    });
  }

  async function aguardarFimCarregamento(shouldStop = () => false, hardDeadline = Infinity) {
    while (true) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      if (!indicadoresCarregamento().length) return true;
      if (Date.now() >= hardDeadline) throw new Error("A tela SIGITM continua carregando; ação automatizada bloqueada.");
      await aguardarMudancaDom(750, shouldStop);
    }
  }

  function valorDiagnostico(value, limit = 90) {
    return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, limit);
  }

  function descreverControle(control) {
    if (!control) return "ausente";
    const tag = String(control.tagName || "desconhecido").toUpperCase();
    const type = String(control.type || control.getAttribute?.("type") || "").toLowerCase();
    const buttonLike = ["BUTTON", "A"].includes(tag) || control.getAttribute?.("role") === "button" ||
      (tag === "INPUT" && ["button", "submit", "image", "reset"].includes(type));
    const labels = [control.getAttribute?.("aria-label"), control.getAttribute?.("title"), control.getAttribute?.("alt")];
    if (buttonLike) labels.push(textoDe(control), control.value);
    const label = valorDiagnostico([...new Set(labels.filter(Boolean).map(value => valorDiagnostico(value)))].join(" | "), 120);
    let visibleState = "desconhecido";
    try { visibleState = visivel(control) ? "sim" : "não"; } catch { }
    const connected = control.isConnected === false ? "não" : control.isConnected === true ? "sim" : "desconhecido";
    const disabled = control.disabled === true ? "sim" : control.disabled === false ? "não" : "desconhecido";
    const ariaDisabled = valorDiagnostico(control.getAttribute?.("aria-disabled") || "não informado", 20);
    return `tag=${tag}; id=${valorDiagnostico(control.id || "(vazio)", 80)}; name=${valorDiagnostico(control.name || "(vazio)", 80)}; tipo=${valorDiagnostico(type || "(vazio)", 24)}; rótulo=${label ? `"${label}"` : "(vazio)"}; conectado=${connected}; visível=${visibleState}; disabled=${disabled}; aria-disabled=${ariaDisabled}`;
  }

  function descreverIndicadoresCarregamento(indicators) {
    return indicators.slice(0, 3).map(element => {
      const rect = element.getBoundingClientRect?.();
      const identity = [element.tagName, element.id, typeof element.className === "string" ? element.className : ""]
        .filter(Boolean).map(value => valorDiagnostico(value, 60)).join("#");
      const size = rect ? `${Math.round(Number(rect.width) || 0)}x${Math.round(Number(rect.height) || 0)}` : "tamanho desconhecido";
      return `${identity || "indicador sem identificador"} (${size})`;
    }).join(", ");
  }

  function garantirAcaoPronta(control, stage = "checagem pré-clique") {
    const loaders = indicadoresCarregamento();
    const details = `etapa=${valorDiagnostico(stage, 50)}; controle{${descreverControle(control)}}`;
    if (loaders.length) {
      throw new Error(`A tela SIGITM está carregando; ação automatizada bloqueada. Diagnóstico: ${details}; indicadores=${loaders.length} [${descreverIndicadoresCarregamento(loaders)}].`);
    }
    const reasons = [];
    if (!control) reasons.push("referência ausente");
    else {
      if (control.isConnected === false) reasons.push("elemento removido do DOM");
      try { if (!visivel(control)) reasons.push("elemento invisível"); }
      catch { reasons.push("não foi possível verificar visibilidade"); }
      if (control.disabled) reasons.push("controle desabilitado");
      if (control.getAttribute?.("aria-disabled") === "true") reasons.push("aria-disabled=true");
    }
    if (reasons.length) {
      throw new Error(`O controle necessário não está disponível para ação; clique bloqueado. Diagnóstico: ${details}; motivo=${reasons.join(", ")}.`);
    }
  }

  async function clicarControle(control, shouldStop = () => false, beforeClick = null, refreshControl = null) {
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    const hardDeadline = Date.now() + 60000;
    let deadline = Date.now() + 2500;
    let lastError = null;
    let activeControl = control;
    let attempts = 0;
    let refreshFailure = "";
    while (Date.now() < deadline && Date.now() < hardDeadline) {
      attempts++;
      try {
        if (!activeControl || activeControl.isConnected === false || !visivel(activeControl)) {
          if (typeof refreshControl === "function") {
            activeControl = await refreshControl();
          }
        }
        await api.aguardarFimCarregamento(shouldStop, hardDeadline);
        deadline = Math.max(deadline, Date.now() + 2500);
        garantirAcaoPronta(activeControl, "imediatamente antes do clique");
        if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
        beforeClick?.(activeControl);
        garantirAcaoPronta(activeControl, "após preparação do clique");
        activeControl.click();
        return true;
      } catch (error) {
        lastError = error;
        if (!/bloqueado|não está disponível|carregando|interrompida/i.test(error.message || "")) throw error;
        if (/carregando/i.test(error.message || "")) deadline = Math.max(deadline, Date.now() + 2500);
        if (typeof refreshControl === "function") {
          try { activeControl = await refreshControl(); }
          catch (refreshError) { refreshFailure = valorDiagnostico(refreshError?.message || refreshError, 180); }
        }
        await api.aguardarMudancaDom(250, shouldStop);
      }
    }
    const reason = lastError?.message || "O controle necessário não está disponível para ação; clique bloqueado.";
    throw new Error(`${reason} Diagnóstico da tentativa: tentativas=${attempts}; controle final{${descreverControle(activeControl)}}${refreshFailure ? `; atualização do controle falhou: ${refreshFailure}` : ""}.`);
  }

  function controlesPara(aliases, editableOnly = false) {
    const wanted = new Set(aliases.map(normalizar));
    const found = new Set();
    for (const doc of documentos()) {
      for (const control of doc.querySelectorAll("input, select, textarea")) {
        if (!visivel(control) || control.type === "hidden") continue;
        const metadata = [control.id, control.name, control.title, control.getAttribute("aria-label"),
          ...(control.labels ? [...control.labels].map(textoDe) : [])].map(normalizar);
        if (metadata.some(value => wanted.has(value))) found.add(control);
      }
      for (const label of doc.querySelectorAll("label, th, td, span, div")) {
        if (!visivel(label) || label.children.length > 4 || textoDe(label).length > 90 || !wanted.has(normalizar(textoDe(label).replace(/:$/, "")))) continue;
        if (label.tagName === "LABEL" && label.htmlFor) {
          const associated = doc.getElementById(label.htmlFor);
          if (associated && visivel(associated) && associated.type !== "hidden") found.add(associated);
        }
        const cell = label.matches("td, th") ? label : label.closest("td, th");
        if (cell) {
          for (let sibling = cell.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
            const controls = [...sibling.querySelectorAll("input, select, textarea")].filter(item => visivel(item) && item.type !== "hidden");
            if (controls.length) { controls.forEach(item => found.add(item)); break; }
          }
        }
        const row = label.closest("tr, [role='row'], .form-group, fieldset") || label.parentElement;
        const candidates = [...(row?.querySelectorAll("input, select, textarea") || [])].filter(item => visivel(item) && item.type !== "hidden");
        if (candidates.length === 1) found.add(candidates[0]);
      }
    }
    const controls = [...found];
    return editableOnly ? controls.filter(control => !control.disabled && !control.readOnly) : controls;
  }

  function valorDe(control) {
    if (!control || !visivel(control)) return "";
    if (control.type === "checkbox" || control.type === "radio") return control.checked ? "Sim" : "Não";
    if (control.tagName === "SELECT") return control.selectedOptions?.[0]?.textContent?.trim() || control.value || "";
    return String(control.value ?? "").trim();
  }

  function lerCampo(aliases) {
    const controls = controlesPara(aliases);
    if (controls.length === 1) return valorDe(controls[0]);
    if (controls.length > 1) return "";
    const wanted = new Set(aliases.map(normalizar));
    for (const doc of documentos()) {
      for (const node of doc.querySelectorAll("label, th, td, span, div")) {
        if (!visivel(node) || node.children.length > 3) continue;
        const lines = textoDe(node).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const inline = lines[0]?.match(/^([^:]{2,80}):\s*(.+)$/);
        if (inline && wanted.has(normalizar(inline[1]))) return inline[2].trim();
        if (lines.length > 1 && wanted.has(normalizar(lines[0].replace(/:$/, "")))) return lines[1];
      }
    }
    return "";
  }

  function lerIntragov() {
    for (const doc of documentos()) {
      const checkboxes = [...doc.querySelectorAll("input[type='checkbox']")]
        .filter(visivel);
      for (const control of checkboxes) {
        const metadata = normalizar([
          control.id, control.name, control.title, control.getAttribute("aria-label"),
          ...(control.labels ? [...control.labels].map(textoDe) : [])
        ].filter(Boolean).join(" "));
        if (metadata.includes("intragov")) return control.checked ? "Sim" : "Não";
      }
      for (const label of doc.querySelectorAll("label, th, td, span, div")) {
        if (!visivel(label) || normalizar(textoDe(label).replace(/:$/, "")) !== "intragov") continue;
        const labelRect = label.getBoundingClientRect?.();
        if (!labelRect) continue;
        const nearby = checkboxes.map(control => ({ control, rect: control.getBoundingClientRect?.() }))
          .filter(item => item.rect && item.rect.left >= labelRect.right - 12 &&
            Math.abs((item.rect.top + item.rect.bottom) / 2 - (labelRect.top + labelRect.bottom) / 2) <= 34)
          .sort((first, second) => first.rect.left - second.rect.left);
        if (nearby.length) return nearby[0].control.checked ? "Sim" : "Não";
      }
    }
    return "Não";
  }

  function instanteDataRelogio(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/) ||
      text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const br = text.includes("/");
    let year = Number(br ? match[3] : match[1]);
    if (br && year < 100) year += 2000;
    const month = Number(match[2]);
    const day = Number(br ? match[1] : match[3]);
    const hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);
    const second = Number(match[6] || 0);
    const date = new Date(year, month - 1, day, hour, minute, second);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day &&
      date.getHours() === hour && date.getMinutes() === minute && date.getSeconds() === second ? date.getTime() : null;
  }

  function retratoTabelaParadaRelogio() {
    const values = [];
    let foundTable = false;
    let tableLoading = false;
    let malformedRows = false;
    for (const doc of documentos()) {
      for (const table of doc.querySelectorAll("table[id*='listParadaRelogio']")) {
        if (!visivel(table)) continue;
        foundTable = true;
        const loadingControls = [...table.querySelectorAll("[aria-busy='true'], [data-loading='true'], [role='progressbar'], [id*='status.start' i], [id*='loading' i], [class*='loading' i], [class*='carregando' i]")]
          .some(control => visivel(control));
        if (loadingControls) tableLoading = true;
        const rows = [...table.querySelectorAll("tr")];
        const headerIndex = rows.findIndex(row => [...row.querySelectorAll("th, td")]
          .some(cell => normalizar(textoDe(cell)) === "fim"));
        if (headerIndex < 0) { malformedRows = true; continue; }
        const headers = [...rows[headerIndex].querySelectorAll("th, td")];
        const endIndex = headers.findIndex(cell => normalizar(textoDe(cell)) === "fim");
        const startIndex = headers.findIndex(cell => normalizar(textoDe(cell)) === "inicio");
        if (endIndex < 0 || startIndex < 0) { malformedRows = true; continue; }
        for (const row of rows.slice(headerIndex + 1)) {
          const rowMetadata = normalizar([row.className, row.id].filter(Boolean).join(" "));
          if (/footer|datascr|dscr|pagination|paginacao/.test(rowMetadata) ||
            row.querySelector?.("[class*='datascr' i], [class*='dscr' i], [class*='pagination' i], [class*='paginacao' i]")) continue;
          const cells = [...row.querySelectorAll("td")];
          if (cells.length <= Math.max(startIndex, endIndex)) continue;
          const start = startIndex >= 0 ? textoDe(cells[startIndex]) : "";
          const end = endIndex >= 0 ? textoDe(cells[endIndex]) : "";
          const startTimestamp = instanteDataRelogio(start);
          const endTimestamp = instanteDataRelogio(end);
          if (startTimestamp !== null || endTimestamp !== null) {
            values.push({ start, end, startTimestamp, endTimestamp, timestamp: endTimestamp ?? startTimestamp });
          } else if (start || end) {
            malformedRows = true;
          }
        }
      }
    }
    const latest = values.sort((first, second) => second.timestamp - first.timestamp)[0];
    if (tableLoading) return { start: "", end: "", detected: false, status: "loading" };
    if (latest) return { start: latest.start || "", end: latest.end || "", detected: true, status: "found" };
    if (!foundTable) return { start: "", end: "", detected: false, status: "absent" };
    if (malformedRows) return { start: "", end: "", detected: false, status: "inconclusive" };
    return { start: "", end: "", detected: false, status: "empty" };
  }

  async function lerDadosParadaRelogio(shouldStop = () => false, timeout = 1000) {
    const deadline = Date.now() + timeout;
    let stableEmptySnapshots = 0;
    while (Date.now() < deadline) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      const snapshot = retratoTabelaParadaRelogio();
      if (snapshot.status === "found") return snapshot;
      if (snapshot.status === "empty") {
        stableEmptySnapshots++;
        if (stableEmptySnapshots >= 2) return snapshot;
      } else {
        stableEmptySnapshots = 0;
      }
      await aguardarMudancaDom(Math.min(350, Math.max(1, deadline - Date.now())), shouldStop);
    }
    const lastSnapshot = retratoTabelaParadaRelogio();
    if (["empty", "absent", "loading"].includes(lastSnapshot.status)) {
      return { ...lastSnapshot, status: "empty" };
    }
    return { ...lastSnapshot, status: "inconclusive" };
  }

  function aplicarDadosParadaRelogio(data, clockPause) {
    data.dataInicioParadaRelogio = clockPause.start || data.dataParadaRelogio || "";
    data.dataFimParadaRelogio = clockPause.end || "";
    const currentState = normalizar(data.paradaRelogio);
    if (clockPause.detected) {
      if (!["sim", "nao"].includes(currentState)) data.paradaRelogio = "Sim";
      return "";
    }
    if (currentState === "sim") {
      return "Parada de Relógio está marcada como Sim, mas não foi possível identificar o horário de fim; baixa bloqueada por segurança.";
    }
    data.paradaRelogio = "Não";
    return "";
  }

  function resolverEstadoAcionamento(foundAction, rowText) {
    if (!foundAction) return { acionamento: "Não", codigoAcionamento: "" };
    const status = normalizar(rowText);
    if (/\bativo\b|\bativa\b|\baberto\b/.test(status)) return { acionamento: "Sim", codigoAcionamento: /\b6z036\b/.test(status) ? "6Z036" : "" };
    if (/\bbaixado\b|\bfechado\b|\bencerrado\b|\binativo\b/.test(status)) return { acionamento: "Não", codigoAcionamento: "" };
    return { acionamento: "", codigoAcionamento: "" };
  }

  function encontrarLinhasAcionamentoAtivo() {
    const activeStatuses = new Set(["ativo", "ativa", "aberto", "aberta"]);
    const found = [];
    for (const doc of documentos()) {
      for (const table of doc.querySelectorAll("table")) {
        const rows = [...table.querySelectorAll("tr")];
        const headerIndex = rows.findIndex(row => {
          const cells = [...row.querySelectorAll("th, td")];
          return cells.some(cell => normalizar(textoDe(cell)) === "status") &&
            cells.some(cell => normalizar(textoDe(cell)) === "codigo");
        });
        if (headerIndex < 0) continue;
        const headers = [...rows[headerIndex].querySelectorAll("th, td")];
        const statusIndex = headers.findIndex(cell => normalizar(textoDe(cell)) === "status");
        for (const row of rows.slice(headerIndex + 1)) {
          if (!visivel(row)) continue;
          const statusCell = [...row.querySelectorAll("th, td")][statusIndex];
          if (statusCell && activeStatuses.has(normalizar(textoDe(statusCell)))) found.push(row);
        }
      }
    }
    return [...new Set(found)];
  }

  function encontrarCandidatasAba(name) {
    const target = normalizar(name);
    const matches = [];
    for (const doc of documentos()) {
      const actionableSelector = "a, button, [role='tab'], input[type='button'], input[type='submit'], [onclick], [tabindex]";
      const actionable = [...doc.querySelectorAll(actionableSelector)].filter(tab => {
        if (/^(TABLE|TBODY|THEAD|TR)$/.test(String(tab.tagName || "").toUpperCase())) return false;
        if (!visivel(tab) || tab.disabled || tab.getAttribute("aria-disabled") === "true") return false;
        return normalizar(textoDe(tab) || tab.value || tab.getAttribute("aria-label")) === target;
      });
      if (actionable.length) {
        matches.push(...actionable);
        continue;
      }

      for (const label of doc.querySelectorAll("td, th, li, span, div")) {
        if (!visivel(label) || normalizar(textoDe(label)) !== target) continue;
        const cell = label.matches("td, th") ? label : label.closest("td, th");
        const tabContainer = label.closest("[role='tab'], [class*='tab' i], [id*='tab' i], [class*='aba' i], [id*='aba' i], li");
        const tableWrapper = tabContainer?.tagName === "TABLE";
        const candidate = cell || (tableWrapper ? label : tabContainer && normalizar(textoDe(tabContainer)) === target ? tabContainer : label);
        if (visivel(candidate) && !candidate.disabled) matches.push(candidate);
      }
    }
    return [...new Set(matches)].filter(candidate => !matches.some(other =>
      other !== candidate && candidate.contains?.(other) && normalizar(textoDe(other)) === target));
  }

  function abaPareceAtiva(element) {
    if (!element) return false;
    const ariaSelected = String(element.getAttribute?.("aria-selected") || "").toLowerCase();
    if (ariaSelected === "true") return true;
    const metadata = normalizar([
      element.className,
      element.getAttribute?.("data-state"),
      element.getAttribute?.("data-active"),
      element.getAttribute?.("aria-current"),
      element.getAttribute?.("title")
    ].filter(Boolean).join(" "));
    return /(^| )(active|ativo|selected|selecionado|current|atual)( |$)/.test(metadata);
  }

  function abaPareceAtivaNaArvore(element) {
    let current = element;
    for (let depth = 0; current && depth < 4; depth++, current = current.parentElement) {
      if (abaPareceAtiva(current)) return true;
    }
    return false;
  }

  function selecionarPorDensidadeConjuntoAbas(name, candidates) {
    const others = ["Cliente", "Definição", "Data", "Acionamento", "Encerramento", "Certificação"]
      .filter(tabName => normalizar(tabName) !== normalizar(name))
      .map(tabName => ({ tabName, elements: encontrarCandidatasAba(tabName) }));
    const centerY = element => {
      const rect = element.getBoundingClientRect?.();
      return rect ? (rect.top + rect.bottom) / 2 : NaN;
    };
    const sameRow = candidates.filter(candidate => {
      const y = centerY(candidate);
      if (!Number.isFinite(y)) return false;
      return others.filter(item => item.elements.some(element => Math.abs(centerY(element) - y) <= 12)).length >= 3;
    });
    if (sameRow.length === 1) return sameRow[0];
    if (sameRow.length > 1) candidates = sameRow;
    const depthOf = candidate => {
      let current = candidate.parentElement;
      for (let depth = 1; current && depth <= 9; depth++, current = current.parentElement) {
        const found = others.filter(item => item.elements.some(element => current.contains(element)));
        if (found.length >= 3) return depth;
      }
      return Infinity;
    };
    const ranked = candidates.map(candidate => ({ candidate, depth: depthOf(candidate) }))
      .filter(item => Number.isFinite(item.depth)).sort((first, second) => first.depth - second.depth);
    if (!ranked.length || (ranked[1] && ranked[1].depth === ranked[0].depth)) return null;
    return ranked[0].candidate;
  }

  function selecionarCandidataAba(name, candidates, contextName = lastActivatedTabName) {
    if (candidates.length <= 1) return candidates[0] || null;
    const activeTarget = candidates.filter(abaPareceAtivaNaArvore);
    if (activeTarget.length === 1) return activeTarget[0];

    const knownNames = ["Cliente", "Definição", "Data", "Acionamento", "Encerramento", "Certificação"]
      .filter(tabName => normalizar(tabName) !== normalizar(name));
    const nearbyTabs = knownNames.flatMap(tabName => encontrarCandidatasAba(tabName).map(element => ({ tabName, element })));
    const activeTabs = nearbyTabs
      .filter(item => abaPareceAtivaNaArvore(item.element));
    const contextualTabs = activeTabs.length ? activeTabs
      : nearbyTabs.filter(item => normalizar(item.tabName) === normalizar(contextName));
    const knownTabs = contextualTabs;
    if (!knownTabs.length) return selecionarPorDensidadeConjuntoAbas(name, candidates);

    const ancestors = element => {
      const resultado = [];
      let current = element;
      for (let depth = 0; current && depth < 9; depth++, current = current.parentElement) resultado.push({ element: current, depth });
      return resultado;
    };
    const ranked = candidates.map(candidate => {
      const candidateAncestors = ancestors(candidate);
      let bestDistance = Infinity;
      let bestScope = null;
      for (const active of knownTabs) {
        const activeAncestors = ancestors(active.element);
        for (const first of candidateAncestors) {
          const second = activeAncestors.find(item => item.element === first.element);
          if (!second) continue;
          const distance = first.depth + second.depth;
          const metadata = normalizar([first.element.id, first.element.className, first.element.getAttribute?.("role")].filter(Boolean).join(" "));
          const isTabScope = /tab|aba|tabset|tablist/.test(metadata) ||
            first.element.tagName === "TABLE" || first.element.tagName === "TR" || first.element.tagName === "UL";
          if (isTabScope && distance < bestDistance) {
            bestDistance = distance;
            bestScope = first.element;
          }
        }
      }
      return { candidate, distance: bestDistance, scope: bestScope };
    }).filter(item => Number.isFinite(item.distance)).sort((first, second) => first.distance - second.distance);
    if (!ranked.length) return selecionarPorDensidadeConjuntoAbas(name, candidates);
    if (ranked[1] && ranked[0].distance === ranked[1].distance) {
      const closest = ranked.filter(item => item.distance === ranked[0].distance);
      if (closest.some(item => item.scope !== closest[0].scope)) return selecionarPorDensidadeConjuntoAbas(name, candidates);
    }
    return ranked[0].candidate;
  }

  function painelAbaVisivel(name) {
    const panelIds = {
      cliente: "tabCliente",
      definicao: "tabDefinicao",
      data: "tabData",
      acionamento: "tabAcionamento",
      encerramento: "tabEncerramento",
      certificacao: "tabCertificacao"
    };
    const suffix = panelIds[normalizar(name)];
    if (!suffix) return false;
    return documentos().some(doc => [...doc.querySelectorAll(`[id$=":${suffix}"]`)].some(visivel));
  }

  async function aguardarAtivacaoAba(name, shouldStop = () => false, timeout = 1600) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      const candidates = encontrarCandidatasAba(name);
      if (candidates.some(abaPareceAtiva)) return true;
      if (painelAbaVisivel(name)) return true;
      await aguardarMudancaDom(250, shouldStop);
    }
    return false;
  }

  async function aguardarCandidataAba(name, shouldStop = () => false, timeout = 3200) {
    const deadline = Date.now() + timeout;
    let candidates = [];
    while (Date.now() < deadline) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      candidates = encontrarCandidatasAba(name).filter(candidate => candidate.isConnected !== false && visivel(candidate));
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) {
        const selected = selecionarCandidataAba(name, candidates);
        if (selected) return selected;
      }
      await aguardarMudancaDom(Math.min(250, deadline - Date.now()), shouldStop);
    }
    throw new Error(`Aba ${name} ${candidates.length ? `ambígua (${candidates.length} candidatas: ${candidates.slice(0, 3).map(item => `{${descreverControle(item)}}`).join(" ")})` : "não encontrada"} após atualizar o DOM.`);
  }

  async function clicarAba(name, shouldStop = () => false) {
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    const clicked = await aguardarCandidataAba(name, shouldStop);
    const refreshTab = () => aguardarCandidataAba(name, shouldStop, 1600);
    await clicarControle(clicked, shouldStop, null, refreshTab);
    const activated = await aguardarAtivacaoAba(name, shouldStop);
    if (!activated) {
      throw new Error(`Aba ${name} foi clicada, mas o SIGITM não confirmou que seu painel está ativo; leitura/ação bloqueada para evitar usar outra aba.`);
    }
    await aguardarFimCarregamento(shouldStop);
    lastActivatedTabName = name;
    return !shouldStop();
  }

  async function lerCaso(shouldStop = () => false, onTab = () => {}, onClassification = null) {
    onTab("Cliente");
    if (!await clicarAba("Cliente", shouldStop)) throw new Error("Automação interrompida.");
    const cliente = lerCampo(["Cliente"]);
    const servicoAfetado = lerCampo(["Serviço Afetado", "Servico Afetado"]);

    onTab("Definição");
    if (!await clicarAba("Definição", shouldStop)) throw new Error("Automação interrompida.");
    const ticket = lerCampo(["Nº tíquete", "Número do chamado", "Número do tíquete", "Tíquete", "Sequência", "BD"]);
    const data = { numeroChamado: String(ticket).match(/\d{5,20}/)?.[0] || "" };
    data.tipoAbertura = lerCampo(["Tipo de Abertura", "Tipo abertura", "Tipo Abertura"]);
    data.procedencia = lerCampo(["Procedência", "Procedencia"]);
    data.tipoIncidencia = lerCampo(["Tipo de Incidência", "Tipo de Incidencia", "Tipo incidência", "Tipo incidencia"]);
    data.cliente = cliente || lerCampo(["Cliente"]);
    data.intragov = lerIntragov();
    data.servicoAfetado = servicoAfetado || lerCampo(["Serviço Afetado", "Servico Afetado"]);
    try { onClassification?.({ ...data }); } catch { }

    onTab("Data");
    if (!await clicarAba("Data", shouldStop)) throw new Error("Automação interrompida.");
    data.dataCriacao = lerCampo(["Data Criação", "Data Criacao", "Data de Criação", "Data de Criacao"]);
    data.dataObjetivo = lerCampo(["Data Objetivo"]);
    data.dataReparoOriginal = lerCampo(["Data de Reparo", "Data Reparo"]);
    data.dataReparo = "";
    data.dataInicioSla = lerCampo(["Início do SLA", "Inicio do SLA", "Data de Início do SLA", "Data de Inicio do SLA"]);
    data.paradaRelogio = lerCampo(["Parada de Relógio"]);
    data.dataParadaRelogio = lerCampo(["Data da Parada de Relógio", "Data da Parada do Relógio", "Data Parada de Relógio", "Data Pausa", "Data/Hora da Pausa"]);
    const clockPause = await lerDadosParadaRelogio(shouldStop);
    const clockPauseError = aplicarDadosParadaRelogio(data, clockPause);
    if (clockPauseError) throw new Error(clockPauseError);

    onTab("Acionamento");
    if (!await clicarAba("Acionamento", shouldStop)) throw new Error("Automação interrompida.");
    const actionText = documentos().map(doc => textoDe(doc.body)).join("\n");
    const actionRows = documentos().flatMap(doc => [...doc.querySelectorAll("tr, [role='row'], li")])
      .filter(row => visivel(row) && /\b6Z036\b/i.test(textoDe(row)))
      .sort((a, b) => textoDe(a).length - textoDe(b).length);
    const activeRows = encontrarLinhasAcionamentoAtivo();
    const actionRowText = normalizar(textoDe(activeRows[0] || actionRows[0]));
    const actionCode = lerCampo(["Código do Acionamento", "Código Completo do Acionamento"]);
    const foundAction = activeRows.length > 0 || /\b6Z036\b/i.test(`${actionCode} ${actionText}`);
    Object.assign(data, resolverEstadoAcionamento(foundAction, `${actionCode} ${actionRowText}`));
    return data;
  }

  const api = { documentos, visivel, normalizar, textoDe, controlesPara, valorDe, lerCampo, lerIntragov, retratoTabelaParadaRelogio, lerDadosParadaRelogio, aplicarDadosParadaRelogio, resolverEstadoAcionamento, encontrarLinhasAcionamentoAtivo, indicadoresCarregamento, aguardarMudancaDom, aguardarFimCarregamento, garantirAcaoPronta, clicarControle, encontrarCandidatasAba, abaPareceAtiva, painelAbaVisivel, selecionarCandidataAba, clicarAba, lerCaso };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaixaNavigation = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
