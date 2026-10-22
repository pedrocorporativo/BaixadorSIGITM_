(function (root) {
  "use strict";

  function definirValor(control, value, options = {}) {
    if (!control) throw new Error("Campo de formulário não encontrado.");
    const label = control.name || control.id || "sem identificação";
    if ((control.disabled || control.readOnly) && !options.allowLocked) {
      const state = control.disabled ? "desabilitado" : "somente leitura";
      throw new Error(`Campo ${label} indisponível: está ${state} no SIGITM.`);
    }
    const originalDisabled = control.disabled;
    const originalReadOnly = control.readOnly;
    if (options.allowLocked) {
      control.disabled = false;
      control.readOnly = false;
    }
    try {
      if (control.tagName === "SELECT") {
        const option = encontrarOpcaoSelecao(control, value);
        if (!option) throw new Error(`Opção não encontrada para ${value}.`);
        control.value = option.value;
      } else if (control.type === "checkbox" || control.type === "radio") {
        const expected = root.BaixaNavigation.normalizar(value) === "sim";
        control.checked = expected;
      } else {
        const view = control.ownerDocument.defaultView;
        const prototype = control.tagName === "TEXTAREA" ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        if (setter) setter.call(control, value);
        else control.value = value;
      }
      const EventType = control.ownerDocument.defaultView.Event;
      control.dispatchEvent(new EventType("input", { bubbles: true }));
      control.dispatchEvent(new EventType("change", { bubbles: true }));
      if (options.blur || options.allowLocked) control.dispatchEvent(new EventType("blur"));
    } finally {
      if (options.allowLocked) {
        control.disabled = originalDisabled;
        control.readOnly = originalReadOnly;
      }
    }
    if (!valorCampoCorresponde(control, value)) {
      throw new Error(`O campo ${control.name || control.id || "sem identificação"} não confirmou o valor inserido.`);
    }
  }

  function eServicoSai(value) {
    const normalized = root.BaixaNavigation.normalizar(value);
    return /\bsai\b/.test(normalized) || (normalized.includes("acesso") && normalized.includes("internet"));
  }

  function abreviacaoServico(value) {
    const match = String(value || "").trim().match(/^([A-Z0-9]{2,6})\s*(?:[-–:]|$)/);
    return match ? root.BaixaNavigation.normalizar(match[1]) : "";
  }

  function correspondeOpcaoServico(actual, expected) {
    const actualNormalized = root.BaixaNavigation.normalizar(actual);
    const expectedNormalized = root.BaixaNavigation.normalizar(expected);
    if (actualNormalized === expectedNormalized) return true;
    const abbreviation = abreviacaoServico(expected);
    if (abbreviation && new RegExp(`(^| )${abbreviation}($| )`).test(actualNormalized)) return true;
    return eServicoSai(expected) && eServicoSai(actual);
  }

  function selecionarTextoOpcao(option) {
    return [option?.textContent, option?.label, option?.value].filter(Boolean).join(" ");
  }

  function encontrarOpcaoSelecao(control, value) {
    const expected = root.BaixaNavigation.normalizar(value);
    return [...(control?.options || [])].find(option => {
      const text = root.BaixaNavigation.normalizar(selecionarTextoOpcao(option));
      return text === expected || correspondeOpcaoServico(text, value);
    }) || null;
  }

  function valorCampoCorresponde(control, expected) {
    const actual = root.BaixaNavigation.normalizar(root.BaixaNavigation.valorDe(control));
    const wanted = root.BaixaNavigation.normalizar(expected);
    return actual === wanted || (control?.tagName === "SELECT" && correspondeOpcaoServico(actual, expected));
  }

  function fill(aliases, value) {
    const controls = controlesParaCampoFormulario(aliases, true);
    if (controls.length !== 1) {
      const allControls = controlesParaCampoFormulario(aliases);
      if (!controls.length && allControls.length === 1) {
        definirValor(allControls[0], value);
        return;
      }
      throw new Error(`Campo ${aliases[0]} ${controls.length ? "ambíguo" : "não encontrado ou indisponível para edição"}.`);
    }
    definirValor(controls[0], value);
  }

  function preencherMelhorEsforco(aliases, value, skippedFields, options = {}) {
    const isRepairDate = aliases.some(alias => /^(data|dt)( de)? reparo$/.test(root.BaixaNavigation.normalizar(alias)));
    if (isRepairDate && !String(value || "").trim()) {
      throw new Error("Data de Reparo não pôde ser calculada porque a Data Criação está ausente ou inválida.");
    }
    const controls = controlesParaCampoFormulario(aliases, true);
    if (controls.length === 1) {
      definirValor(controls[0], value, options);
      verificar(aliases, value);
      return;
    }
    const allControls = controlesParaCampoFormulario(aliases);
    if (controls.length === 0 && allControls.length === 1 && (allControls[0].disabled || allControls[0].readOnly)) {
      skippedFields.push(aliases[0]);
      return;
    }
    throw new Error(`Campo ${aliases[0]} ${controls.length ? "ambíguo" : "não encontrado"}.`);
  }

  function encontrarCampoDataReparo() {
    const aliases = ["Data Reparo", "Data de Reparo", "Data do Reparo", "Dt Reparo", "Dt. Reparo"];
    const discovered = new Set(root.BaixaNavigation.controlesPara(aliases).filter(control =>
      !["button", "submit", "image", "checkbox", "radio", "reset"].includes(String(control.type || "").toLowerCase())
    ));
    for (const doc of root.BaixaNavigation.documentos()) {
      const controls = [...doc.querySelectorAll("input:not([type='hidden']):not([type='button']):not([type='submit']):not([type='image']):not([type='checkbox']):not([type='radio']), textarea")]
        .filter(control => root.BaixaNavigation.visivel(control));
      for (const label of doc.querySelectorAll("label, th, td, span, div")) {
        if (!root.BaixaNavigation.visivel(label)) continue;
        const labelText = root.BaixaNavigation.normalizar(root.BaixaNavigation.textoDe(label).replace(/:$/, ""));
        if (!aliases.some(alias => root.BaixaNavigation.normalizar(alias) === labelText)) continue;
        const labelRect = label.getBoundingClientRect?.();
        if (!labelRect) continue;
        const nearby = controls.map(control => ({ control, rect: control.getBoundingClientRect?.() }))
          .filter(item => item.rect && item.rect.left >= labelRect.right - 12 &&
            Math.abs((item.rect.top + item.rect.bottom) / 2 - (labelRect.top + labelRect.bottom) / 2) <= 36)
          .sort((first, second) => first.rect.left - second.rect.left);
        if (nearby.length === 1 || (nearby[0] && nearby[1] && nearby[0].rect.left + 12 < nearby[1].rect.left)) {
          discovered.add(nearby[0].control);
        }
      }
    }
    const matches = [...discovered];
    if (matches.length !== 1) {
      throw new Error(`Campo Data de Reparo ${matches.length ? `ambíguo (${matches.length} campos)` : "não encontrado na aba Encerramento"}.`);
    }
    return matches[0];
  }

  async function aguardarCampoDataReparo(shouldStop = () => false, timeout = 7000) {
    const end = Date.now() + timeout;
    let lastError = null;
    while (Date.now() < end) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      try { return encontrarCampoDataReparo(); }
      catch (error) { lastError = error; }
      await root.BaixaNavigation.aguardarMudancaDom(500, shouldStop);
    }
    throw lastError || new Error("Campo Data de Reparo não encontrado na aba Encerramento.");
  }

  function valorDataReparoParaControle(control, value) {
    const parsed = root.BaixaDateHandler.analisarData(value);
    if (!parsed) throw new Error("Data de Reparo calculada possui formato inválido.");
    const pad = part => String(part).padStart(2, "0");
    const date = `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
    if (control.type === "date") return date;
    if (control.type === "datetime-local") return `${date}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
    return value;
  }

  async function preencherDataReparo(value, shouldStop = () => false) {
    if (!String(value || "").trim()) throw new Error("Data de Reparo não pôde ser calculada porque a Data Criação está ausente ou inválida.");
    const field = await aguardarCampoDataReparo(shouldStop);
    const expected = valorDataReparoParaControle(field, value);
    definirValor(field, expected, { allowLocked: true });
    const expectedTime = root.BaixaDateHandler.analisarData(value).getTime();
    const end = Date.now() + 2500;
    while (Date.now() < end) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      let current;
      try { current = encontrarCampoDataReparo(); } catch { current = field; }
      const actualDate = root.BaixaDateHandler.analisarData(root.BaixaNavigation.valorDe(current));
      const requestedDate = root.BaixaDateHandler.analisarData(value);
      const matches = current.type === "date"
        ? actualDate && requestedDate && actualDate.getFullYear() === requestedDate.getFullYear() &&
          actualDate.getMonth() === requestedDate.getMonth() && actualDate.getDate() === requestedDate.getDate()
        : actualDate?.getTime() === expectedTime;
      if (matches) return true;
      await root.BaixaNavigation.aguardarMudancaDom(500, shouldStop);
    }
    throw new Error(`Data de Reparo não permaneceu no campo após preenchimento: ${value}.`);
  }

  function verificar(aliases, expected) {
    const controls = controlesParaCampoFormulario(aliases, true);
    if (controls.length !== 1 || !valorCampoCorresponde(controls[0], expected)) {
      throw new Error(`Validação do campo ${aliases[0]} falhou.`);
    }
  }

  function controlesParaCampoFormulario(aliases, editableOnly = false) {
    const found = new Set(root.BaixaNavigation.controlesPara(aliases, editableOnly));
    const wanted = aliases.map(alias => root.BaixaNavigation.normalizar(alias.replace(/:$/, "")));
    for (const doc of root.BaixaNavigation.documentos()) {
      const rows = [...doc.querySelectorAll("tr, [role='row'], .form-group, fieldset, li")]
        .filter(row => root.BaixaNavigation.visivel(row));
      for (const row of rows) {
        const rowText = root.BaixaNavigation.normalizar(root.BaixaNavigation.textoDe(row));
        if (!wanted.some(label => rowText.includes(label))) continue;
        const controls = [...row.querySelectorAll("input, select, textarea")].filter(control =>
          root.BaixaNavigation.visivel(control) && control.type !== "hidden" &&
          (!editableOnly || (!control.disabled && !control.readOnly))
        );
        if (controls.length === 1) found.add(controls[0]);
      }

      for (const label of doc.querySelectorAll("label, th, td, span, div")) {
        if (!root.BaixaNavigation.visivel(label)) continue;
        const labelText = root.BaixaNavigation.normalizar(root.BaixaNavigation.textoDe(label).replace(/:$/, ""));
        if (!wanted.some(name => labelText === name || labelText.startsWith(`${name} `))) continue;
        const container = label.closest("tr, [role='row'], .form-group, fieldset, li") || label.parentElement;
        const controls = [...(container?.querySelectorAll("input, select, textarea") || [])].filter(control =>
          root.BaixaNavigation.visivel(control) && control.type !== "hidden" &&
          (!editableOnly || (!control.disabled && !control.readOnly))
        );
        if (controls.length === 1) found.add(controls[0]);
      }
    }
    return [...found];
  }

  function eCampoAmarelo(control) {
    const style = control.ownerDocument?.defaultView?.getComputedStyle?.(control);
    const color = String(style?.backgroundColor || control.style?.backgroundColor || "");
    const match = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!match) return false;
    const [, red, green, blue] = match.map(Number);
    return red >= 225 && green >= 225 && blue <= 235;
  }

  function controlesTelefoneEncerramento() {
    const all = controlesParaCampoFormulario(["Telefone"]);
    const editable = all.filter(control => !control.disabled && !control.readOnly);
    const yellow = editable.filter(eCampoAmarelo);
    const controls = yellow.length === 2 || yellow.length === 3 ? yellow : editable.length === 2 ? editable : null;
    if (!controls) {
      throw new Error(`Não foi possível identificar os campos Telefone do Encerramento. Editáveis encontrados: ${editable.length}; amarelos encontrados: ${yellow.length}; esperado: 2 controles legados ou 3 controles amarelos (DDD, número e segundo telefone).`);
    }
    return [...controls].sort((first, second) => {
      const firstRect = first.getBoundingClientRect?.() || { top: 0, left: 0 };
      const secondRect = second.getBoundingClientRect?.() || { top: 0, left: 0 };
      return firstRect.top - secondRect.top || firstRect.left - secondRect.left;
    });
  }

  function valoresTelefoneParaLayout(intragov, count) {
    if (count === 2 && !intragov) return ["xx", "xx"];
    if (count === 3 && intragov) return ["00", "000000000", "xx"];
    if (count === 3 && !intragov) return ["xx", "xx", "xx"];
    if (count === 2 && intragov) {
      throw new Error("Intragov marcado, mas o primeiro Telefone não apresentou as caixas de DDD e número. Gravar Baixa cancelado.");
    }
    throw new Error(`Layout de Telefone não suportado: ${count} controles identificados.`);
  }

  function preencherTelefones(intragov) {
    const controls = controlesTelefoneEncerramento();
    const values = valoresTelefoneParaLayout(intragov, controls.length);
    const skipped = [];
    controls.forEach((control, index) => {
      if (control.disabled || control.readOnly) skipped.push(`Telefone ${index + 1}`);
      else definirValor(control, values[index], { blur: true });
    });
    return skipped;
  }

  function verificarValoresEncerramento(intragov) {
    verificar(["Descrição"], "xx");
    verificar(["Técnico"], "xx");
    verificar(["Área Técnica"], "xx");
    verificar(["Responsável"], "xx");
    const phoneControls = controlesTelefoneEncerramento();
    const expectedPhones = valoresTelefoneParaLayout(intragov, phoneControls.length);
    phoneControls.forEach((control, index) => {
      const actual = root.BaixaNavigation.normalizar(root.BaixaNavigation.valorDe(control));
      const expected = root.BaixaNavigation.normalizar(expectedPhones[index]);
      if (actual !== expected) {
        throw new Error(`Telefone ${index + 1} do Encerramento não confirmou o valor ${expectedPhones[index]} (valor atual: ${root.BaixaNavigation.valorDe(control) || "vazio"}). Gravar Baixa cancelado.`);
      }
    });
    return true;
  }

  async function aguardarValoresEncerramento(intragov, shouldStop = () => false, timeout = 3000) {
    const end = Date.now() + timeout;
    let lastError;
    while (Date.now() < end) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      try {
        verificarValoresEncerramento(intragov);
        return true;
      } catch (error) {
        lastError = error;
      }
      await root.BaixaNavigation.aguardarMudancaDom(500, shouldStop);
    }
    throw new Error(`Encerramento não confirmou todos os campos após preencher: ${lastError?.message || "valores não persistiram no formulário"}`);
  }

  function encontrarCampoCodigoBaixa(scope = null) {
    const aliases = ["Código Completo da Baixa", "Código Completo Baixa", "Código da Baixa", "Código Baixa"];
    const exact = scope ? [] : root.BaixaNavigation.controlesPara(aliases);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) throw new Error("Campo Código Completo da Baixa ambíguo.");

    const docs = scope ? [scope] : root.BaixaNavigation.documentos();
    const discovered = new Set();
    for (const doc of docs) {
      const controls = [...doc.querySelectorAll("input:not([type='hidden']), textarea, select")]
        .filter(control => root.BaixaNavigation.visivel(control));
      for (const control of controls) {
        const metadata = root.BaixaNavigation.normalizar([
          control.id, control.name, control.title, control.getAttribute("aria-label"),
          ...(control.labels ? [...control.labels].map(root.BaixaNavigation.textoDe) : [])
        ].filter(Boolean).join(" "));
        if (/codigo(?: completo)?(?: da)? baixa|baixa.*codigo/.test(metadata)) discovered.add(control);

        const row = control.closest("tr, [role='row'], .form-group, fieldset, li") || control.parentElement;
        if (!row || !root.BaixaNavigation.visivel(row)) continue;
        const rowLabel = root.BaixaNavigation.normalizar(root.BaixaNavigation.textoDe(row));
        if (!/codigo(?: completo)?(?: da)? baixa/.test(rowLabel)) continue;
        const rowControls = [...row.querySelectorAll("input:not([type='hidden']), textarea, select")]
          .filter(item => root.BaixaNavigation.visivel(item));
        if (rowControls.length === 1) discovered.add(control);
      }
    }
    const matches = [...discovered];
    if (matches.length !== 1) {
      throw new Error(`Campo Código Completo da Baixa ${matches.length ? `ambíguo (${matches.length} campos)` : "não encontrado na aba Encerramento"}.`);
    }
    return matches[0];
  }

  async function aguardarCampoCodigoBaixa(shouldStop = () => false, timeout = 7000, scope = null) {
    const end = Date.now() + timeout;
    let lastError = null;
    while (Date.now() < end) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      try { return encontrarCampoCodigoBaixa(scope); }
      catch (error) { lastError = error; }
      await root.BaixaNavigation.aguardarMudancaDom(500, shouldStop);
    }
    throw lastError || new Error("Campo Código Completo da Baixa não encontrado na aba Encerramento.");
  }

  async function preencherCodigoBaixa(code, skippedFields, search = true, shouldStop = () => false) {
    const field = encontrarCampoCodigoBaixa();
    if (!field.disabled && !field.readOnly) {
      definirValor(field, code);
      if (root.BaixaNavigation.normalizar(root.BaixaNavigation.valorDe(field)) !== root.BaixaNavigation.normalizar(code)) {
        throw new Error("O campo Código Completo da Baixa não confirmou o código inserido.");
      }
    } else {
      skippedFields.push("Código Completo da Baixa (campo controlado pelo SIGITM)");
    }
    if (search) await clicarPesquisaCodigoBaixa(code, shouldStop);
  }

  function camposTextoAcionamentoEditaveis(scope, codeField) {
    if (!scope?.querySelectorAll) throw new Error("Popup de baixa do acionamento indisponível para preencher os campos.");
    return [...scope.querySelectorAll("input, textarea")].filter(control => {
      if (control === codeField || !root.BaixaNavigation.visivel(control) || control.disabled || control.readOnly) return false;
      if (control.tagName === "TEXTAREA") return true;
      return String(control.type || "text").toLowerCase() === "text";
    });
  }

  async function aguardarJanelaAcionamento(resolveScope, shouldStop = () => false, timeout = 10000) {
    const deadline = Date.now() + timeout;
    let previousSignature = "";
    let stableSince = 0;
    let lastError = null;
    while (Date.now() < deadline) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      await root.BaixaNavigation.aguardarFimCarregamento(shouldStop, deadline);
      const scope = resolveScope();
      if (scope && root.BaixaNavigation.visivel(scope)) {
        try {
          const codeField = encontrarCampoCodigoBaixa(scope);
          const fields = camposTextoAcionamentoEditaveis(scope, codeField);
          if (fields.length) {
            const signature = [codeField.id, codeField.name, ...fields.map(control => `${control.tagName}:${control.type || "text"}:${control.id}:${control.name}`)].join("|");
            if (signature === previousSignature && Date.now() - stableSince >= 300) return { scope, codeField, fields };
            if (signature !== previousSignature) {
              previousSignature = signature;
              stableSince = Date.now();
            }
          } else {
            previousSignature = "";
          }
        } catch (error) {
          lastError = error;
          previousSignature = "";
        }
      } else {
        previousSignature = "";
      }
      await root.BaixaNavigation.aguardarMudancaDom(Math.min(150, Math.max(1, deadline - Date.now())), shouldStop);
    }
    throw lastError || new Error("Os campos do popup de baixa do acionamento não ficaram prontos após o carregamento.");
  }

  async function preencherBaixaAcionamento(code, resolveScope, shouldStop = () => false) {
    if (!String(code || "").trim()) throw new Error("Código de baixa não foi definido para o acionamento ativo.");
    if (typeof resolveScope !== "function") throw new Error("Não foi possível localizar novamente o popup de baixa do acionamento.");
    let ready = await aguardarJanelaAcionamento(resolveScope, shouldStop);
    const field = ready.codeField;
    if (field.disabled || field.readOnly) throw new Error("Código Completo da Baixa do acionamento está bloqueado para edição.");
    definirValor(field, code);
    if (root.BaixaNavigation.normalizar(root.BaixaNavigation.valorDe(field)) !== root.BaixaNavigation.normalizar(code)) {
      throw new Error("O campo Código Completo da Baixa do acionamento não confirmou o código do chamado.");
    }
    await clicarPesquisaAdjacente(field, "Código Completo da Baixa", shouldStop, ready.scope);

    ready = await aguardarJanelaAcionamento(resolveScope, shouldStop);
    const normalizedCode = root.BaixaNavigation.normalizar(code);
    if (root.BaixaNavigation.normalizar(root.BaixaNavigation.valorDe(ready.codeField)) !== normalizedCode) {
      throw new Error("O código de baixa do acionamento não permaneceu no campo após a lupa.");
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      const control = ready.fields.find(candidate => root.BaixaNavigation.normalizar(root.BaixaNavigation.valorDe(candidate)) !== "xx");
      if (!control) return true;
      definirValor(control, "xx", { blur: true });
      if (root.BaixaNavigation.normalizar(root.BaixaNavigation.valorDe(control)) !== "xx") {
        throw new Error(`Campo do popup ${control.name || control.id || "sem identificação"} não confirmou o valor xx.`);
      }
      ready = await aguardarJanelaAcionamento(resolveScope, shouldStop);
    }
    if (ready.fields.some(control => root.BaixaNavigation.normalizar(root.BaixaNavigation.valorDe(control)) !== "xx")) {
      throw new Error("Nem todos os campos editáveis do popup confirmaram xx após 30 atualizações.");
    }
    return true;
  }

  async function clicarPesquisaAdjacente(field, label, shouldStop = () => false, scope = null) {
    const fieldRect = field.getBoundingClientRect();
    const selector = "button, input[type='button'], input[type='submit'], input[type='image'], a, [role='button'], [onclick], [tabindex], img, svg, i";
    const containers = scope ? [scope] : root.BaixaNavigation.documentos();
    const candidates = containers.flatMap(container => [...container.querySelectorAll(selector)]).filter(element =>
      root.BaixaNavigation.visivel(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true"
    ).map(element => {
      const image = element.matches("img, svg, i") ? element : element.querySelector?.("img, svg, i");
      const clickable = element.matches("img, svg, i")
        ? element.closest("button, a, [role='button'], [onclick], [tabindex]") || element
        : element;
      const style = element.ownerDocument.defaultView?.getComputedStyle?.(image || element);
      const identity = root.BaixaNavigation.normalizar([
        element.id, element.name, element.className, element.value, element.title, element.alt,
        element.getAttribute("aria-label"), element.getAttribute("src"), element.getAttribute("onclick"),
        style?.backgroundImage, image?.id, image?.className, image?.src, image?.alt, image?.title,
        image?.getAttribute("src"), image?.getAttribute("onclick"), root.BaixaNavigation.textoDe(element)
      ].filter(Boolean).join(" "));
      const rect = (image || element).getBoundingClientRect();
      const adjacent = rect.left >= fieldRect.right - 12 && rect.left <= fieldRect.right + 90 &&
        Math.abs((rect.top + rect.bottom) / 2 - (fieldRect.top + fieldRect.bottom) / 2) <= 32 &&
        rect.width > 0 && rect.width <= 48 && rect.height > 0 && rect.height <= 48;
      const semantic = /lupa|buscar|pesquisar|consultar|localizar|search|lookup|magnif/.test(identity);
      return { element: clickable, semantic, adjacent, distance: Math.abs(rect.left - fieldRect.right) +
        Math.abs((rect.top + rect.bottom) / 2 - (fieldRect.top + fieldRect.bottom) / 2) };
    });
    const dedupe = items => [...new Map(items.map(item => [item.element, item])).values()];
    let unique = dedupe(candidates.filter(item => item.semantic));
    if (unique.length !== 1) unique = dedupe(candidates.filter(item => item.adjacent));
    if (unique.length > 1) {
      unique.sort((a, b) => a.distance - b.distance);
      if (unique[0].distance + 4 < unique[1].distance) unique = [unique[0]];
    }
    if (unique.length !== 1) throw new Error(`Lupa do campo ${label} ${unique.length ? "ambígua" : "não encontrada ao lado do campo"}.`);
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    await root.BaixaNavigation.clicarControle(unique[0].element, shouldStop);
    return true;
  }

  async function clicarPesquisaCodigoBaixa(code, shouldStop = () => false) {
    const field = encontrarCampoCodigoBaixa();
    if (field.disabled || field.readOnly) {
    } else {
      definirValor(field, code);
    }
    return clicarPesquisaAdjacente(field, "Código Completo da Baixa", shouldStop);
  }

  function encontrarCampoDiagnostico() {
    const discovered = new Set(controlesParaCampoFormulario(["Diagnóstico", "Diagnostico"]));
    for (const doc of root.BaixaNavigation.documentos()) {
      const controls = [...doc.querySelectorAll("input:not([type='hidden']), textarea, select")]
        .filter(control => root.BaixaNavigation.visivel(control));
      for (const control of controls) {
        const metadata = root.BaixaNavigation.normalizar([
          control.id, control.name, control.title, control.getAttribute("aria-label"),
          ...(control.labels ? [...control.labels].map(root.BaixaNavigation.textoDe) : [])
        ].filter(Boolean).join(" "));
        if (/diagnostic/.test(metadata)) discovered.add(control);
      }

      for (const label of doc.querySelectorAll("label, th, td, span, div")) {
        if (!root.BaixaNavigation.visivel(label) || root.BaixaNavigation.normalizar(root.BaixaNavigation.textoDe(label).replace(/:$/, "")) !== "diagnostico") continue;
        const labelRect = label.getBoundingClientRect?.();
        if (!labelRect) continue;
        const nearby = controls.map(control => ({ control, rect: control.getBoundingClientRect?.() }))
          .filter(item => item.rect && item.rect.left >= labelRect.right - 12 &&
            Math.abs((item.rect.top + item.rect.bottom) / 2 - (labelRect.top + labelRect.bottom) / 2) <= 34)
          .sort((first, second) => first.rect.left - second.rect.left);
        if (nearby.length === 1 || (nearby[0] && nearby[1] && nearby[0].rect.left + 12 < nearby[1].rect.left)) discovered.add(nearby[0].control);
      }
    }
    const matches = [...discovered];
    if (matches.length !== 1) throw new Error(`Campo Diagnóstico ${matches.length ? `ambíguo (${matches.length} campos)` : "não encontrado na aba Definição"}.`);
    return matches[0];
  }

  async function aguardarCampoDiagnostico(shouldStop = () => false, timeout = 7000) {
    const end = Date.now() + timeout;
    let lastError = null;
    while (Date.now() < end) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      try { return encontrarCampoDiagnostico(); }
      catch (error) { lastError = error; }
      await root.BaixaNavigation.aguardarMudancaDom(500, shouldStop);
    }
    throw lastError || new Error("Campo Diagnóstico não encontrado na aba Definição.");
  }

  async function selecionarDiagnosticoDaPesquisa(diagnosis, shouldStop = () => false, diagnosisField = null) {
    const code = String(diagnosis || "").match(/\d{8}/)?.[0];
    if (!code) throw new Error("Diagnóstico definido pelas regras não possui código de oito dígitos.");
    const wanted = root.BaixaNavigation.normalizar(code);
    const end = Date.now() + 7000;
    let candidates = [];
    while (Date.now() < end) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      candidates = root.BaixaNavigation.documentos().flatMap(doc => [...doc.querySelectorAll("a, button, input[type='button'], input[type='submit'], [role='button'], [onclick], [tabindex]")])
        .filter(element => root.BaixaNavigation.visivel(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true")
        .filter(element => root.BaixaNavigation.normalizar(root.BaixaNavigation.textoDe(element) || element.value || element.getAttribute("aria-label")) === wanted);
      candidates = [...new Set(candidates)];
      if (candidates.length === 1) break;
      if (candidates.length > 1) throw new Error(`Diagnóstico ${code} ambíguo na janela de pesquisa.`);
      await root.BaixaNavigation.aguardarMudancaDom(500, shouldStop);
    }
    if (candidates.length !== 1) throw new Error(`Diagnóstico ${code} não encontrado na janela de pesquisa.`);
    await root.BaixaNavigation.clicarControle(candidates[0], shouldStop);
    const field = diagnosisField || await aguardarCampoDiagnostico(shouldStop);
    const description = String(diagnosis).replace(code, "").trim();
    const confirmed = await aguardarValorCampo(() => {
      try { return encontrarCampoDiagnostico(); }
      catch { return field; }
    }, [code, description], 3500, shouldStop);
    if (!confirmed) throw new Error(`Diagnóstico ${code} / ${description} não foi confirmado no campo após a seleção.`);
    return true;
  }

  async function aguardarValorCampo(field, expectedParts, timeout, shouldStop) {
    const expected = (Array.isArray(expectedParts) ? expectedParts : [expectedParts])
      .map(root.BaixaNavigation.normalizar).filter(Boolean);
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      const currentField = typeof field === "function" ? field() : field;
      const actual = root.BaixaNavigation.normalizar(root.BaixaNavigation.valorDe(currentField));
      if (expected.some(value => actual.includes(value))) return true;
      await root.BaixaNavigation.aguardarMudancaDom(500, shouldStop);
    }
    return false;
  }

  async function preencherDiagnostico(decision, shouldStop = () => false) {
    if (!await root.BaixaNavigation.clicarAba("Definição", shouldStop) || shouldStop()) throw new Error("Automação interrompida.");
    const skipped = [];
    const field = await aguardarCampoDiagnostico(shouldStop);
    if (field.disabled || field.readOnly) skipped.push("Diagnóstico");
    else definirValor(field, decision.diagnostico);
    await clicarPesquisaAdjacente(field, "Diagnóstico", shouldStop);
    await selecionarDiagnosticoDaPesquisa(decision.diagnostico, shouldStop, field);
    return skipped;
  }

  async function preencherEncerramento(decision, intragov, dataReparo, shouldStop = () => false, searchBaixaCode = true) {
    const skippedFields = [];
    if (!await root.BaixaNavigation.clicarAba("Encerramento", shouldStop) || shouldStop()) throw new Error("Automação interrompida.");
    if (searchBaixaCode) {
      const field = await aguardarCampoCodigoBaixa(shouldStop);
      if (!field.disabled && !field.readOnly) {
        definirValor(field, decision.codigoBaixa);
        if (root.BaixaNavigation.normalizar(root.BaixaNavigation.valorDe(field)) !== root.BaixaNavigation.normalizar(decision.codigoBaixa)) {
          throw new Error("O campo Código Completo da Baixa não confirmou o código inserido.");
        }
      } else {
        skippedFields.push("Código Completo da Baixa (campo controlado pelo SIGITM)");
      }
      await clicarPesquisaCodigoBaixa(decision.codigoBaixa, shouldStop);
    } else {
      await preencherCodigoBaixa(decision.codigoBaixa, skippedFields, false, shouldStop);
    }
    await preencherDataReparo(dataReparo, shouldStop);
    preencherMelhorEsforco(["Descrição"], "xx", skippedFields, { blur: true });
    preencherMelhorEsforco(["Técnico"], "xx", skippedFields, { blur: true });
    preencherMelhorEsforco(["Área Técnica"], "xx", skippedFields, { blur: true });
    skippedFields.push(...preencherTelefones(intragov));
    preencherMelhorEsforco(["Responsável"], "xx", skippedFields, { blur: true });
    await aguardarValoresEncerramento(intragov, shouldStop);

    return [...new Set(skippedFields)];
  }


  function textoErroValidacao() {
    const pattern = /Validation Error:\s*Value is required/i;
    const texts = root.BaixaNavigation.documentos().flatMap(doc => {
      const body = doc.body;
      if (!body || !root.BaixaNavigation.visivel(body)) return [];
      return [root.BaixaNavigation.textoDe(body)];
    });
    return texts.find(text => pattern.test(text)) || "";
  }

  function possuiErroValidacaoObrigatorio() {
    return Boolean(textoErroValidacao());
  }

  const CERTIFICATION_ANSWERS = Object.freeze([
    { label: "Circuito é passível de gerência?", key: "circuito e passivel de gerencia", answer: "Não" },
    { label: "Medições", key: "medicoes", answer: "Não" },
    { label: "Roteador", key: "roteador", answer: "Não se aplica" },
    { label: "Gerência de Modem", key: "gerencia de modem", answer: "Não se aplica" },
    { label: "Modem Cliente", key: "modem cliente", answer: "Não se aplica" },
    { label: "TX", key: "tx", answer: "Não se aplica" },
    { label: "DG", key: "dg", answer: "Não se aplica" }
  ]);

  const CERTIFICATION_TIMING = { deadline: 10000, missingGrace: 1400, confirmation: 2500, afterAnswer: 0, settle: 0, retry: 0 };

  const cleanText = text => String(text || "").replace(/\s+/g, " ").trim();
  function nosRotuloCertificacao(doc, entries) {
    const nav = root.BaixaNavigation;
    const wanted = new Map(entries.map(entry => [nav.normalizar(entry.label), entry.label]));
    const nodes = new Map(entries.map(entry => [entry.label, new Set()]));
    const add = (node, key) => {
      const label = wanted.get(key);
      if (label) nodes.get(label).add(node);
    };

    if (typeof doc.evaluate === "function" && doc.defaultView?.XPathResult) {
      const literals = [...wanted.values()].flatMap(label => {
        const escaped = label.replace(/'/g, "&apos;");
        return [`normalizar-space(.)='${escaped}'`, `normalizar-space(.)='${escaped}:'`];
      });
      const expression = `.//*[self::label or self::th or self::td or self::span or self::div or self::b or self::strong or self::p or self::legend][not(.//input or .//select or .//textarea)][${literals.join(" or ")}]`;
      try {
        const resultado = doc.evaluate(expression, doc, null, doc.defaultView.XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let index = 0; index < resultado.snapshotLength; index++) {
          const node = resultado.snapshotItem(index);
          add(node, nav.normalizar(cleanText(nav.textoDe(node)).replace(/:$/, "")));
        }
      } catch { }
    }

    for (const node of doc.querySelectorAll("label, th, td, span, div, b, strong, p, legend")) {
      const text = nav.normalizar(cleanText(nav.textoDe(node)).replace(/:$/, ""));
      if (wanted.has(text)) add(node, text);
      for (const child of node.childNodes || []) {
        if (child.nodeType !== 3) continue;
        const directText = nav.normalizar(cleanText(child.textContent).replace(/:$/, ""));
        if (wanted.has(directText)) add(node, directText);
      }
      for (const [key, label] of wanted) {
        if (!text.startsWith(`${key} `)) continue;
        const localSelects = selecionarDescendentes(node);
        const selectedText = localSelects.length === 1
          ? nav.normalizar(localSelects[0].selectedOptions?.[0]?.textContent || localSelects[0].value || "")
          : "";
        if (selectedText && text.slice(key.length).trim() === selectedText) add(node, key);
      }
    }
    return nodes;
  }

  function selecionarDescendentes(node) {
    if (!node?.querySelectorAll) return [];
    return [...node.querySelectorAll("select")].filter(select => root.BaixaNavigation.visivel(select));
  }

  function encontrarSelecoesCertificacao(entries = CERTIFICATION_ANSWERS) {
    const nav = root.BaixaNavigation;
    const found = new Map(entries.map(entry => [entry.label, new Set()]));
    const quote = value => String(value).replace(/\\/g, "\\\\").replace(/\"/g, "\\\"");
    for (const doc of nav.documentos()) {
      for (const entry of entries) {
        const selectors = ["aria-label", "title", "name", "id"]
          .map(attribute => `select[${attribute}=\"${quote(entry.label)}\"]`);
        for (const selector of selectors) {
          for (const select of doc.querySelectorAll(selector)) if (nav.visivel(select)) found.get(entry.label).add(select);
        }
      }
      const labelsByEntry = nosRotuloCertificacao(doc, entries);
      for (const entry of entries) {
        for (const labelNode of labelsByEntry.get(entry.label) || []) {
          if (!nav.visivel(labelNode)) continue;
          if (labelNode.tagName === "LABEL" && labelNode.htmlFor) {
            const associated = doc.getElementById(labelNode.htmlFor);
            if (associated?.tagName === "SELECT" && nav.visivel(associated)) found.get(entry.label).add(associated);
          }
          const cell = labelNode.matches?.("td, th") ? labelNode : labelNode.closest?.("td, th");
          if (cell) {
            let nextCell = cell.nextElementSibling;
            for (let offset = 0; nextCell && offset < 3; offset++, nextCell = nextCell.nextElementSibling) {
              const adjacent = selecionarDescendentes(nextCell);
              if (adjacent.length === 1) { found.get(entry.label).add(adjacent[0]); break; }
              if (adjacent.length > 1) break;
            }
            const row = cell.parentElement;
            const column = [...(row?.children || [])].indexOf(cell);
            const nextRowCell = row?.nextElementSibling?.children?.[column];
            const nextRowMatches = selecionarDescendentes(nextRowCell);
            if (nextRowMatches.length === 1) found.get(entry.label).add(nextRowMatches[0]);
            const rowSelects = selecionarDescendentes(row);
            if (rowSelects.length === 1) found.get(entry.label).add(rowSelects[0]);
          }
          const localParent = labelNode.parentElement;
          if (localParent && !/^(FORM|TABLE|TBODY|THEAD|TR|BODY|HTML)$/.test(localParent.tagName)) {
            const local = selecionarDescendentes(localParent);
            if (local.length === 1) found.get(entry.label).add(local[0]);
          }
          let ancestor = labelNode.parentElement;
          for (let depth = 0; ancestor && depth < 3 && !/^(FORM|TABLE|TBODY|THEAD|TR|BODY|HTML)$/.test(ancestor.tagName); depth++, ancestor = ancestor.parentElement) {
            const local = selecionarDescendentes(ancestor);
            if (local.length === 1) { found.get(entry.label).add(local[0]); break; }
            if (local.length > 1) break;
          }
        }
      }
    }
    return new Map(entries.map(entry => {
      const controls = found.get(entry.label);
      return [entry.label, controls.size === 1
        ? { select: [...controls][0] }
        : { select: null, problem: `${entry.label}: campo ${controls.size ? `ambíguo (${controls.size} correspondências)` : "não encontrado"}` }];
    }));
  }

  function estadoSelecaoCertificacao(select, answer) {
    const nav = root.BaixaNavigation;
    const wanted = nav.normalizar(answer);
    const option = [...(select.options || [])].find(item => nav.normalizar(item.textContent || item.label || item.value || "") === wanted);
    const current = nav.normalizar(nav.valorDe(select));
    const empty = !current || /^(selecione|selecione um status|selecione o status|selecionar um status)/.test(current);
    return { option, current, empty, done: current === wanted, eligible: empty || current === "nao" || current === "nao se aplica" };
  }

  async function responderSelecaoCertificacao(select, option, shouldStop = () => false) {
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    const optionIndex = [...(select.options || [])].indexOf(option);
    if (optionIndex < 0) throw new Error("A opção da Certificação deixou de pertencer ao controle localizado.");
    const deadline = Date.now() + 2500;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        await root.BaixaNavigation.aguardarFimCarregamento(shouldStop);
        root.BaixaNavigation.garantirAcaoPronta(select);
        const view = select.ownerDocument?.defaultView;
        const nativeSetter = view?.HTMLSelectElement &&
          Object.getOwnPropertyDescriptor(view.HTMLSelectElement.prototype, "selectedIndex")?.set;
        if (nativeSetter) nativeSetter.call(select, optionIndex);
        else if ("selectedIndex" in select) select.selectedIndex = optionIndex;
        else {
          option.selected = true;
          select.value = option.value;
        }
        const EventType = view?.Event || Event;
        for (const type of ["input", "change", "blur"]) select.dispatchEvent(new EventType(type, { bubbles: true }));
        return { optionIndex, optionValue: option.value };
      } catch (error) {
        lastError = error;
        if (!/bloqueado|não está disponível|carregando|interrompida/i.test(error.message || "")) throw error;
        await root.BaixaNavigation.aguardarMudancaDom(250, shouldStop);
      }
    }
    throw lastError || new Error("O controle necessário não está disponível para ação; clique bloqueado.");
  }

  async function aguardarRespostaCertificacao(entry, attemptedOption, shouldStop = () => false) {
    const deadline = Date.now() + CERTIFICATION_TIMING.confirmation;
    let observed = "controle não localizado";
    while (Date.now() < deadline) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      await root.BaixaNavigation.aguardarFimCarregamento(shouldStop);
      const located = encontrarSelecoesCertificacao([entry]).get(entry.label);
      const select = located?.select;
      if (select && !select.disabled && !select.readOnly) {
        const state = estadoSelecaoCertificacao(select, entry.answer);
        if (state.done) return select;
        observed = root.BaixaNavigation.valorDe(select) || "(vazio)";
      } else {
        observed = located?.problem || "controle não localizado após a atualização";
      }
      const remaining = deadline - Date.now();
      if (remaining > 0) await root.BaixaNavigation.aguardarMudancaDom(Math.min(200, remaining), shouldStop);
    }
    throw new Error(`${entry.label}: alteração não foi confirmada pelo SIGITM após aguardar a atualização (opção tentada: índice ${attemptedOption.optionIndex}, valor '${attemptedOption.optionValue}'; valor observado: ${observed}).`);
  }

  async function corrigirValidacaoCertificacao(shouldStop = () => false) {
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    if (!await root.BaixaNavigation.clicarAba("Certificação", shouldStop)) {
      throw new Error("Aba Certificação não encontrada durante a validação do formulário.");
    }
    const deadline = Date.now() + CERTIFICATION_TIMING.deadline;
    const missingGraceDeadline = Math.min(deadline, Date.now() + CERTIFICATION_TIMING.missingGrace);
    let changed = 0;
    while (Date.now() < deadline) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      await root.BaixaNavigation.aguardarFimCarregamento(shouldStop);
      const fieldMap = encontrarSelecoesCertificacao();
      const fields = CERTIFICATION_ANSWERS.map(entry => ({ entry, ...fieldMap.get(entry.label) }));
      const missing = fields.filter(item => !item.select);
      const located = fields.filter(item => item.select);
      if (missing.length && Date.now() < missingGraceDeadline) {
        await root.BaixaNavigation.aguardarMudancaDom(Math.min(500, Math.max(1, deadline - Date.now())), shouldStop);
        continue;
      }
      if (!located.length) {
        return {
          changed,
          remaining: 0,
          sawRequiredStatus: false,
          checked: [],
          skipped: CERTIFICATION_ANSWERS.map(item => item.label)
        };
      }
      for (const { entry, select: initialSelect } of fields) {
        if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
        if (!initialSelect) continue;
        await root.BaixaNavigation.aguardarFimCarregamento(shouldStop);
        const located = encontrarSelecoesCertificacao([entry]).get(entry.label);
        if (!located.select) continue;
        const select = located.select;
        if (select.disabled || select.readOnly) continue;
        const state = estadoSelecaoCertificacao(select, entry.answer);
        if (state.done || !state.eligible) continue;
        if (!state.option) throw new Error(`${entry.label}: opção definida pela regra existente '${entry.answer}' não existe.`);
        const attemptedOption = await responderSelecaoCertificacao(select, state.option, shouldStop);
        changed++;
        await aguardarRespostaCertificacao(entry, attemptedOption, shouldStop);
      }
      await root.BaixaNavigation.aguardarFimCarregamento(shouldStop);
      const confirmationMap = encontrarSelecoesCertificacao();
      const unconfirmed = CERTIFICATION_ANSWERS.filter(entry => {
        const select = confirmationMap.get(entry.label).select;
        if (!select || select.disabled || select.readOnly) return false;
        const state = estadoSelecaoCertificacao(select, entry.answer);
        return state.eligible && !state.done;
      });
      if (!unconfirmed.length) {
        const skipped = CERTIFICATION_ANSWERS.filter(entry => !confirmationMap.get(entry.label).select).map(item => item.label);
        return {
          changed,
          remaining: 0,
          sawRequiredStatus: true,
          checked: CERTIFICATION_ANSWERS.filter(entry => confirmationMap.get(entry.label).select).map(item => item.label),
          skipped
        };
      }
    }
    const finalMap = encontrarSelecoesCertificacao();
    const finalFields = CERTIFICATION_ANSWERS.map(entry => ({ entry, select: finalMap.get(entry.label).select }));
    const missing = finalFields.filter(item => !item.select).map(item => item.entry.label);
    const unconfirmed = finalFields.filter(({ entry, select }) => {
      if (!select || select.disabled || select.readOnly) return false;
      const state = estadoSelecaoCertificacao(select, entry.answer);
      return state.eligible && !state.done;
    }).map(item => item.entry.label);
    if (finalFields.some(item => item.select) && !unconfirmed.length) {
      return {
        changed,
        remaining: 0,
        sawRequiredStatus: true,
        checked: finalFields.filter(item => item.select).map(item => item.entry.label),
        skipped: missing
      };
    }
    if (unconfirmed.length) {
      throw new Error(`Não foi possível confirmar os controles disponíveis da Certificação: ${unconfirmed.join(", ")}.${missing.length ? ` Campos ausentes ignorados: ${missing.join(", ")}.` : ""}`);
    }
    return {
      changed,
      remaining: unconfirmed.length,
      sawRequiredStatus: false,
      checked: finalFields.filter(item => item.select).map(item => item.entry.label),
      skipped: missing
    };
  }

  async function prepararCertificacaoParaGravar(shouldStop = () => false) {
    const certification = await corrigirValidacaoCertificacao(shouldStop);
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    if (!await root.BaixaNavigation.clicarAba("Encerramento", shouldStop)) {
      throw new Error("Não foi possível voltar à aba Encerramento após validar a Certificação.");
    }
    return certification;
  }

  const api = { possuiErroValidacaoObrigatorio, CERTIFICATION_ANSWERS, CERTIFICATION_TIMING, corrigirValidacaoCertificacao, prepararCertificacaoParaGravar, definirValor, fill, verificar, preencherMelhorEsforco, encontrarCampoDataReparo, aguardarCampoDataReparo, controlesParaCampoFormulario, eCampoAmarelo, controlesTelefoneEncerramento, valoresTelefoneParaLayout, preencherTelefones, encontrarCampoCodigoBaixa, aguardarCampoCodigoBaixa, preencherCodigoBaixa, camposTextoAcionamentoEditaveis, aguardarJanelaAcionamento, preencherBaixaAcionamento, clicarPesquisaAdjacente, clicarPesquisaCodigoBaixa, encontrarCampoDiagnostico, aguardarCampoDiagnostico, selecionarDiagnosticoDaPesquisa, preencherDiagnostico, preencherEncerramento };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaixaFormHandler = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
