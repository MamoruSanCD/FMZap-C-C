/**
 * APIs importadas para a execu��o do c�digo
 */
require('module').globalPaths.push('../../node_modules');
const os = require('os');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const http = require('http');
const dotenv = require('dotenv');

// Carrega as vari�veis de ambiente do arquivo .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Configura��es do Zabbix
 */
const ZABBIX_LOGIN_URL = process.env.ZABBIX_Camp_URL;
const URL_BASE = ZABBIX_LOGIN_URL.replace('/index.php', '');
const URL_DASHBOARD = `${URL_BASE}/zabbix.php?show=3&name=&severities%5B4%5D=4&severities%5B5%5D=5&acknowledgement_status=0&inventory%5B0%5D%5Bfield%5D=type&inventory%5B0%5D%5Bvalue%5D=&evaltype=0&tags%5B0%5D%5Btag%5D=appvendor&tags%5B0%5D%5Boperator%5D=2&tags%5B0%5D%5Bvalue%5D=mssqlserver&show_tags=3&tag_name_format=0&tag_priority=&show_opdata=0&filter_name=&filter_show_counter=0&filter_custom_time=0&sort=host&sortorder=ASC&age_state=0&show_symptoms=0&show_suppressed=0&acknowledged_by_me=0&compact_view=0&show_timeline=0&details=0&highlight_row=0&action=problem.view`;
const USERNAME = process.env.ZABBIX_Camp_USERNAME;
const PASSWORD = process.env.ZABBIX_Camp_PASSWORD;

/**
 * Configura��es do WhatsApp
 */
const chatId = process.env.WHATSAPP_GRUPO_Camp; // Grupo do cliente para envio de alertas
const controleNumber = process.env.WHATSAPP_GRUPO_CONTROLE; // Grupo interno para aviso em caso de massiva

/**
 * Vari�veis globais e cache
 */
let cacheFile = path.join(__dirname, 'cache_Camp.json'); // Nome espec�fico do cache
const MIN_DURATION = 2; // minutos
const MAX_DURATION = 7; // minutos

/**
 * Fun��o para enviar mensagem para a API WhatsApp
 */
async function enviarParaApi(data) {
    return new Promise((resolve, reject) => {
        const jsonData = JSON.stringify(data);

        // Obt�m o token da API do arquivo .env
        const apiToken = process.env.API_TOKEN;

        const options = {
            hostname: 'localhost',
            port: 3241,
            path: '/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(jsonData),
                'X-API-Token': apiToken // Adiciona o token no cabe�alho
            }
        };

        const req = http.request(options, (res) => {
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;
            });

            res.on('end', () => {
                try {
                    const response = JSON.parse(responseData);
                    if (response.success) {
                        resolve(response);
                    } else {
                        reject(new Error(response.error || 'Erro ao enviar mensagem'));
                    }
                } catch (error) {
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.write(jsonData);
        req.end();
    });
}

/**
 * Fun��o para carregar o cache de alertas j� enviados
 */
function loadCache() {
    if (fs.existsSync(cacheFile)) {
        try {
            const data = fs.readFileSync(cacheFile, 'utf8');
            return JSON.parse(data);
        } catch (err) {
            console.error('Erro ao ler o cache:', err);
            return [];
        }
    } else {
        return [];
    }
}

/**
 * Fun��o para salvar o cache atualizado
 */
function saveCache(cache) {
    try {
        fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
    } catch (err) {
        console.error('Erro ao salvar o cache:', err);
    }
}

/**
 * Fun��o para envio de mensagens
 */
function enqueueMessage({ chatId, message }) {
    enviarParaApi({
        groupId: chatId,
        message: message,
        tipo: 2
    })
        .then(() => console.log(`Mensagem enviada para ${chatId}`))
        .catch(err => console.error(`Erro ao enviar mensagem para ${chatId}:`, err));
}

/**
 * Fun��o para fazer login no Zabbix e retornar a p�gina autenticada
 */
async function loginZabbix(browser) {
    console.log('?? Realizando login no Zabbix...');
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.goto(ZABBIX_LOGIN_URL, { waitUntil: 'networkidle0' });
        await page.type('#name', USERNAME);
        await page.type('#password', PASSWORD);
        await Promise.all([
            page.click('#enter'),
            page.waitForNavigation({ waitUntil: 'networkidle0' })
        ]);
        console.log('? Login no Zabbix realizado com sucesso.');
        return page;
    } catch (error) {
        console.error('? Falha ao conectar ao Zabbix.');
        throw error;
    }
}

/**
 * Fun��o para verificar a conex�o com o Zabbix e retornar a p�gina autenticada
 */
async function checkZabbixConnection(browser) {
    console.log('?? Verificando conex�o com o Zabbix...');
    try {
        const page = await loginZabbix(browser);
        console.log('? Conex�o com o Zabbix bem-sucedida.');
        return page;
    } catch (error) {
        console.error('? Falha ao conectar ao Zabbix.');
        const message = "? Houve problemas ao tentar conectar no Zabbix (Prov�vel queda de VPN).\nCancelado a execu��o do script. Recomendado a an�lise do Analista!";
        enqueueMessage({ chatId: controleNumber, message });
        console.log('?? Erro de conex�o com o Zabbix detectado. Enviando mensagem e interrompendo execu��o.');
        return null;
    }
}

/**
 * Fun��o auxiliar para converter dura��o (ex.: "3m20s", "1h2m", "4m 39s") em minutos
 */
function parseDurationToMinutes(durationStr) {
    if (!durationStr || typeof durationStr !== 'string') {
        console.log(`?? Dura��o inv�lida: "${durationStr}"`);
        return 0;
    }

    console.log(`?? Parseando dura��o: "${durationStr}"`);

    let hours = 0, minutes = 0, seconds = 0;

    // Remove espa�os extras e normaliza
    const normalized = durationStr.replace(/\s+/g, ' ').trim();

    // Padr�es poss�veis:
    // "4m 39s", "1h 2m", "45s", "2h", "30m"
    const matchH = normalized.match(/(\d+)h/i);
    if (matchH) {
        hours = parseInt(matchH[1]);
        console.log(`  Horas encontradas: ${hours}`);
    }

    const matchM = normalized.match(/(\d+)m(?!s)/i); // m mas n�o ms
    if (matchM) {
        minutes = parseInt(matchM[1]);
        console.log(`  Minutos encontrados: ${minutes}`);
    }

    const matchS = normalized.match(/(\d+)s/i);
    if (matchS) {
        seconds = parseInt(matchS[1]);
        console.log(`  Segundos encontrados: ${seconds}`);
    }

    const totalMinutes = hours * 60 + minutes + (seconds / 60);
    console.log(`  Total em minutos: ${totalMinutes.toFixed(2)}`);

    return totalMinutes;
}

/**
 * Fun��o para extrair alertas de uma p�gina do Zabbix
 */
async function extractAlerts(page) {
    await page.waitForSelector('.list-table', { timeout: 10000 });
    await new Promise(resolve => setTimeout(resolve, 2000));
    const alerts = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.list-table tbody tr'));
        const alertData = [];
        rows.forEach((row, index) => {
            const cells = row.querySelectorAll('td');
            console.log(`Row ${index}: ${cells.length} cells found`);

            // Debug: log all cell contents
            for (let i = 0; i < cells.length; i++) {
                console.log(`  Cell ${i}: "${cells[i].innerText.trim()}"`);
            }

            if (cells.length < 7) return;

            // Extrai campos usando os �ndices corretos para MLGomes
            const startTime = cells[1].innerText.trim();    // Time (�ndice 1)
            const severity = cells[2].innerText.trim();     // Severity (�ndice 2)
            const host = cells[4].innerText.trim();         // Host (�ndice 4)  
            const problem = cells[5].innerText.trim();      // Problem (�ndice 5)
            const durationStr = cells[6].innerText.trim();  // Duration (�ndice 6)

            alertData.push({ host, problem, severity, startTime, durationStr });
        });
        return alertData;
    });
    return alerts;
}

/**
 * Fun��o para extrair alertas do dashboard usando a p�gina autenticada
 */
async function viewAlerts(page) {
    console.log('?? Verificando alertas...');
    await page.goto(URL_DASHBOARD, { waitUntil: 'networkidle0' });
    const alerts = await extractAlerts(page);
    return alerts;
}

/**
 * Fun��o para enviar alerta individual
 */
async function sendAlertMessage(chatId, alert) {
    const message = `Notificamos o seguinte evento:\n\n*Host:* ${alert.host}\n*Problema:* ${alert.problem}\n*Severidade:* ${alert.severity}\n\nEquipe BOC`;
    console.log('?? Enviando alerta individual para o WhatsApp.');
    enqueueMessage({ chatId, message });
    // Substitui \x07 por console.log para evitar problemas em alguns terminais Linux
    console.log('?? Alerta enviado!');
}

/**
 * Fun��o para enviar mensagem massiva em caso de mais de 10 alertas novos
 */
async function sendMassiveMessage(controleNumber, count) {
    const message = `?? Foram detectados ${count} alertas novos de uma s� vez. Envio individual cancelado. Verifique imediatamente! ??\n\nEquipe BOC`;
    console.log('?? Preparando para enviar mensagem massiva:', message);
    enqueueMessage({ chatId: controleNumber, message });
    // Substitui \x07 por console.log para evitar problemas em alguns terminais Linux
    console.log('?? Mensagem massiva enviada!');
}

/**
 * Fun��o para detectar o execut�vel do Chrome/Chromium no Linux
 */
function detectChromeBrowser() {
    const possiblePaths = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/chrome',
        '/opt/google/chrome/chrome',
        '/snap/bin/chromium'
    ];

    for (const browserPath of possiblePaths) {
        if (fs.existsSync(browserPath)) {
            console.log(`? Navegador encontrado: ${browserPath}`);
            return browserPath;
        }
    }

    console.error('? Navegador Chrome/Chromium n�o encontrado. Instale com:');
    console.error('   sudo apt update && sudo apt install google-chrome-stable');
    console.error('   ou');
    console.error('   sudo apt update && sudo apt install chromium-browser');
    process.exit(1);
}

// Detec��o do navegador baseada no sistema operacional
let browserGC;
if (os.platform() === 'linux') {
    browserGC = detectChromeBrowser();
} else if (os.platform() === 'win32') {
    browserGC = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
} else if (os.platform() === 'darwin') {
    browserGC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
} else {
    console.error('? Sistema operacional n�o suportado.');
    process.exit(1);
}

/**
 * Fun��o principal para processamento dos alertas
 */
async function processAlerts() {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: browserGC,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
        ]
    });

    try {
        const page = await checkZabbixConnection(browser);
        if (!page) {
            console.log('?? Conex�o com Zabbix falhou. Finalizando execu��o.');
            return;
        }

        const alerts = await viewAlerts(page);

        console.log("?? Resumo dos alertas:");
        const totalAlerts = alerts.length;
        console.log(`?? Total de alertas encontrados: ${totalAlerts}`);

        // Carrega cache e cria Set para verifica��o r�pida
        let cache = loadCache();
        let cacheSet = new Set(cache);

        // Debug: mostrar todos os alertas encontrados
        console.log('?? Detalhes dos alertas encontrados:');
        alerts.forEach((alert, index) => {
            const mins = parseDurationToMinutes(alert.durationStr);
            console.log(`  [${index + 1}] Host: ${alert.host} | Problema: ${alert.problem} | Severidade: ${alert.severity} | Dura��o: ${alert.durationStr} (${mins.toFixed(1)}min)`);
        });

        // Aplica filtros de elegibilidade seguindo a l�gica do c�digo funcional
        let newAlerts = [];

        for (let alert of alerts) {
            const key = `${alert.host}|${alert.problem}|${alert.startTime}`;

            // Verifica se j� est� no cache
            if (cacheSet.has(key)) {
                console.log(`? Alerta j� processado (cache): ${alert.host} - ${alert.problem}`);
                continue;
            }

            // Filtra severidade Information
            if (alert.severity.trim() === "Information") {
                console.log(`? Alerta ignorado (Information): ${alert.host} - ${alert.problem}`);
                continue;
            }

            // Filtra por dura��o
            const mins = parseDurationToMinutes(alert.durationStr);
            if (mins <= MIN_DURATION || mins > MAX_DURATION) {
                console.log(`? Alerta fora do range de dura��o (${mins.toFixed(1)}min): ${alert.host} - ${alert.problem}`);
                continue;
            }

            // Se chegou at� aqui, � eleg�vel
            console.log(`? Alerta eleg�vel: ${alert.host} - ${alert.problem} (${mins.toFixed(1)}min)`);
            newAlerts.push({ ...alert, uniqueKey: key });
        }

        console.log(`?? Alertas novos eleg�veis: ${newAlerts.length} (Total de alertas: ${totalAlerts})`);

        // Deduplica��o (caso haja duplicatas dentro do pr�prio resultado)
        const map = {};
        let hasDuplicates = false;
        newAlerts.forEach(alert => {
            if (map[alert.uniqueKey]) {
                map[alert.uniqueKey].count = (map[alert.uniqueKey].count || 1) + 1;
                hasDuplicates = true;
            } else {
                map[alert.uniqueKey] = alert;
            }
        });

        if (hasDuplicates) {
            console.log('?? Detectadas duplicatas nos alertas');
            enqueueMessage({ chatId: controleNumber, message: "? Detectada duplicidade de alertas; enviando singularmente." });
        }

        const deduplicatedAlerts = Object.values(map);
        console.log(`?? Total ap�s deduplica��o: ${deduplicatedAlerts.length}`);

        // Decide entre envio individual ou massivo
        if (deduplicatedAlerts.length > 10) {
            await sendMassiveMessage(controleNumber, deduplicatedAlerts.length);
        } else {
            for (let alert of deduplicatedAlerts) {
                await sendAlertMessage(chatId, alert);
                cacheSet.add(alert.uniqueKey);
            }
        }

        // Salva o cache atualizado
        saveCache(Array.from(cacheSet));

    } catch (error) {
        console.error('Erro durante o processamento:', error);
    } finally {
        await browser.close();
        console.log('?? Processamento de alertas conclu�do. Encerrando execu��o.');
    }
}

// Iniciar o processamento dos alertas
console.log('? Iniciando verifica��o de alertas...');
processAlerts()
    .then(() => {
        console.log('? Processamento conclu�do com sucesso.');
        process.exit(0);
    })
    .catch(error => {
        console.error('? Erro durante o processamento:', error);
        process.exit(1);
    });
