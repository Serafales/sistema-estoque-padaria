const express = require('express');
const cors = require('cors');
const { inicializarBanco } = require('./src/config/db');
const produtosJson = require('./produtos.json'); 

const app = express();
const porta = 3000;
let db; 

app.use(cors());
app.use(express.json());

app.get('/popular-banco', async (req, res) => {
    try {
        for (let produto of produtosJson) {
            await db.run(
                `INSERT OR IGNORE INTO produtos (nome, ean, fornecedor, estoque_atual, estoque_alvo) 
                 VALUES (?, ?, ?, ?, ?)`,
                [produto.nome, produto.ean, produto.fornecedor, produto.estoque_atual, produto.estoque_alvo]
            );
        }
        res.send("✅ Banco populado com sucesso! Acesse http://localhost:3000 para ver o frontend.");
    } catch (erro) {
        console.error(erro);
        res.status(500).send("❌ Erro ao popular banco.");
    }
});

app.get('/alertas', async (req, res) => {
    try {
        const produtosEmBaixa = await db.all('SELECT * FROM produtos WHERE estoque_atual < estoque_alvo');
        
        let alertas = produtosEmBaixa.map(produto => {
            return {
                ean: produto.ean,
                nome: produto.nome,
                fornecedor: produto.fornecedor,
                quantidadePedir: produto.estoque_alvo - produto.estoque_atual
            };
        });

        res.json(alertas);
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao buscar alertas no banco." });
    }
});

app.put('/repor/:ean', async (req, res) => {
    const eanProduto = req.params.ean;
    try {
        await db.run('UPDATE produtos SET estoque_atual = estoque_alvo WHERE ean = ?', [eanProduto]);
        res.json({ mensagem: "Estoque atualizado com sucesso!" });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao atualizar o banco." });
    }
});



inicializarBanco().then(banco => {
    db = banco; // Conexão para as rotas usarem
    app.listen(porta, () => {
        console.log(`🚀 Servidor e Banco de Dados rodando na porta ${porta}`);
    });
}).catch(erro => console.error("Erro ao iniciar o banco:", erro));