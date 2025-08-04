const puppeteer = require('puppeteer');

const ZABBIX_URL = 'http://192.168.100.42/zabbix/index.php';
const USERNAME = 'admin';

// Senhas comuns para testar
const PASSWORDS = [
    'zabbix',
    'admin',
    'password',
    '123456',
    'admin123',
    'zabbix123',
    'password123',
    'root',
    'administrator'
];

async function testLogin(password) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.goto(ZABBIX_URL, { waitUntil: 'networkidle0' });
        
        // Preencher formulário
        await page.type('#name', USERNAME);
        await page.type('#password', password);
        
        // Clicar no botão de login
        await Promise.all([
            page.click('#enter'),
            page.waitForNavigation({ waitUntil: 'networkidle0' })
        ]);

        // Verificar se o login foi bem-sucedido
        const currentUrl = page.url();
        const hasLogoutLink = await page.$('a[href*="action=logout"]');
        const hasError = await page.$('.error');

        if (hasLogoutLink && !currentUrl.includes('login')) {
            console.log(`✅ SUCESSO! Senha encontrada: ${password}`);
            return true;
        } else {
            console.log(`❌ Falhou: ${password}`);
            return false;
        }

    } catch (error) {
        console.log(`❌ Erro ao testar ${password}: ${error.message}`);
        return false;
    } finally {
        await browser.close();
    }
}

async function testAllPasswords() {
    console.log('🔍 Testando credenciais do Zabbix...\n');
    
    for (const password of PASSWORDS) {
        const success = await testLogin(password);
        if (success) {
            console.log(`\n🎉 SENHA ENCONTRADA: ${password}`);
            console.log(`Atualize o arquivo .env com: ZABBIX_Camp_PASSWORD=${password}`);
            break;
        }
        // Aguardar um pouco entre as tentativas
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('\n✅ Teste concluído!');
}

testAllPasswords().catch(console.error); 