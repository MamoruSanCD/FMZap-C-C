const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

// Função para encontrar o navegador instalado automaticamente
function findBrowser() {
  const platform = os.platform();

  // Lista de caminhos possíveis para cada sistema operacional
  const browserPaths = {
    win32: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      path.join(
        os.homedir(),
        "AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"
      ),
      "C:\\Program Files\\Chromium\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe",
    ],
    linux: [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/snap/bin/chromium",
      "/snap/bin/google-chrome",
      "/opt/google/chrome/chrome",
      "/usr/bin/chrome",
      "/usr/bin/chrome-browser",
    ],
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ],
  };

  // Verificar caminhos padrão
  for (const browserPath of browserPaths[platform] || []) {
    if (fs.existsSync(browserPath)) {
      return browserPath;
    }
  }

  // Tentar encontrar via comando 'which' (Linux/Mac)
  if (platform === "linux" || platform === "darwin") {
    try {
      const chromePath = execSync("which google-chrome", {
        encoding: "utf8",
      }).trim();
      if (chromePath && fs.existsSync(chromePath)) {
        return chromePath;
      }
    } catch (e) {
      // Ignora erro se o comando não encontrar
    }

    try {
      const chromiumPath = execSync("which chromium-browser", {
        encoding: "utf8",
      }).trim();
      if (chromiumPath && fs.existsSync(chromiumPath)) {
        return chromiumPath;
      }
    } catch (e) {
      // Ignora erro se o comando não encontrar
    }

    try {
      const chromiumPath = execSync("which chromium", {
        encoding: "utf8",
      }).trim();
      if (chromiumPath && fs.existsSync(chromiumPath)) {
        return chromiumPath;
      }
    } catch (e) {
      // Ignora erro se o comando não encontrar
    }
  }

  // Tentar encontrar via variável de ambiente
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  return null;
}

// Configuração do cliente
const browserPath = findBrowser();
if (browserPath) {
  console.log(`✅ Usando navegador em: ${browserPath}`);
} else {
  console.log(
    "⚠️  Navegador não encontrado, tentando usar o Chromium interno..."
  );
}

const puppeteerConfig = {
  headless: "new",
  executablePath: browserPath || undefined, // undefined = usa o Chromium interno (se disponível)
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-web-security",
    "--disable-features=VizDisplayCompositor",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    "--metrics-recording-only",
    "--mute-audio",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-extensions",
    "--disable-default-apps",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-field-trial-config",
    "--disable-ipc-flooding-protection",
  ],
  timeout: 60000,
  protocolTimeout: 60000,
};

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: puppeteerConfig,
});

// Função para salvar os chats em arquivo .txt
async function saveChatsToFile(chats) {
  const fileName = `lista_chats_${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
  const filePath = path.join(__dirname, fileName);

  try {
    let content = "📜 Lista de Chats do WhatsApp\n";
    content += "Gerado em: " + new Date().toLocaleString() + "\n\n";

    content += "----------------------------------------\n";
    chats.forEach((chat, index) => {
      content += `${index + 1}. Nome: "${chat.name}"\n`;
      content += `   ID: ${chat.id._serialized}\n`;
      content += "----------------------------------------\n";
    });
    content += `\nTotal de chats encontrados: ${chats.length}`;

    fs.writeFileSync(filePath, content);
    console.log(`\n💾 Lista salva em: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error("❌ Erro ao salvar arquivo:", error);
    return null;
  }
}

// Tratamento de eventos
client.on("qr", (qr) => {
  console.log("Escaneie o QR Code abaixo para autenticar:");
  qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => {
  console.log("✅ Autenticação bem sucedida!");
});

client.on("auth_failure", (msg) => {
  console.error("❌ Falha na autenticação:", msg);
});

client.on("ready", async () => {
  console.log("✅ Bot conectado! Buscando os chats disponíveis...");

  try {
    // Aguarda um tempo para carregar os chats
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const chats = await client.getChats();

    // Exibe no console
    console.log("\n📜 Lista de chats disponíveis:");
    console.log("----------------------------------------");
    chats.forEach((chat, index) => {
      console.log(`${index + 1}. Nome: "${chat.name}"`);
      console.log(`   ID: ${chat.id._serialized}`);
      console.log("----------------------------------------");
    });
    console.log(`\nTotal de chats encontrados: ${chats.length}`);

    // Salva em arquivo
    const savedFilePath = await saveChatsToFile(chats);
    if (savedFilePath) {
      console.log("✅ Lista salva com sucesso!");
    }
  } catch (error) {
    console.error("❌ Erro ao buscar chats:", error);
  } finally {
    console.log("⏳ Encerrando a sessão...");
    await client.destroy();
    console.log("✅ Sessão encerrada com sucesso!");
  }
});

// Tratamento de erros globais
client.on("disconnected", (reason) => {
  console.log("❌ Cliente desconectado:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("❌ Erro não tratado:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Promessa rejeitada não tratada:", reason);
});

// Inicia o cliente
console.log("⏳ Inicializando o bot...");
client.initialize().catch((err) => {
  console.error("❌ Falha na inicialização:", err);

  // Mensagens de ajuda específicas
  if (
    err.message.includes("Failed to launch the browser process") ||
    err.message.includes("Could not find expected browser")
  ) {
    console.log("\n💡 Dicas para solução:");
    console.log("1. Instale o Chrome ou Chromium:");
    console.log("   Linux: sudo apt install chromium-browser");
    console.log("   Linux: sudo apt install google-chrome-stable");
    console.log("   Windows: Baixe do site oficial do Google Chrome");
    console.log("   Mac: brew install --cask google-chrome");
    console.log("");
    console.log("2. Ou defina o caminho manualmente no código:");
    console.log('   executablePath: "CAMINHO_DO_SEU_CHROME"');
    console.log("");
    console.log("3. Caminhos comuns:");
    console.log("   Linux: /usr/bin/google-chrome, /usr/bin/chromium-browser");
    console.log(
      "   Windows: C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    );
    console.log(
      "   Mac: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    );
    console.log("");
    console.log("4. Ou use o Chromium interno (mais lento):");
    console.log("   npm install puppeteer");
  } else if (err.message.includes("ENOENT")) {
    console.log(
      "\n💡 Erro de arquivo não encontrado. Verifique se o Chrome está instalado."
    );
  } else if (
    err.message.includes("Protocol error") ||
    err.message.includes("Session closed")
  ) {
    console.log("\n💡 Erro de protocolo/sessão. Tentando soluções:");
    console.log("1. Feche todas as instâncias do Chrome");
    console.log("2. Reinicie o computador");
    console.log("3. Tente usar modo não-headless:");
    console.log("   headless: false");
    console.log("4. Ou reinstale as dependências:");
    console.log("   npm install");
  } else {
    console.log("\n💡 Erro desconhecido. Tente reinstalar as dependências:");
    console.log("   npm install");
  }
});
