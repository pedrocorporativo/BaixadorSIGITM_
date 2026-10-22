(function (root) {
  "use strict";
  const NOTICE_STORAGE_KEY = "baixaPersistentNotice";
  const NOTICE_STORAGE_PREFIX = "baixaPersistentNotice:";
  let shownSinceLoad = false;

  function chaveAvisoPagina() {
    return `${NOTICE_STORAGE_PREFIX}${location.origin}${location.pathname}?${new URLSearchParams(location.search).get("idConsulta") || ""}`;
  }

  function salvarAviso(value) {
    try { sessionStorage.setItem(NOTICE_STORAGE_KEY, JSON.stringify(value)); }
    catch { }
    try { chrome.storage.local.set({ [chaveAvisoPagina()]: value }); }
    catch { }
  }

  function limparAviso() {
    try { sessionStorage.removeItem(NOTICE_STORAGE_KEY); }
    catch { }
    try { chrome.storage.local.remove(chaveAvisoPagina()); }
    catch { }
  }

  function metadadosAviso(message, type) {
    const text = String(message || "").toLowerCase();
    if (type === "error") return { phase: "Atenção necessária", badge: "PAUSADO" };
    if (text.includes("certificação") || text.includes("certificacao")) return { phase: "Corrigindo Certificação", badge: "ETAPA EXTRA" };
    if (text.includes("gravar baixa")) return { phase: "Finalizando baixa", badge: "EM ANDAMENTO" };
    if (text.includes("ticket liberado") || text.includes("tiquete liberado")) return { phase: "Baixa confirmada", badge: "CONCLUÍDO" };
    if (type === "success") return { phase: "Etapa concluída", badge: "CONCLUÍDO" };
    return { phase: "Automação em andamento", badge: "PROCESSANDO" };
  }

  function mostrar(message, type = "info", expiresAt = 0) {
    shownSinceLoad = true;
    const defaultDuration = type === "error" ? 60000 : type === "success" ? 12000 : 45000;
    const finalExpiresAt = Number(expiresAt) > Date.now() ? Number(expiresAt) : Date.now() + defaultDuration;
    const hostId = "sigitm-baixa-notice";
    let host = document.getElementById(hostId);
    if (!host) {
      host = document.createElement("div");
      host.id = hostId;
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `<style>
        :host{all:initial;position:fixed;right:18px;top:18px;z-index:2147483647;font-family:system-ui,sans-serif;color-scheme:dark}
        .box{width:min(560px,calc(100vw - 36px));max-height:88vh;display:grid;grid-template-rows:auto minmax(0,1fr);gap:10px;padding:14px;border:1px solid #574b17;border-left:4px solid #ffd52a;border-radius:12px;background:#171819;color:#f7f7f2;box-shadow:0 8px 26px #0007;font-size:14px}
        .box[data-type=error]{border-color:#793b36;border-left-color:#ff625c}.box[data-type=success]{border-color:#4d622d;border-left-color:#71d68d}
        .heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.title{display:flex;align-items:center;gap:10px;min-width:0;color:#ffd52a}.title-copy{display:grid;gap:1px;min-width:0}.eyebrow{font:700 10px/1.1 system-ui,sans-serif;letter-spacing:.09em;color:#c7c7c0}.phase{font:800 15px/1.25 system-ui,sans-serif}.brand-icon{display:block;width:36px;height:36px;flex:0 0 36px;border-radius:50%;background:radial-gradient(circle at 30% 25%,#1d2478,#0b0f45 70%);box-shadow:0 0 0 2px #ffd52a66;object-fit:contain;padding:3px}.header-actions{display:flex;align-items:center;gap:8px}.badge{flex:0 0 auto;padding:4px 7px;border:1px solid #ffd52a66;border-radius:999px;color:#ffd52a;font:800 10px/1 system-ui,sans-serif;letter-spacing:.06em}.box[data-type=error] .phase,.box[data-type=error] .badge{color:#ff8b84;border-color:#ff8b8466}.box[data-type=success] .phase,.box[data-type=success] .badge{color:#91e8a8;border-color:#91e8a866}
        .message{max-height:70vh;overflow:auto;margin:0;padding:10px;border-radius:8px;background:#101112;color:#fff;font:14px/1.55 system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}
        button{display:grid;place-items:center;width:30px;height:30px;border:1px solid #4a4b4d;border-radius:7px;padding:0;background:#242628;color:#fff;font:22px/1 system-ui,sans-serif;cursor:pointer}button:hover{border-color:#ffd52a;color:#ffd52a}button:focus-visivel{outline:2px solid #ffd52a;outline-offset:2px}
      </style>
      <section class="box" data-expanded="false" role="status" aria-live="polite">
        <div class="heading"><div class="title"><img class="brand-icon" alt="Logo do Baixador Automático" /><div class="title-copy"><span class="eyebrow">BAIXADOR AUTOMÁTICO V3</span><strong class="phase"></strong></div></div><div class="header-actions"><span class="badge"></span><button class="close" type="button" aria-label="Fechar aviso" title="Fechar">×</button></div></div>
        <pre class="message"></pre>
      </section>`;
      const brandIcon = shadow.querySelector(".brand-icon");
      if (brandIcon && typeof chrome !== "undefined" && chrome.runtime?.getURL) brandIcon.src = chrome.runtime.getURL("icones/sigitm-v2-48.png");
      const box = shadow.querySelector(".box");
      shadow.querySelector(".close").addEventListener("click", () => {
        if (host._noticeTimer) clearTimeout(host._noticeTimer);
        limparAviso();
        host.remove();
      });
      document.documentElement.appendChild(host);
    }
    const box = host.shadowRoot?.querySelector(".box");
    if (box) {
      box.dataset.type = type;
      box.setAttribute("role", type === "error" ? "alert" : "status");
      const meta = metadadosAviso(message, type);
      box.querySelector(".phase").textContent = meta.phase;
      box.querySelector(".badge").textContent = meta.badge;
      box.querySelector(".message").textContent = String(message || "");
      if (host._noticeTimer) clearTimeout(host._noticeTimer);
      const notice = { message: String(message || ""), type, expiresAt: finalExpiresAt };
      salvarAviso(notice);
      const remaining = Math.max(0, finalExpiresAt - Date.now());
      host._noticeTimer = setTimeout(() => {
        limparAviso();
        host.remove();
      }, remaining);
    }
  }

  function restaurar() {
    if (typeof window !== "undefined" && window.top !== window) return;
    if (document.getElementById("sigitm-baixa-notice")) return;
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.get(chaveAvisoPagina(), stored => {
          if (shownSinceLoad || document.getElementById("sigitm-baixa-notice")) return;
          const saved = stored?.[chaveAvisoPagina()];
          if (saved && typeof saved.message === "string" && Number(saved.expiresAt) > Date.now()) {
            mostrar(saved.message, saved.type || "info", Number(saved.expiresAt));
          }
        });
      }
    } catch { }
    if (shownSinceLoad || document.getElementById("sigitm-baixa-notice")) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(NOTICE_STORAGE_KEY) || "null");
      if (saved && typeof saved.message === "string" && Number(saved.expiresAt) > Date.now()) {
        mostrar(saved.message, saved.type || "info", Number(saved.expiresAt));
      }
    } catch { }
  }

  const api = { mostrar, restaurar };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaixaNotifications = api;
  restaurar();
})(typeof globalThis !== "undefined" ? globalThis : this);
