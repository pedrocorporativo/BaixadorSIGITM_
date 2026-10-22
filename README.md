# Baixador SIGITM Simples

Extensão Chrome Manifest V3 para analisar e baixar **um chamado SIGITM por vez**, com regras determinísticas locais e conferência opcional pela IA **Groq**.

## Instalação

1. Abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e selecione esta pasta.
3. Abra um chamado SIGITM, escolha **Analisar sem preencher** ou **Baixar automaticamente** no popup e clique no botão principal.
4. Use **PARAR** para interromper a execução a qualquer momento.
5. Em **Configurações e histórico**, cole a chave do [Groq Console](https://console.groq.com/keys) e use **Salvar e testar Groq**. A IA é opcional.

Listas/consultas SIGITM e filas de chamados não são mais processadas. Iniciar um novo run na mesma guia substitui o anterior.

## Fluxo de baixa

Leitura das abas → classificação (regras locais + Groq em paralelo) → validação de datas/SLA → Bloquear → acionamento ativo → Baixar → Diagnóstico → Encerramento → Certificação → Gravar Baixa. Cada clique aguarda os indicadores de carregamento do SIGITM.

- Cliente SEDUC/FED sempre usa `2A011`; DDR usa `57033`; Intragov usa `6Y200`; REPETIDA + PROATIVO usa `2A082`; INICIAL + qualquer procedência ou REPETIDA + REATIVO usa `2A011`.
- Combinações sem regra perguntam o código uma vez e a escolha fica aprendida (gerenciável nas opções).
- Divergência entre a IA e as regras bloqueia a baixa; sem chave ou com falha da API, as regras locais operam sozinhas.

## IA e privacidade

Somente Tipo de Abertura, Procedência, Tipo de Incidência, Cliente, Intragov e Serviço Afetado são enviados ao Groq (`openinteligencia/gpt-oss-120b` por padrão). A chave fica em `chrome.storage.local`, sem criptografia da extensão e sem sincronização.

## Desenvolvimento

- `npm run build` gera `plano-de-fundo/service-worker.js` a partir de `plano-de-fundo/background.js` e dos módulos (`utils`, `storage`, `rules`, `ai`, `run-guard`).
- `npm test` confere o bundle e executa os testes.

## Estrutura

- `inteligencia/`: schema estruturado e cliente Groq (`ai-service.js`).
- `automacao/`: navegação, datas, formulários e baixa no content script.
- `plano-de-fundo/`: service worker (um run ativo por guia, persistido entre suspensões).
- `conteudo/`, `interface/`: controlador injetado na página e avisos.
- `regras/`, `armazenamento/`, `utilitarios/`, `painel/`, `configuracoes/`, `testes/`, `ferramentas/`.
