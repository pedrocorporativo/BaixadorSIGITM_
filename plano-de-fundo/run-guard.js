(function (root) {
  "use strict";

  function autorizarExecucao({ tabId, runId, persistentRun, memoryRun, stopRequested = false, hasOtherActiveRun = false }) {
    if (!runId) return { allowed: false, reason: "ID da execução ausente." };

    const memoryMatches = memoryRun?.runId === runId;
    const storageMatches = persistentRun?.tabId === tabId && persistentRun?.runId === runId;

    if (memoryMatches && memoryRun.controller?.signal?.aborted) {
      return { allowed: false, reason: "A automação foi interrompida." };
    }
    if (storageMatches && persistentRun.stopped) {
      return { allowed: false, reason: "A automação foi interrompida." };
    }
    if (storageMatches) return { allowed: true, repairStorage: false, source: "storage" };

    if (memoryMatches && !memoryRun.controller?.signal?.aborted) {
      if (stopRequested) return { allowed: false, reason: "A automação foi interrompida." };
      return { allowed: true, repairStorage: true, source: "memory" };
    }

    if (persistentRun?.tabId === tabId && persistentRun.runId !== runId && !persistentRun.stopped) {
      return { allowed: false, reason: "Esta solicitação foi substituída por uma execução mais recente." };
    }

    if (!persistentRun && !memoryRun && !stopRequested) {
      return { allowed: true, repairStorage: true, source: "recovered-request" };
    }

    return { allowed: false, reason: "A execução não está ativa ou foi interrompida." };
  }

  const api = { autorizarExecucao };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaixaRunGuard = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
