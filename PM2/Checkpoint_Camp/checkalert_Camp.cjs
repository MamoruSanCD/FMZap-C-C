/**
 * APIs importadas para a execução do código
 */
require('module').globalPaths.push('../../node_modules');
const os = require('os');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const http = require('http');
const dotenv = require('dotenv');

// Carrega as variáveis de ambiente do arquivo .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Configurações do Zabbix
 */
const ZABBIX_LOGIN_URL = process.env.ZABBIX_Camp_URL;
const URL_BASE = ZABBIX_LOGIN_URL.replace('/index.php', '');
const URL_DASHBOARD = `${URL_BASE}/zabbix.php?show=3&name=&severities%5B4%5D=4&severities%5B5%5D=5&inventory%5B0%5D%5Bfield%5D=type&inventory%5B0%5D%5Bvalue%5D=&evaltype=0&tags%5B0%5D%5Btag%5D=&tags%5B0%5D%5Boperator%5D=0&tags%5B0%5D%5Bvalue%5D=&show_tags=3&tag_name_format=0&tag_priority=&show_opdata=0&show_suppressed=1&unacknowledged=1&filter_name=&filter_show_counter=0&filter_custom_time=0&sort=clock&sortorder=DESC&age_state=0&compact_view=0&show_timeline=0&details=0&highlight_row=0&action=problem.view&groupids%5B%5D=174&groupids%5B%5D=177&groupids%5B%5D=178`;
const USERNAME = process.env.ZABBIX_Camp_USERNAME;
const PASSWORD = process.env.ZABBIX_Camp_PASSWORD;

/**
 * Configurações do WhatsApp
 */
const chatId = process.env.WHATSAPP_GRUPO_Camp; // Grupo do cliente para envio de alertas
const controleNumber = process.env.WHATSAPP_GRUPO_CONTROLE; // Grupo interno para aviso em caso de massiva

/**
 * Variáveis globais e cache
 */
let cacheFile = path.join(__dirname, 'cache_Camp.json'); // Nome específico do cache
const MIN_DURATION = 2; // minutos
const MAX_DURATION = 7; // minutos

/**
 * Função para enviar mensagem para a API WhatsApp
 */
async function enviarParaApi(data) {
    return new Promise((resolve, reject) => {
        const jsonData = JSON.stringify(data);

        // Obtém o token da API do arquivo .env
        const apiToken = process.env.API_TOKEN;

        const options = {
            hostname: 'localhost',
            port: process.env.API_PORT,
            path: '/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(jsonData),
                'X-API-Token': apiToken // Adiciona o token no cabeçalho
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
 * Função para carregar o cache de alertas já enviados
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
 * Função para salvar o cache atualizado
 */
function saveCache(cache) {
    try {
        fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
    } catch (err) {
        console.error('Erro ao salvar o cache:', err);
    }
}

/**
 * Função para envio de mensagens
 */
function enqueueMessage({ chatId, message }) {
    enviarParaApi({
        groupId: chatId,
        message: message,
        tipo: 2
    })
        .then(() => console.log(`✅ Mensagem enviada para ${chatId}`))
        .catch(err => console.error(`❌ Erro ao enviar mensagem para ${chatId}:`, err));
}

/**
 * Função para fazer login no Zabbix e retornar a página autenticada
 */
async function loginZabbix(browser) {
    console.log('🟡 Realizando login no Zabbix...');
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        // Tenta acessar página de login e espera seletor do formulário
        await page.goto(ZABBIX_LOGIN_URL, { waitUntil: 'networkidle0', timeout: 120000 }); // Aumentado para 2 minutos
        await page.waitForSelector('#name', { timeout: 60000 }); // Aumentado para 1 minuto
        await page.type('#name', USERNAME);
        await page.type('#password', PASSWORD);
        await Promise.all([
            page.click('#enter'),
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 }) // Aumentado para 2 minutos
        ]);

        // Verifica se houve erro de login (exemplo: existe algum seletor de erro)
        const loginError = await page.$('.error');
        if (loginError) {
            throw new Error('Credenciais inválidas ou erro de login');
        }

        console.log('✅ Login no Zabbix realizado com sucesso.');
        return page;
    } catch (error) {
        // Analisar o erro e lançar erro customizado para depois identificar melhor
        if (error.message.includes('Timeout') || error.message.includes('Navigation')) {
            throw new Error('Timeout ou falha de navegação');
        }
        if (error.message.includes('Credenciais inválidas')) {
            throw new Error('Erro de credenciais');
        }
        // Outro erro genérico
        throw new Error('Erro desconhecido no login: ' + error.message);
    }
}

/**
 * Função para verificar a conexão com o Zabbix e retornar a página autenticada
 */
async function checkZabbixConnection(browser) {
    console.log('🟡 Verificando conexão com o Zabbix...');
    try {
        const page = await loginZabbix(browser);
        console.log('✅ Conexão com o Zabbix bem-sucedida.');
        return page;
    } catch (error) {
        console.error('❌ Falha ao conectar ao Zabbix:', error.message);

        // Define mensagem específica conforme o erro
        let message = '';
        switch (error.message) {
            case 'Timeout ou falha de navegação':
                message = "⚠ Falha na conexão: Timeout ou problema na navegação. Verifique a VPN e a rede.";
                break;
            case 'Erro de credenciais':
                message = "⚠ Erro de login: Usuário ou senha inválidos no Zabbix. Favor revisar credenciais.";
                break;
            default:
                message = `⚠ Erro desconhecido ao tentar logar no Zabbix: ${error.message}`;
                break;
        }

        // Envia mensagem para grupo controle
        enqueueMessage({ chatId: controleNumber, message });
        console.log('🛑 Erro de conexão com o Zabbix detectado. Enviando mensagem e interrompendo execução.');
        return null;
    }
}

/**
 * Função auxiliar para converter duração (ex.: "3m20s", "1h2m", "4m 39s") em minutos
 */
function parseDurationToMinutes(durationStr) {
    if (!durationStr || typeof durationStr !== 'string') {
        console.log(`⚠️ Duração inválida: "${durationStr}"`);
        return 0;
    }

    console.log(`🔍 Parseando duração: "${durationStr}"`);

    let hours = 0, minutes = 0, seconds = 0;

    // Remove espaços extras e normaliza
    const normalized = durationStr.replace(/\s+/g, ' ').trim();

    // Padrões possíveis:
    // "4m 39s", "1h 2m", "45s", "2h", "30m"
    const matchH = normalized.match(/(\d+)h/i);
    if (matchH) {
        hours = parseInt(matchH[1]);
        console.log(`  Horas encontradas: ${hours}`);
    }

    const matchM = normalized.match(/(\d+)m(?!s)/i); // m mas não ms
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
 * Função para extrair alertas de uma página do Zabbix
 */
async function extractAlerts(page) {
    console.log('🟡 Aguardando tabela de problemas...');
    try {
        await page.waitForSelector('.list-table', { timeout: 120000 }); // 2 minutos
        console.log('✅ Tabela de problemas carregada!');
    } catch (error) {
        console.log('⚠️ Tabela .list-table não encontrada, tentando seletor alternativo...');
        try {
            await page.waitForSelector('table', { timeout: 60000 });
            console.log('✅ Tabela encontrada com seletor alternativo!');
        } catch (error2) {
            console.log('⚠️ Nenhuma tabela encontrada, continuando mesmo assim...');
        }
    }

    // Aguardar um pouco mais para garantir que tudo carregou
    await new Promise(resolve => setTimeout(resolve, 3000));
    
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

            // Tenta diferentes posições para encontrar a duração correta
            let durationStr = '';
            let startTime = '';
            let severity = '';
            let host = '';
            let problem = '';

            // Procura pela duração no formato correto (Xm Ys ou Xh Ym Zs)
            for (let i = 0; i < cells.length; i++) {
                const cellText = cells[i].innerText.trim();
                // Verifica se contém padrão de duração válido
                if (cellText.match(/^\d+[hms](\s+\d+[ms])*$/) || cellText.match(/^\d+[hms]$/)) {
                    durationStr = cellText;
                    console.log(`Duration found in cell ${i}: "${durationStr}"`);
                    break;
                }
            }

            // Se não encontrou duração, tenta o padrão original
            if (!durationStr) {
                durationStr = cells[6].innerText.trim();
                console.log(`Using default duration from cell 6: "${durationStr}"`);
            }

            // Extrai outros campos
            startTime = cells[0].innerText.trim();
            severity = cells[2].innerText.trim();
            host = cells[4].innerText.trim();
            problem = cells[5].innerText.trim();

            alertData.push({ host, problem, severity, startTime, durationStr });
        });
        return alertData;
    });
    return alerts;
}

/**
 * Função para extrair alertas do dashboard usando a página autenticada
 */
async function viewAlerts(page) {
    console.log('🟡 Verificando alertas...');
    console.log('🟡 Navegando para o dashboard...');
    await page.goto(URL_DASHBOARD, { 
        waitUntil: 'networkidle0',
        timeout: 120000 // Aumentado para 2 minutos
    });
    
    console.log('🟡 Aguardando carregamento completo da página...');
    await page.waitForLoadState('networkidle');
    
    const alerts = await extractAlerts(page);
    return alerts;
}

/**
 * Função para enviar alerta individual
 */
async function sendAlertMessage(chatId, alert) {
    const message = `Notificamos o seguinte evento:\n\n*Host:* ${alert.host}\n*Problema:* ${alert.problem}\n*Severidade:* ${alert.severity}\n\nEquipe BOC`;
    console.log('🟡 Enviando alerta individual para o WhatsApp.');
    enqueueMessage({ chatId, message });
    process.stdout.write('\x07');
}

/**
 * Função para enviar mensagem massiva em caso de mais de 10 alertas novos
 */
async function sendMassiveMessage(controleNumber, count) {
    const message = `⚠️ Foram detectados ${count} alertas novos de uma só vez. Envio individual cancelado. Verifique imediatamente! ⚠️\n\nEquipe BOC`;
    console.log('🟡 Preparando para enviar mensagem massiva:', message);
    enqueueMessage({ chatId: controleNumber, message });
    process.stdout.write('\x07');
}

/**
 * Função principal para processamento dos alertas - LÓGICA CORRIGIDA
 */
async function processAlerts() {
    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium-browser',
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1920,1080'
        ],
        defaultViewport: null
    });

    try {
        const page = await checkZabbixConnection(browser);
        if (!page) {
            console.log('🛑 Conexão com Zabbix falhou. Finalizando execução.');
            return;
        }

        const alerts = await viewAlerts(page);

        console.log("🟦 Resumo dos alertas:");
        const totalAlerts = alerts.length;
        console.log(`📊 Total de alertas encontrados: ${totalAlerts}`);

        // Carrega cache e cria Set para verificação rápida
        let cache = loadCache();
        let cacheSet = new Set(cache);

        // Debug: mostrar todos os alertas encontrados
        console.log('🔍 Detalhes dos alertas encontrados:');
        alerts.forEach((alert, index) => {
            const mins = parseDurationToMinutes(alert.durationStr);
            console.log(`  [${index + 1}] Host: ${alert.host} | Problema: ${alert.problem} | Severidade: ${alert.severity} | Duração: ${alert.durationStr} (${mins.toFixed(1)}min)`);
        });

        // Aplica filtros de elegibilidade seguindo a lógica do código funcional
        let newAlerts = [];

        for (let alert of alerts) {
            const key = `${alert.host}|${alert.problem}|${alert.startTime}`;

            // Verifica se já está no cache
            if (cacheSet.has(key)) {
                console.log(`❌ Alerta já processado (cache): ${alert.host} - ${alert.problem}`);
                continue;
            }

            // Filtra severidade Information
            if (alert.severity.trim() === "Information") {
                console.log(`❌ Alerta ignorado (Information): ${alert.host} - ${alert.problem}`);
                continue;
            }

            // Filtra por duração
            const mins = parseDurationToMinutes(alert.durationStr);
            if (mins <= MIN_DURATION || mins > MAX_DURATION) {
                console.log(`❌ Alerta fora do range de duração (${mins.toFixed(1)}min): ${alert.host} - ${alert.problem}`);
                continue;
            }

            // Se chegou até aqui, é elegível
            console.log(`✅ Alerta elegível: ${alert.host} - ${alert.problem} (${mins.toFixed(1)}min)`);
            newAlerts.push({ ...alert, uniqueKey: key });
        }

        console.log(`🔵 Alertas novos elegíveis: ${newAlerts.length} (Total de alertas: ${totalAlerts})`);

        // Deduplicação (caso haja duplicatas dentro do próprio resultado)
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
            console.log('⚠️ Detectadas duplicatas nos alertas');
            enqueueMessage({ chatId: controleNumber, message: "⚠ Detectada duplicidade de alertas; enviando singularmente." });
        }

        const deduplicatedAlerts = Object.values(map);
        console.log(`🟢 Total após deduplicação: ${deduplicatedAlerts.length}`);

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
        console.error('❌ Erro durante o processamento:', error);
    } finally {
        await browser.close();
        console.log('🟨 Processamento de alertas concluído. Encerrando execução.');
    }
}

// Iniciar o processamento dos alertas
console.log('⭐ Iniciando verificação de alertas...');
processAlerts()
    .then(() => {
        console.log('✅ Processamento concluído com sucesso.');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Erro durante o processamento:', error);
        process.exit(1);
    });
