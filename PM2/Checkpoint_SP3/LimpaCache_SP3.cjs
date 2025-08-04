#!/usr/bin/env node
const fs = require('fs');
const path = './cache_Camp.json'; // Substitua pelo caminho/nome do arquivo desejado

fs.writeFile(path, '[]', 'utf8', (err) => {
    if (err) {
        console.error('Erro ao limpar o cache:', err);
        process.exit(1);
    } else {
        console.log('Cache limpo com sucesso!');
    }
});
