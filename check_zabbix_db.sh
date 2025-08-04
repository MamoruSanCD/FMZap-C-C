#!/bin/bash

# Script para verificar qual banco de dados o Zabbix está usando
# Execute no servidor onde está o Zabbix

echo "🔍 Verificando configuração do banco de dados do Zabbix..."

# Verificar arquivo de configuração do Zabbix
if [ -f "/etc/zabbix/zabbix_server.conf" ]; then
    echo "📁 Arquivo de configuração encontrado: /etc/zabbix/zabbix_server.conf"
    echo "🔧 Configuração do banco de dados:"
    grep -E "DBHost|DBName|DBUser|DBPassword" /etc/zabbix/zabbix_server.conf
fi

# Verificar se MySQL está rodando
if systemctl is-active --quiet mysql; then
    echo "✅ MySQL está rodando"
elif systemctl is-active --quiet mariadb; then
    echo "✅ MariaDB está rodando"
fi

# Verificar se PostgreSQL está rodando
if systemctl is-active --quiet postgresql; then
    echo "✅ PostgreSQL está rodando"
fi

# Verificar processos do banco
echo "🔍 Processos de banco de dados ativos:"
ps aux | grep -E "(mysql|postgres)" | grep -v grep

echo ""
echo "📋 Para consultar a senha, execute:"
echo "MySQL/MariaDB: mysql -u root -p zabbix -e 'SELECT username, passwd FROM users WHERE username = \"admin\";'"
echo "PostgreSQL: psql -U postgres -d zabbix -c 'SELECT username, passwd FROM users WHERE username = \"admin\";'" 