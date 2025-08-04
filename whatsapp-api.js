const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const http = require("http");
const path = require("path");
const dotenv = require("dotenv");
const crypto = require("crypto");

// Carrega vari�veis de ambiente
dotenv.config();

// Configura��es de seguran�a
const API_TOKEN =
  process.env.API_TOKEN || crypto.randomBytes(32).toString("hex");
const requestLog = {};

// Se o token foi gerado automaticamente, mostra para o usu�rio
if (!process.env.API_TOKEN) {
  console.log("?? Nenhum token API configurado no arquivo .env");
  console.log(`?? Token gerado automaticamente: ${API_TOKEN}`);
  console.log(
    "?? Recomendamos adicionar este token ao seu arquivo .env como API_TOKEN"
  );
}

// Fun��o para encontrar o execut�vel do Chrome
function findChrome() {
  // Seus caminhos espec�ficos encontrados
  const possiblePaths = [
    "/usr/bin/google-chrome-stable", // Prioridade 1 - Chrome est�vel
    "/usr/bin/google-chrome", // Prioridade 2 - Chrome gen�rico
    "/usr/bin/chromium-browser", // Prioridade 3 - Chromium browser
    "/snap/bin/chromium", // Prioridade 4 - Chromium snap
  ];

  for (const chromePath of possiblePaths) {
    if (fs.existsSync(chromePath)) {
      console.log(`? Navegador encontrado em: ${chromePath}`);
      return chromePath;
    }
  }

  console.log("?? Nenhum navegador encontrado nos caminhos detectados");
  return null;
}

// Configura��o do Puppeteer otimizada para seu sistema
const puppeteerConfig = {
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    "--no-zygote",
    "--disable-gpu",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=TranslateUI",
    "--disable-web-security",
    "--disable-extensions",
  ],
  headless: true, // For�a modo headless para servidor
};

// Tenta encontrar o Chrome instalado
const chromePath = findChrome();
if (chromePath) {
  puppeteerConfig.executablePath = chromePath;
}

// Inicializa o cliente WhatsApp
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: puppeteerConfig,
});

// Evento de gera��o de QR Code
client.on("qr", (qr) => {
  console.log("?? QR Code gerado. Escaneie com seu WhatsApp:");
  qrcode.generate(qr, { small: true });
});

// Evento de autentica��o
client.on("authenticated", () => {
  console.log("? Autenticado com sucesso!");
});

// Evento de pronto
client.on("ready", () => {
  console.log("?? Cliente WhatsApp est� pronto e conectado!");
  startServer();
});

// Evento de desconex�o
client.on("disconnected", (reason) => {
  console.log("?? Cliente desconectado:", reason);
});

// Inicializa o cliente
console.log("?? Inicializando cliente WhatsApp...");
client.initialize().catch((err) => {
  console.error("? Erro ao inicializar o cliente WhatsApp:", err);
  console.log("?? Dicas para resolver:");
  console.log("1. Execute: npm install");
  console.log("2. Instale o Chrome: sudo apt-get install google-chrome-stable");
  console.log(
    "3. Ou instale o Chromium: sudo apt-get install chromium-browser"
  );
  process.exit(1);
});

// Fun��o para verificar se a requisi��o vem do localhost
function isLocalRequest(req) {
  const ip = req.socket.remoteAddress;
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

// Fun��o para verificar limite de requisi��es
function checkRateLimit(ip) {
  const now = Date.now();
  const minute = Math.floor(now / 60000);

  if (!requestLog[minute]) {
    // Limpa logs antigos para evitar vazamento de mem�ria
    Object.keys(requestLog).forEach((key) => {
      if (parseInt(key) < minute) {
        delete requestLog[key];
      }
    });
    requestLog[minute] = {};
  }

  requestLog[minute][ip] = (requestLog[minute][ip] || 0) + 1;
  return requestLog[minute][ip] <= MAX_REQUESTS_PER_MINUTE;
}

// Registra uma tentativa de acesso n�o autorizada
function logSecurityEvent(type, ip, details) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    type,
    ip,
    details,
  };

  console.error(`?? [SEGURAN�A] ${type} - IP: ${ip} - ${details}`);

  // Opcionalmente, salva em um arquivo de log
  const logDir = path.join(__dirname, "logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  fs.appendFileSync(
    path.join(logDir, "security.log"),
    JSON.stringify(logEntry) + "\n"
  );
}

// Fun��o para processar as requisi��es da API
function startServer() {
  const server = http.createServer((req, res) => {
    const clientIp = req.socket.remoteAddress;

    // Verifica se a requisi��o � local
    if (!isLocalRequest(req)) {
      logSecurityEvent(
        "ACESSO_REMOTO_BLOQUEADO",
        clientIp,
        "Tentativa de acesso de IP n�o local"
      );
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ success: false, error: "Acesso n�o autorizado" })
      );
      return;
    }

    if (req.method === "POST") {
      // Verifica o token de autentica��o
      const authToken = req.headers["x-api-token"] || "";
      if (authToken !== API_TOKEN) {
        logSecurityEvent(
          "TOKEN_INV�LIDO",
          clientIp,
          "Token de API inv�lido ou ausente"
        );
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: "Token de autentica��o inv�lido",
          })
        );
        return;
      }

      // Verifica o tamanho m�ximo do corpo (1MB)
      let size = 0;
      const MAX_SIZE = 1 * 1024 * 1024; // 1MB
      let body = "";

      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_SIZE) {
          logSecurityEvent(
            "TAMANHO_EXCEDIDO",
            clientIp,
            "Corpo da requisi��o muito grande"
          );
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: "Corpo da requisi��o muito grande",
            })
          );
          req.destroy();
        } else {
          body += chunk.toString();
        }
      });

      req.on("end", async () => {
        if (size > MAX_SIZE) return; // J� foi rejeitado

        try {
          // Sanitizar e validar JSON
          let data;
          try {
            data = JSON.parse(body);
          } catch (e) {
            throw new Error("JSON inv�lido");
          }

          console.log("?? Requisi��o recebida de localhost");

          // Valida os dados recebidos
          if (!data.groupId) {
            throw new Error("ID do grupo n�o fornecido");
          }

          if (!data.message) {
            throw new Error("Mensagem n�o fornecida");
          }

          // Tipo 1: Checkpoint (com imagem)
          // Tipo 2: Alertas (apenas texto)
          if (!data.tipo || ![1, 2].includes(data.tipo)) {
            throw new Error(
              "Tipo de envio inv�lido (deve ser 1 para checkpoint ou 2 para alertas)"
            );
          }

          // Envia a mensagem
          if (data.tipo === 1) {
            // Checkpoint (com imagem)
            if (!data.imagePath) {
              throw new Error(
                "Caminho da imagem n�o fornecido para tipo checkpoint"
              );
            }

            // Verifica se a imagem existe
            if (!fs.existsSync(data.imagePath)) {
              throw new Error(`Imagem n�o encontrada: ${data.imagePath}`);
            }

            // Envia a imagem com a mensagem
            const media = MessageMedia.fromFilePath(data.imagePath);
            await client.sendMessage(data.groupId, media, {
              caption: data.message,
            });
            console.log(`? Checkpoint enviado para ${data.groupId}`);
          } else {
            // Alertas (apenas texto)
            await client.sendMessage(data.groupId, data.message);
            console.log(`? Alerta enviado para ${data.groupId}`);
          }

          // Responde ao cliente
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              message: "Mensagem enviada com sucesso",
              timestamp: new Date().toISOString(),
            })
          );
        } catch (error) {
          console.error("?? Erro ao processar requisi��o:", error);
          logSecurityEvent(
            "ERRO_PROCESSAMENTO",
            clientIp,
            `Erro: ${error.message}`
          );

          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: error.message,
              timestamp: new Date().toISOString(),
            })
          );
        }
      });
    } else if (req.method === "GET") {
      // Verifica o token para requisi��es GET de status tamb�m
      const authToken = req.headers["x-api-token"] || "";
      if (authToken !== API_TOKEN) {
        logSecurityEvent(
          "TOKEN_INV�LIDO_STATUS",
          clientIp,
          "Token inv�lido em requisi��o de status"
        );
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: "Token de autentica��o inv�lido",
          })
        );
        return;
      }

      // Para requisi��es GET, retorna informa��o sobre o status
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          status: "online",
          whatsapp: client.info ? "connected" : "disconnected",
          timestamp: new Date().toISOString(),
          server: {
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage().rss / 1024 / 1024 + " MB",
          },
        })
      );
    } else {
      // M�todo n�o permitido
      logSecurityEvent(
        "M�TODO_N�O_PERMITIDO",
        clientIp,
        `M�todo: ${req.method}`
      );
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "M�todo n�o permitido",
        })
      );
    }
  });

  // Adiciona cabe�alhos de seguran�a a todas as respostas
  server.on("request", (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    res.setHeader("Server", "WhatsApp API");
  });

  // Define a porta em que o servidor ir� escutar (apenas em localhost)
  const PORT = process.env.API_PORT || 3241;
  const HOST = "127.0.0.1"; // For�a o servidor a escutar apenas em localhost

  server.listen(PORT, HOST, () => {
    console.log(
      `?? API WhatsApp rodando em ${HOST}:${PORT} (apenas acesso local)`
    );
    console.log("?? Seguran�a: Verifica��o de tokens ativada");
    console.log("?? Limite de requisi��es: Desativado");
  });
}

// Captura erros n�o tratados
process.on("uncaughtException", (err) => {
  console.error("?? Erro n�o tratado:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("?? Promessa rejeitada n�o tratada:", reason);
});
