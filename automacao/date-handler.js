(function (root) {
  "use strict";

  function analisarData(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return new Date(value.getTime());
    const text = String(value ?? "").trim();
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/) ||
      text.match(/^(\d{4})-(\d{2})-(\d{2})$/) ||
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
      date.getHours() === hour && date.getMinutes() === minute && date.getSeconds() === second ? date : null;
  }

  function adicionarHoras(date, hours) {
    return formatarData(new Date(date.getTime() + hours * 60 * 60 * 1000));
  }

  function formatarData(resultado) {
    const pad = value => String(value).padStart(2, "0");
    return `${pad(resultado.getDate())}/${pad(resultado.getMonth() + 1)}/${resultado.getFullYear()} ${pad(resultado.getHours())}:${pad(resultado.getMinutes())}`;
  }

  function reparoDaCriacao(data) {
    const creation = analisarData(data.dataCriacao);
    return creation ? adicionarHoras(creation, 2) : "";
  }

  function pontoMedioEntreDatas(startValue, endValue) {
    const start = analisarData(startValue);
    const end = analisarData(endValue);
    if (!start || !end || end.getTime() - start.getTime() < 2 * 60 * 1000) return "";
    const midpoint = new Date(Math.floor(((start.getTime() + end.getTime()) / 2) / 60000) * 60000);
    return midpoint.getTime() > start.getTime() && midpoint.getTime() < end.getTime() ? formatarData(midpoint) : "";
  }

  function validarDatas(data) {
    const creation = analisarData(data.dataCriacao);
    const objective = analisarData(data.dataObjetivo);
    const originalRepair = analisarData(data.dataReparoOriginal);
    if (!creation) return { valid: false, reason: "Data Criação não identificada ou inválida; não é possível calcular Data de Reparo + 1 hora." };
    let repair = analisarData(adicionarHoras(creation, 1));
    const clockPaused = root.BaixaHelpers.normalizarTexto(data.paradaRelogio) === "sim";
    const pause = analisarData(data.dataParadaRelogio);
    const pauseEnd = analisarData(data.dataFimParadaRelogio);
    if (!repair) return { valid: false, reason: "Não foi possível calcular Data de Reparo + 1 hora." };
    const invalid = reason => ({
      valid: false, reason, repair, repairValue: formatarData(repair), originalRepair, objective, pause, pauseEnd,
      slaEnd: new Date(creation.getTime() + 4 * 60 * 60 * 1000)
    });
    if (clockPaused && !pauseEnd) return { valid: false, reason: "Parada de Relógio está ativa, mas o fim da parada não foi identificado ou é inválido.", originalRepair, objective, pause };
    if (clockPaused) repair = new Date(pauseEnd.getTime() + 60 * 1000);
    const slaEnd = new Date(creation.getTime() + 4 * 60 * 60 * 1000);
    if (repair.getTime() <= creation.getTime()) return invalid("Data de Reparo deve ser posterior à Data Criação.");
    if (clockPaused) {
      const warnings = [];
      if (!objective) warnings.push("Data Objetivo não identificada; não foi possível comparar o horário calculado.");
      else if (repair.getTime() >= objective.getTime()) {
        warnings.push(`Data calculada posterior à Data Objetivo (${formatarData(objective)}).`);
      }
      if (repair.getTime() > slaEnd.getTime()) warnings.push(`Data calculada excede o SLA de 4 horas (${formatarData(slaEnd)}).`);
      return { valid: true, repair, repairValue: formatarData(repair), originalRepair, objective, pause, pauseEnd, slaEnd, warnings };
    }
    if (!objective) return invalid("Data Objetivo não identificada ou inválida.");
    if (repair.getTime() >= objective.getTime()) return invalid("Data de Reparo deve ser anterior à Data Objetivo.");
    if (repair.getTime() > slaEnd.getTime()) return invalid("Data de Reparo excede o SLA de 4 horas.");
    return { valid: true, repair, repairValue: formatarData(repair), originalRepair, objective, pause, pauseEnd, slaEnd, warnings: [] };
  }

  const api = { analisarData, adicionarHoras, formatarData, reparoDaCriacao, pontoMedioEntreDatas, validarDatas };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaixaDateHandler = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
