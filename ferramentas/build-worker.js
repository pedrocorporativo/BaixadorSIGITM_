#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const base = path.join(__dirname, "..");
const MODULES = [
  "utilitarios/helpers.js",
  "armazenamento/storage.js",
  "regras/baixa-rules.js",
  "regras/validation.js",
  "inteligencia/ai-schema.js",
  "inteligencia/ai-service.js",
  "plano-de-fundo/run-guard.js"
];
const MAIN = "plano-de-fundo/background.js";
const OUTPUT = "plano-de-fundo/service-worker.js";

const read = file => fs.readFileSync(path.join(base, file), "utf8").replace(/\r\n/g, "\n");

function montarPacote() {
  const parts = MODULES.map(file => `\n${read(file).replace(/\n+$/, "")}\n`);
  const main = read(MAIN).replace(/importScripts\([\s\S]*?\);\s*/, "");
  parts.push(`\n${main.replace(/^\s+/, "")}`);
  return parts.join("\n");
}

function main() {
  const bundle = montarPacote();
  const target = path.join(base, OUTPUT);
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") : "";
    if (current !== bundle) {
      console.error(`${OUTPUT} está desatualizado. Execute: npm run build`);
      process.exitCode = 1;
    } else {
      console.log(`${OUTPUT} está sincronizado.`);
    }
    return;
  }
  fs.writeFileSync(target, bundle);
  console.log(`${OUTPUT} gerado (${bundle.length} bytes).`);
}

if (require.main === module) main();
module.exports = { montarPacote, MODULES };
