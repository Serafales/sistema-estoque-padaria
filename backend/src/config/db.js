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
            usuario TEXT,
            data_hora DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            senha TEXT NOT NULL,
            perfil TEXT NOT NULL
        );
    `);

    const admin = await db.get("SELECT id FROM usuarios WHERE username = 'admin'");
    
    if (!admin) {
        await db.run("INSERT INTO usuarios (username, senha, perfil) VALUES ('admin', '1234', 'admin')");
        await db.run("INSERT INTO usuarios (username, senha, perfil) VALUES ('estoque', '1234', 'estoquista')");
        console.log("Seed de usuários rodou.");
    }

    console.log("DB SQLite pronto.");
    return db;
}

module.exports = { inicializarBanco };