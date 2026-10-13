const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

async function inicializarBanco() {
    const db = await open({
        filename: './banco_padaria.sqlite',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS produtos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            ean TEXT UNIQUE NOT NULL,
            fornecedor TEXT,
            estoque_atual INTEGER DEFAULT 0,
            estoque_alvo INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS historico (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ean TEXT,
            nome_produto TEXT,
            acao TEXT,
            data_hora DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    console.log("Banco de dados conectado.");
    return db;
}

module.exports = { inicializarBanco };