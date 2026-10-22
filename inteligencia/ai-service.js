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
