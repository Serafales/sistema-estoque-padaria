const express = require('express');
const cors = require('cors');
const { inicializarBanco } = require('./src/config/db');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');

const app = express();
const porta = 3000;
let db;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// Buscar alertas de estoque
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
        console.error("Erro BD (alertas):", erro);
        res.status(500).json({ erro: "Erro ao consultar alertas." });
    }
});

// Atualizar estoque e registrar histórico
app.put('/repor/:ean', async (req, res) => {
    const eanProduto = req.params.ean;
    const { quantidade, tipo } = req.body || {};

    try {
        const produto = await db.get('SELECT nome, estoque_atual, estoque_alvo FROM produtos WHERE ean = ?', [eanProduto]);
        if (!produto) return res.status(404).json({ erro: "Produto não encontrado." });

        let acaoTexto = "";

        if (!quantidade) {
            let qtdCompletada = produto.estoque_alvo - produto.estoque_atual;
            await db.run('UPDATE produtos SET estoque_atual = estoque_alvo WHERE ean = ?', [eanProduto]);
            acaoTexto = `Reposição total (+${qtdCompletada})`;
        } else if (tipo === 'adicionar') {
            await db.run('UPDATE produtos SET estoque_atual = estoque_atual + ? WHERE ean = ?', [quantidade, eanProduto]);
            acaoTexto = `Adição parcial (+${quantidade})`;
        } else if (tipo === 'montante') {
            await db.run('UPDATE produtos SET estoque_atual = ? WHERE ean = ?', [quantidade, eanProduto]);
            acaoTexto = `Ajuste manual (= ${quantidade})`;
        }
        
        await db.run(
            'INSERT INTO historico (ean, nome_produto, acao) VALUES (?, ?, ?)',
            [eanProduto, produto.nome, acaoTexto]
        );

        res.json({ mensagem: "Estoque atualizado." });
    } catch (erro) {
        console.error("Erro reposição:", erro);
        res.status(500).json({ erro: "Erro ao atualizar estoque." });
    }
});

// Importar planilha
app.post('/importar', upload.single('planilha'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ erro: "Arquivo não enviado." });
    }

    try {
        const workbook = xlsx.readFile(req.file.path);
        const nomeAba = workbook.SheetNames[0];
        const dadosPlanilha = xlsx.utils.sheet_to_json(workbook.Sheets[nomeAba]);

        let inseridos = 0;

        for (let linha of dadosPlanilha) {
            if (linha.Nome && linha.EAN) {
                let eanFormatado = String(linha.EAN).replace(/\.0$/, '');

                await db.run(
                    `INSERT INTO produtos (nome, ean, fornecedor, estoque_atual, estoque_alvo) 
                     VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT(ean) DO UPDATE SET 
                        estoque_atual = excluded.estoque_atual,
                        estoque_alvo = excluded.estoque_alvo,
                        nome = excluded.nome,
                        fornecedor = excluded.fornecedor`,
                    [
                        linha.Nome, 
                        eanFormatado, 
                        linha.Fornecedor || "Desconhecido", 
                        linha.EstoqueAtual || 0, 
                        linha.EstoqueAlvo || 10
                    ]
                );
                inseridos++;
            }
        }
        
        fs.unlinkSync(req.file.path);
        res.json({ mensagem: `${inseridos} registros processados.` });
    } catch (erro) {
        console.error("Erro importação:", erro);
        res.status(500).json({ erro: "Falha ao ler planilha." });
    }
});

// Listar estoque completo
app.get('/produtos', async (req, res) => {
    try {
        const todosProdutos = await db.all('SELECT * FROM produtos');
        res.json(todosProdutos);
    } catch (erro) {
        console.error("Erro BD (produtos):", erro);
        res.status(500).json({ erro: "Erro ao consultar produtos." });
    }
});

// Cadastrar produto manual
app.post('/produtos', async (req, res) => {
    const { nome, ean, fornecedor, estoque_atual, estoque_alvo } = req.body;
    try {
        await db.run(
            `INSERT INTO produtos (nome, ean, fornecedor, estoque_atual, estoque_alvo) 
             VALUES (?, ?, ?, ?, ?)`,
            [nome, ean, fornecedor || "Desconhecido", estoque_atual || 0, estoque_alvo || 1]
        );
        res.status(201).json({ mensagem: "Produto cadastrado." });
    } catch (erro) {
        console.error("Erro cadastro:", erro);
        res.status(500).json({ erro: "Erro ao cadastrar (EAN duplicado?)." });
    }
});

// Editar produto
app.put('/produtos/:ean', async (req, res) => {
    const eanProduto = req.params.ean;
    const { nome, fornecedor, estoque_atual, estoque_alvo } = req.body;
    try {
        await db.run(
            `UPDATE produtos 
             SET nome = ?, fornecedor = ?, estoque_atual = ?, estoque_alvo = ? 
             WHERE ean = ?`,
            [nome, fornecedor, estoque_atual, estoque_alvo, eanProduto]
        );
        res.json({ mensagem: "Produto atualizado." });
    } catch (erro) {
        console.error("Erro edição:", erro);
        res.status(500).json({ erro: "Erro ao editar produto." });
    }
});

// Excluir produto
app.delete('/produtos/:ean', async (req, res) => {
    const eanProduto = req.params.ean;
    try {
        await db.run('DELETE FROM produtos WHERE ean = ?', [eanProduto]);
        res.json({ mensagem: "Produto excluído." });
    } catch (erro) {
        console.error("Erro exclusão:", erro);
        res.status(500).json({ erro: "Erro ao excluir produto." });
    }
});

// Histórico de movimentações
app.get('/historico', async (req, res) => {
    try {
        const historico = await db.all('SELECT * FROM historico ORDER BY data_hora DESC LIMIT 50');
        res.json(historico);
    } catch (erro) {
        console.error("Erro BD (historico):", erro);
        res.status(500).json({ erro: "Erro ao buscar histórico." });
    }
});

inicializarBanco().then(banco => {
    db = banco;
    app.listen(porta, () => {
        console.log(`Servidor rodando na porta ${porta}`);
    });
}).catch(erro => console.error("Erro inicialização:", erro));