(function (root) {
  "use strict";

  function encontrarBotaoUnico(labels) {
    const wanted = new Set(labels.map(root.BaixaNavigation.normalizar));
    const selector = "button, input, a, [role='button'], [onclick], [tabindex]";
    const candidates = root.BaixaNavigation.documentos().flatMap(doc => [...doc.querySelectorAll(selector)])
      .filter(element => root.BaixaNavigation.visivel(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true" && !eControleFechar(element));
    const exact = candidates.filter(element => rotulosBotoes(element).some(label => wanted.has(label)));
    const selected = exact.length ? exact : candidates.filter(element =>
      rotulosBotoes(element).some(label => [...wanted].some(term => term.length >= 4 && rotuloTemFrase(label, term))));
    const unique = [...new Set(selected)].filter(candidate => !selected.some(other =>
      other !== candidate && candidate.contains?.(other)));
    if (unique.length !== 1) {
      const action = labels.join(" / ");
      throw new Error(`Botão “${action}” ${unique.length ? `ambíguo (${unique.length} correspondências)` : "não encontrado"}; ação bloqueada.`);
    }
    return unique[0];
  }

  async function aguardarBotaoUnico(labels, timeout = 10000, shouldStop = () => false) {
    await root.BaixaNavigation.aguardarFimCarregamento(shouldStop);
    const button = await aguardarPor(() => {
      try { return encontrarBotaoUnico(labels); }
      catch (error) {
        if (/não encontrado/.test(error.message)) return false;
        throw error;
      }
    }, timeout, shouldStop);
    if (!button) throw new Error(`Botão “${labels.join(" / ")}" não apareceu após o carregamento da tela; ação bloqueada.`);
    return button;
  }

  function textoRetorno() {
    const selectors = "[role='alert'], [role='status'], [role='dialog'], [aria-modal='true'], .alert, .ui-messages, .ui-message, .toast, .notification, .modal, .swal2-popup";
    return root.BaixaNavigation.documentos().flatMap(doc => [...doc.querySelectorAll(selectors)])
      .filter(root.BaixaNavigation.visivel).map(root.BaixaNavigation.textoDe).join(" ");
  }

  function eControleFechar(element) {
    const raw = [
      element.getAttribute?.("aria-label"), element.getAttribute?.("title"), element.value,
      element.getAttribute?.("alt"), element.getAttribute?.("data-dismiss"),
      element.getAttribute?.("data-close"), element.getAttribute?.("name"), element.id,
      root.BaixaNavigation.textoDe(element), String(element.className || "")
    ].filter(Boolean).join(" ");
    const normalized = root.BaixaNavigation.normalizar(raw);
    const rawLower = raw.toLowerCase();
    const closeWord = /(^|[\s:_\-])(?:fechar|fecha|close|dismiss|cancelar)(?=$|[\s:_\-])/i;
    const closeSymbol = /(^|[\s"'=>(])(?:x|×|✕|✖|✗|✘)(?=$|[\s"'=<),.:-])/iu;
    const dataClose = String(element.getAttribute?.("data-dismiss") || element.getAttribute?.("data-close") || "").toLowerCase();
    const compact = rawLower.replace(/[^a-z0-9]+/g, "");
    return closeWord.test(rawLower) || closeSymbol.test(rawLower) || closeWord.test(normalized) ||
      /^(?:close|dismiss|fechar)$/i.test(dataClose) ||
      /(?:close|dismiss|fechar)(?:button|icon|btn|popup)/i.test(rawLower) ||
      /(?:btn|button)(?:close|fechar|dismiss)/i.test(compact);
  }

  function rotulosBotoes(element) {
    const image = element.querySelector?.("img");
    const values = [
      root.BaixaNavigation.textoDe(element), element.value, element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"), element.getAttribute?.("alt"), image?.alt,
      image?.title, image?.getAttribute?.("src"), element.getAttribute?.("src"),
      element.getAttribute?.("onclick"), element.id, element.name
    ];
    return [...new Set(values.filter(Boolean).map(root.BaixaNavigation.normalizar))];
  }

  function rotuloTemFrase(label, phrase) {
    return label === phrase || label.startsWith(`${phrase} `) || label.endsWith(` ${phrase}`) || label.includes(` ${phrase} `);
  }

  function janelasVisiveis() {
    const selector = "[role='dialog'], [aria-modal='true'], .modal, .swal2-popup, .ui-dialog, .ui-dialog-content, [class*='popup' i], [id*='popup' i], .rich-mpnl-panel, .rich-mpnl-content, [class*='rich-mpnl' i], [id*='rich-mpnl' i], [class*='modalpanel' i], [id*='modalpanel' i]";
    const semantic = root.BaixaNavigation.documentos().flatMap(doc => [...doc.querySelectorAll(selector)])
      .filter(root.BaixaNavigation.visivel);
    const messageWindows = root.BaixaNavigation.documentos().flatMap(doc => {
      const candidates = [...doc.querySelectorAll("div, table, section, fieldset, form")].filter(node => {
        if (!root.BaixaNavigation.visivel(node)) return false;
        const text = root.BaixaNavigation.normalizar(root.BaixaNavigation.textoDe(node));
        const rect = node.getBoundingClientRect();
        if (/tiquete bloqueado/.test(text) && rect.width >= 300 && rect.height >= 150) return true;
        const style = node.ownerDocument.defaultView?.getComputedStyle?.(node);
        const isOverlay = ["fixed", "absolute"].includes(style?.position) || Number(style?.zIndex) >= 100;
        return isOverlay && rect.width >= 180 && rect.height >= 70 && candidatasImagemFechar(node).length === 1;
      });
      return candidates.sort((a, b) => {
        const aHasClose = candidatasImagemFechar(a).length > 0;
        const bHasClose = candidatasImagemFechar(b).length > 0;
        if (aHasClose !== bHasClose) return aHasClose ? -1 : 1;
        const first = a.getBoundingClientRect();
        const second = b.getBoundingClientRect();
        return first.width * first.height - second.width * second.height;
      }).slice(0, 1);
    });
    return [...new Set([...semantic, ...messageWindows])];
  }

  function metadadosControleJanela(element) {
    return root.BaixaNavigation.normalizar([
      element?.id, element?.name, element?.title, element?.alt, element?.value,
      element?.getAttribute?.("aria-label"), element?.getAttribute?.("data-dismiss"),
      element?.getAttribute?.("data-close"), element?.getAttribute?.("src"),
      element?.getAttribute?.("onclick"), element?.onclick?.toString?.(),
      root.BaixaNavigation.textoDe(element)
    ].filter(Boolean).join(" "));
  }

  function candidatasImagemFechar(popup) {
    const rootRect = popup.getBoundingClientRect?.();
    if (!rootRect) return [];
    const selector = "button, input[type='image'], input[type='button'], a, [onclick], [role='button'], [tabindex], img, svg, i";
    const scored = [];
    for (const element of popup.querySelectorAll(selector)) {
      if (!root.BaixaNavigation.visivel(element) || element.disabled) continue;
      const visual = element.matches("img, svg, i") ? element : element.querySelector?.("img, svg, i");
      const target = visual?.closest?.("a, button, input[type='image'], [onclick], [role='button'], [tabindex]") || element;
      const rect = (visual || target).getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      const raw = [metadadosControleJanela(element), metadadosControleJanela(visual), metadadosControleJanela(target)].filter(Boolean).join(" ");
      const small = rect.width <= 52 && rect.height <= 52;
      const topRight = rect.right >= rootRect.right - 65 && rect.top <= rootRect.top + 70;
      const symbol = /(?:^|[\s:._-])(?:x|×|✕|✖|✗|✘)(?:$|[\s:._-])/iu.test(raw);
      const named = /(?:fechar|fecha|close|dismiss|botao x|btnclose|closebutton|fechar\.gif|close\.gif)/i.test(raw);
      if ((small && topRight) || symbol || named) {
        const score = (topRight ? 100 : 0) + (small ? 40 : 0) + (named ? 35 : 0) + (symbol ? 30 : 0);
        scored.push({ target, score, rect });
      }
    }
    const grouped = new Map();
    for (const item of scored) {
      const previous = grouped.get(item.target);
      if (!previous || item.score > previous.score) grouped.set(item.target, item);
    }
    return [...grouped.values()]
      .sort((a, b) => b.score - a.score || a.rect.top - b.rect.top || b.rect.right - a.rect.right)
      .map(item => item.target);
  }

  function controlesFecharJanela(popup) {
    const visual = candidatasImagemFechar(popup);
    if (visual.length) return visual;
    const selector = "button, input[type='button'], input[type='submit'], input[type='image'], a, [role='button'], [onclick], [tabindex], img, svg, i";
    const candidates = [...popup.querySelectorAll(selector)]
      .filter(element => root.BaixaNavigation.visivel(element) && !element.disabled && eControleFechar(element))
      .map(element => element.matches("img, svg, i")
        ? element.closest("a, button, input[type='image'], [onclick], [role='button'], [tabindex]") || element
        : element);
    return [...new Set(candidates)];
  }

  function encontrarControleFecharProximoJanela(popup) {
    const doc = popup?.ownerDocument;
    const popupRect = popup?.getBoundingClientRect?.();
    if (!doc || !popupRect) return null;
    const selector = "button, input[type='button'], input[type='image'], a, [role='button'], [onclick], [tabindex], img, svg, i";
    const candidates = [];
    for (const element of doc.querySelectorAll(selector)) {
      if (!root.BaixaNavigation.visivel(element) || element.disabled) continue;
      const visual = element.matches("img, svg, i") ? element : element.querySelector?.("img, svg, i");
      const target = visual?.closest?.("a, button, input[type='image'], [onclick], [role='button'], [tabindex]") || element;
      const rect = (visual || target).getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      const metadata = metadadosControleJanela(target) + " " + metadadosControleJanela(visual);
      const nearTopRight = rect.top <= popupRect.top + 85 && rect.right >= popupRect.right - 90 && rect.left >= popupRect.right - 120;
      const tiny = rect.width <= 60 && rect.height <= 60;
      const named = /fechar|fecha|close|dismiss|btnclose|closebutton|botao x|fechar\.(?:gif|png)/i.test(metadata);
      const symbol = /(?:^|[\s:._-])(?:x|×|✕|✖|✗|✘)(?:$|[\s:._-])/iu.test(metadata);
      if (nearTopRight && tiny || named || symbol) {
        const score = (nearTopRight ? 130 : 0) + (tiny ? 45 : 0) + (named ? 35 : 0) + (symbol ? 30 : 0);
        candidates.push({ element: target, score, distance: Math.abs(rect.right - popupRect.right) + Math.abs(rect.top - popupRect.top) });
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.distance - b.distance);
    return candidates[0]?.element || null;
  }

  function selecionarMelhorControleFecharJanela(popup) {
    const visual = candidatasImagemFechar(popup);
    if (visual.length) return visual[0];
    const candidates = controlesFecharJanela(popup);
    if (candidates.length === 1) return candidates[0];
    if (!candidates.length) return encontrarControleFecharProximoJanela(popup);
    const rootRect = popup.getBoundingClientRect?.();
    if (!rootRect) return null;
    const ranked = candidates.map(element => {
      const rect = element.getBoundingClientRect?.() || {};
      const metadata = metadadosControleJanela(element);
      const topRight = Number.isFinite(rect.right) && rect.right >= rootRect.right - 70 && rect.top <= rootRect.top + 80;
      const small = rect.width > 0 && rect.width <= 60 && rect.height > 0 && rect.height <= 60;
      const named = /fechar|fecha|close|dismiss|btnclose|closebutton|botao x/i.test(metadata);
      const symbol = /(?:^|[\s:._-])(?:x|×|✕|✖|✗|✘)(?:$|[\s:._-])/iu.test(metadata);
      const score = (topRight ? 100 : 0) + (small ? 40 : 0) + (named ? 30 : 0) + (symbol ? 30 : 0);
      return { element, score };
    }).sort((a, b) => b.score - a.score);
    return ranked[0]?.score > 0 ? ranked[0].element : null;
  }

  function nomeFuncaoFecharSeguro(control) {
    const href = String(control?.getAttribute?.("href") || "").trim();
    if (!/^javascript:/i.test(href)) return "";
    const expression = href.replace(/^javascript:/i, "").trim();
    const match = expression.match(/^(?:(?:window|self)\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\(\s*\)\s*;?$/i);
    return match ? match[1] : "";
  }

  function invocarFechamentoJavaScriptSeguro(control) {
    const functionName = nomeFuncaoFecharSeguro(control);
    if (!functionName) return false;
    const view = control.ownerDocument?.defaultView;
    if (!view) return false;
    if (functionName.toLowerCase() === "close") {
      if (!view.opener) return false;
      view.close();
      return true;
    }
    const handler = view[functionName];
    if (typeof handler !== "function") return false;
    handler.call(view);
    return true;
  }

  function idPainelRichFaces(control, popup) {
    const snippets = [
      control?.getAttribute?.("onclick"), control?.getAttribute?.("href"), control?.onclick?.toString?.(),
      popup?.getAttribute?.("onclick"), popup?.id
    ].filter(Boolean).join(" ");
    return snippets.match(/richfaces?\s*\.\s*hideModalPanel\s*\(\s*['\"]([^'\"]+)['\"]\s*\)/i)?.[1] || "";
  }

  function invocarFechamentoModalRichFaces(control, popup) {
    const view = control.ownerDocument?.defaultView || popup?.ownerDocument?.defaultView;
    const richFaces = view?.RichFaces || view?.Richfaces;
    if (typeof richFaces?.hideModalPanel !== "function") return false;
    const panelId = idPainelRichFaces(control, popup);
    if (!panelId) return false;
    richFaces.hideModalPanel(panelId);
    return true;
  }

  function pedidoFecharPagina(control, popup) {
    const panelId = idPainelRichFaces(control, popup);
    if (panelId) return { kind: "richfaces", value: panelId };
    const functionName = nomeFuncaoFecharSeguro(control);
    if (functionName && functionName.toLowerCase() !== "close") return { kind: "function", value: functionName };
    return null;
  }

  function solicitarFechamentoPagina(request) {
    const runtime = root.chrome?.runtime;
    if (!request || !runtime?.sendMessage) return Promise.resolve(false);
    return new Promise(resolve => {
      try {
        runtime.sendMessage({ type: "PAGE_CLOSE_POPUP", ...request }, response => {
          void runtime.lastError;
          resolve(response?.ok === true && response.closed === true);
        });
      } catch { resolve(false); }
    });
  }

  function suprimirNavegacaoJavaScript(control) {
    if (!/^javascript:/i.test(String(control?.getAttribute?.("href") || "").trim())) return () => {};
    const guard = event => event.preventDefault();
    control.addEventListener("click", guard);
    return () => control.removeEventListener("click", guard);
  }

  function janelaFechadaAposClique(popup, control, previousMessage = "") {
    if (!popup) return true;
    if (!root.BaixaNavigation.visivel(popup)) return true;
    if (control && !root.BaixaNavigation.visivel(control)) return true;
    const controls = controlesFecharJanela(popup).filter(root.BaixaNavigation.visivel);
    if (!controls.length) {
      const current = root.BaixaNavigation.normalizar(root.BaixaNavigation.textoDe(popup));
      if (!current) return true;
      if (previousMessage && !current.includes(previousMessage)) return true;
      if (previousMessage && current !== previousMessage && /loader|loading|aguarde|processando|carregando/.test(current)) return true;
    }
    return false;
  }

  async function clicarFecharJanela(control, popup, shouldStop = () => false) {
    const href = String(control?.getAttribute?.("href") || "").trim();
    const javascriptHref = /^javascript:/i.test(href);
    if (!control) throw new Error("Controle X do popup não encontrado.");
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    await root.BaixaNavigation.aguardarFimCarregamento(shouldStop);
    const previousMessage = root.BaixaNavigation.normalizar(root.BaixaNavigation.textoDe(popup));
    try { control.focus?.(); } catch { }
    let releaseNavigationGuard = () => {};
    try {
      await root.BaixaNavigation.clicarControle(control, shouldStop, () => {
        releaseNavigationGuard = suprimirNavegacaoJavaScript(control);
      });
    } catch { }
    finally { releaseNavigationGuard(); }
    if (await aguardarPor(() => janelaFechadaAposClique(popup, control, previousMessage), 2200, shouldStop, 25)) return;
    if (invocarFechamentoModalRichFaces(control, popup)) {
      if (await aguardarPor(() => janelaFechadaAposClique(popup, control, previousMessage), 2200, shouldStop, 25)) return;
    }
    if (invocarFechamentoJavaScriptSeguro(control)) {
      if (await aguardarPor(() => janelaFechadaAposClique(popup, control, previousMessage), 2200, shouldStop, 25)) return;
    }
    if (await solicitarFechamentoPagina(pedidoFecharPagina(control, popup))) {
      if (await aguardarPor(() => janelaFechadaAposClique(popup, control, previousMessage), 2200, shouldStop, 25)) return;
    }
    if (await aguardarPor(() => janelaFechadaAposClique(popup, control, previousMessage), 3200, shouldStop, 35)) return;
    if (javascriptHref) throw new Error("O X do SIGITM não fechou o popup.");
    throw new Error("O X do SIGITM não foi confirmado como fechado; a automação não avançará sem segurança.");
  }

  function classificarJanelaSigitm(action, text) {
    const message = String(text || "").replace(/\s+/g, " ").trim();
    if (!message) return { kind: "empty", message };
    const normalized = root.BaixaNavigation.normalizar(message);
    if (action === "Bloquear" && /\b(?:ticket|tiquete) bloqueado\b/.test(normalized)) {
      return { kind: "expected", message };
    }
    const explicitError = /\b(erro|error|falha|falhou|inv[aá]lid[oa]|obrigat[oó]ri[oa]|recusad[oa]|negad[oa]|n[aã]o foi poss[ií]vel|n[aã]o autorizado|exce[cç][aã]o|validation error)\b/i.test(message);
    if (explicitError || action === "Baixar") return { kind: "error", message };
    return { kind: "notice", message };
  }

  async function fecharJanelaBloqueio(shouldStop = () => false, action = "Bloquear", appearanceTimeout = action === "Baixar" ? 900 : 7000) {
    const popup = await aguardarPor(() => janelasVisiveis().find(candidate => {
      const text = root.BaixaNavigation.normalizar(root.BaixaNavigation.textoDe(candidate));
      return action === "Baixar" || Boolean(selecionarMelhorControleFecharJanela(candidate)) || Boolean(text && /tiquete bloqueado|baixa|mensagem|erro|falha|inv[aá]lid|obrigat|recusad/.test(text));
    }) || null, appearanceTimeout, shouldStop, 40);
    if (!popup) return false;
    const rawMessage = root.BaixaNavigation.textoDe(popup);
    const classification = classificarJanelaSigitm(action, rawMessage);
    const errorMessage = classification.kind === "error"
      ? `SIGITM retornou um popup após ${action}: ${classification.message || "mensagem sem texto"}` : "";
    const controlTimeout = action === "Baixar" ? 1800 : 7000;
    const control = await aguardarPor(() => {
      if (!root.BaixaNavigation.visivel(popup)) return true;
      const current = janelasVisiveis().find(candidate => candidate === popup || candidate.contains?.(popup) || popup.contains?.(candidate)) || popup;
      return selecionarMelhorControleFecharJanela(current) || encontrarControleFecharProximoJanela(current) || false;
    }, controlTimeout, shouldStop, 35);
    if (!root.BaixaNavigation.visivel(popup)) {
      if (errorMessage) throw new Error(errorMessage);
      return true;
    }
    if (!control || control === true) {
      if (errorMessage) throw new Error(`${errorMessage}${control === true ? "" : " (popup mantido aberto: não foi possível localizar o X)"}`);
      return !root.BaixaNavigation.visivel(popup);
    }
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    try { await clicarFecharJanela(control, popup, shouldStop); }
    catch (error) {
      if (errorMessage) throw new Error(`${errorMessage}; falha ao fechar a janela: ${error.message}`);
      throw error;
    }
    if (errorMessage) throw new Error(errorMessage);
    return true;
  }

  function janelaErroValidacao() {
    const requiredError = /Validation Error:\s*Value is required/i;
    const matches = janelasVisiveis().filter(popup => requiredError.test(root.BaixaNavigation.textoDe(popup)));
    return matches.sort((first, second) => {
      const firstControl = selecionarMelhorControleFecharJanela(first);
      const secondControl = selecionarMelhorControleFecharJanela(second);
      return (firstControl ? 0 : 1) - (secondControl ? 0 : 1);
    })[0] || null;
  }

  function eJanelaBaixaAcionamento(popup) {
    const text = root.BaixaNavigation.normalizar(root.BaixaNavigation.textoDe(popup));
    return text.includes("acionamento") && text.includes("codigo completo da baixa");
  }

  async function fecharJanelaErroValidacao(shouldStop = () => false) {
    const popup = await aguardarPor(() => janelaErroValidacao(), 700, shouldStop, 40);
    if (!popup) return false;
    const control = selecionarMelhorControleFecharJanela(popup);
    if (!control) return false;
    await clicarFecharJanela(control, popup, shouldStop);
    return true;
  }

  async function iniciarEncerramentoPrincipal(shouldStop = () => false, afterBlock = null) {
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    await root.BaixaNavigation.aguardarFimCarregamento(shouldStop);
    const blockLabels = ["Bloquear"];
    let blockButton;
    try {
      blockButton = await aguardarBotaoUnico(blockLabels, 12000, shouldStop);
    } catch (error) {
      const visibleNextAction = ["Gravar Baixa", "Baixar"].find(label => {
        try { encontrarBotaoUnico([label]); return true; } catch { return false; }
      });
      if (visibleNextAction) {
        throw new Error(`O botão “Bloquear” não está disponível, mas “${visibleNextAction}” já aparece na tela. O chamado pode estar em uma etapa de baixa já iniciada; nenhuma ação foi repetida. Confira o status no SIGITM e, se necessário, atualize a página antes de tentar novamente.`);
      }
      throw error;
    }
    const refreshBlockButton = async () => aguardarBotaoUnico(blockLabels, 2000, shouldStop);
    await root.BaixaNavigation.clicarControle(blockButton, shouldStop, null, refreshBlockButton);
    const blockPopupClosed = await fecharJanelaBloqueio(shouldStop);
    if (!blockPopupClosed && blockButton.isConnected !== false && !blockButton.disabled) {
      throw new Error("O SIGITM não confirmou o bloqueio do tíquete; Baixar foi cancelado para evitar continuar em estado incerto.");
    }
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    if (afterBlock) await afterBlock();
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    if (!await root.BaixaNavigation.clicarAba("Cliente", shouldStop)) throw new Error("Aba Cliente indisponível após fechar a mensagem de bloqueio.");
    let downloadButton;
    try {
      downloadButton = await aguardarBotaoUnico(["Baixar"], 10000, shouldStop);
    } catch (error) {
      if (/interrompida/i.test(error.message || "")) throw error;
      throw new Error(`Aba Cliente foi confirmada como ativa, mas o botão “Baixar” não apareceu após aguardar o SIGITM. Nenhum clique foi feito. ${error.message}`);
    }
    await root.BaixaNavigation.aguardarFimCarregamento(shouldStop);
    const refreshDownloadButton = async () => {
      const button = await aguardarBotaoUnico(["Baixar"], 2000, shouldStop);
      return button;
    };
    await root.BaixaNavigation.clicarControle(downloadButton, shouldStop, null, refreshDownloadButton);
    await fecharJanelaBloqueio(shouldStop, "Baixar");
    return true;
  }

  async function gravarEncerramentoPrincipal(shouldStop = () => false) {
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    let validationErrorObserved = false;
    let popupCloseObserved = false;
    const rootNode = document.documentElement;
    const validationPattern = /Validation Error:\s*Value is required/i;
    const hasValidationErrorNow = () => root.BaixaNavigation.documentos().some(doc =>
      validationPattern.test(root.BaixaNavigation.textoDe(doc.body))
    );
    const looksLikeClose = target => {
      let node = target;
      for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
        if (eControleFechar(node)) return true;
      }
      return false;
    };
    const observer = rootNode && typeof MutationObserver !== "undefined"
      ? new MutationObserver(() => { if (hasValidationErrorNow()) validationErrorObserved = true; })
      : null;
    const clickListener = event => {
      if (looksLikeClose(event.target)) {
        popupCloseObserved = true;
        return;
      }
      try {
        const popup = janelaErroValidacao();
        if (!popup) return;
        const control = selecionarMelhorControleFecharJanela(popup);
        if (control && (event.target === control || control.contains?.(event.target) || event.target?.closest?.("a,button,input,[role='button'],[onclick],[tabindex]") === control)) {
          popupCloseObserved = true;
        }
      } catch { }
    };
    try {
      await root.BaixaNavigation.aguardarFimCarregamento(shouldStop);
      const button = encontrarBotaoUnico(["Gravar Baixa"]);
      if (observer) observer.observe(rootNode, { subtree: true, childList: true, characterData: true, attributes: true });
      document.addEventListener("click", clickListener, true);
      await root.BaixaNavigation.clicarControle(button, shouldStop);
      const end = Date.now() + 2000;
      let validationPopupSeen = false;
      while (Date.now() < end) {
        if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
        if (hasValidationErrorNow()) validationErrorObserved = true;
        const visibleValidationPopup = janelaErroValidacao();
        if (visibleValidationPopup) validationPopupSeen = true;
        if (validationErrorObserved) return { saved: false, validationError: true, popupCloseObserved };
        if (validationPopupSeen && !visibleValidationPopup && root.BaixaNavigation.encontrarCandidatasAba) {
          const hasCertificationTab = root.BaixaNavigation.encontrarCandidatasAba("Certificação").length > 0;
          if (hasCertificationTab) return { saved: false, validationError: true, popupCloseObserved: true };
        }
        if (popupCloseObserved && root.BaixaNavigation.encontrarCandidatasAba) {
          const hasCertificationTab = root.BaixaNavigation.encontrarCandidatasAba("Certificação").length > 0;
          if (hasCertificationTab) return { saved: false, validationError: true, popupCloseObserved: true };
        }
        await root.BaixaNavigation.aguardarMudancaDom(250, shouldStop);
      }
      return { saved: true, validationError: false, popupCloseObserved };
    } finally {
      observer?.disconnect();
      document.removeEventListener("click", clickListener, true);
    }
  }

  async function aguardarPor(predicate, timeout = 12000, shouldStop = () => false, pollMs = 250) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      const value = predicate();
      if (value) return value;
      await root.BaixaNavigation.aguardarMudancaDom(Math.min(pollMs, end - Date.now()), shouldStop);
    }
    return false;
  }

  async function fecharAcionamentoAtivo(baixaCode, shouldStop = () => false) {
    if (!await root.BaixaNavigation.clicarAba("Acionamento", shouldStop)) throw new Error("Aba Acionamento indisponível.");
    const activeRows = root.BaixaNavigation.encontrarLinhasAcionamentoAtivo();
    if (!activeRows.length) return false;
    if (activeRows.length !== 1) throw new Error(`Há ${activeRows.length} acionamentos ativos; a baixa foi interrompida para evitar selecionar a linha errada.`);
    const links = [...activeRows[0].querySelectorAll('a.down[title="baixar"]')]
      .filter(link => root.BaixaNavigation.visivel(link) && !link.disabled && link.getAttribute("aria-disabled") !== "true");
    if (links.length !== 1) throw new Error(`O controle “baixar” do acionamento ativo ${links.length ? "está ambíguo" : "não foi encontrado"}; nenhuma ação foi executada.`);
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    await root.BaixaNavigation.aguardarFimCarregamento(shouldStop);
    await root.BaixaNavigation.clicarControle(links[0], shouldStop);
    const popup = await aguardarPor(() => janelasVisiveis().find(eJanelaBaixaAcionamento) || false, 10000, shouldStop);
    if (!popup) throw new Error("O SIGITM não exibiu o popup de baixa do acionamento ativo.");
    await root.BaixaFormHandler.preencherBaixaAcionamento(baixaCode, () => janelasVisiveis().find(eJanelaBaixaAcionamento) || null, shouldStop);
    const saveButton = await aguardarBotaoUnico(["Gravar"], 10000, shouldStop);
    await root.BaixaNavigation.clicarControle(saveButton, shouldStop);
    const confirmed = await aguardarPor(() => {
      const modalStillVisible = root.BaixaNavigation.documentos().some(doc => {
        const current = doc.getElementById("modalListBaixaAcionamento");
        return current && root.BaixaNavigation.visivel(current);
      });
      return !modalStillVisible && root.BaixaNavigation.encontrarLinhasAcionamentoAtivo().length === 0;
    }, 12000, shouldStop);
    if (!confirmed) throw new Error("O SIGITM não confirmou a gravação do acionamento; a baixa principal foi cancelada.");
    return true;
  }

  async function confirmarEncerramentoPrincipal(shouldStop = () => false) {
    if (!await root.BaixaNavigation.clicarAba("Encerramento", shouldStop)) throw new Error("Aba Encerramento indisponível.");
    const button = encontrarBotaoUnico(["Confirmar Baixa", "Confirmar", "Baixar", "Salvar", "Encerrar", "Concluir"]);
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    await root.BaixaNavigation.aguardarFimCarregamento(shouldStop);
    await root.BaixaNavigation.clicarControle(button, shouldStop);
    const resultado = await aguardarPor(() => {
      const feedback = textoRetorno();
      const message = root.BaixaNavigation.normalizar(feedback);
      if (/erro.{0,50}(baixa|encerramento|log)|falha.{0,50}(baixa|encerramento|log)|nao foi possivel.{0,50}(baix|encerr)|log.{0,50}(erro|falha)/.test(message)) {
        return `ERRO NO SISTEMA — ${feedback || "o SIGITM recusou a baixa."}`;
      }
      if (/baixa realizada com sucesso|chamado baixado com sucesso|encerrado com sucesso/.test(message)) return "BAIXA REALIZADA";
      const status = root.BaixaNavigation.normalizar(root.BaixaNavigation.lerCampo(["Status", "Situação", "Situacao"]));
      if (["baixado", "baixada", "encerrado", "encerrada", "fechado", "fechada"].includes(status)) return "BAIXA REALIZADA";
      return "";
    }, 12000, shouldStop);
    return resultado || "ERRO NO SISTEMA — o SIGITM não confirmou a baixa; o pop-up foi mantido aberto.";
  }

  const api = { encontrarBotaoUnico, aguardarBotaoUnico, classificarJanelaSigitm, eControleFechar, candidatasImagemFechar, controlesFecharJanela, encontrarControleFecharProximoJanela, selecionarMelhorControleFecharJanela, invocarFechamentoJavaScriptSeguro, invocarFechamentoModalRichFaces, pedidoFecharPagina, suprimirNavegacaoJavaScript, clicarFecharJanela, fecharJanelaBloqueio, fecharJanelaErroValidacao, eJanelaBaixaAcionamento, iniciarEncerramentoPrincipal, gravarEncerramentoPrincipal, fecharAcionamentoAtivo, confirmarEncerramentoPrincipal };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaixaHandler = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
