-- Script para consultar a senha do usuário admin no Zabbix
-- Execute este comando no servidor onde está o Zabbix

-- Para MySQL/MariaDB:
SELECT username, passwd FROM users WHERE username = 'admin';

-- Para PostgreSQL:
-- SELECT username, passwd FROM users WHERE username = 'admin';

-- Para ver todos os usuários:
-- SELECT username, passwd FROM users;

-- Para ver a estrutura da tabela:
-- DESCRIBE users; 