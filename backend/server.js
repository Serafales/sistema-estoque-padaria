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

// 1. Rota que puxa os alertas (matemática do estoque)
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
        console.error("Erro no banco:", erro);
        res.status(500).json({ erro: "Erro ao buscar alertas no banco." });
    }
});

// 2. Rota que simula a chegada do produto e zera o alerta
app.put('/repor/:ean', async (req, res) => {
    const eanProduto = req.params.ean;
    try {
        await db.run('UPDATE produtos SET estoque_atual = estoque_alvo WHERE ean = ?', [eanProduto]);
        res.json({ mensagem: "Estoque atualizado com sucesso!" });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao atualizar o banco." });
    }
});
// 3. Rota nova para importar a planilha do Excel
app.post('/importar', upload.single('planilha'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ erro: "Nenhum arquivo enviado." });
    }

    try {
        const workbook = xlsx.readFile(req.file.path);
        const nomeAba = workbook.SheetNames[0];
        const dadosPlanilha = xlsx.utils.sheet_to_json(workbook.Sheets[nomeAba]);

        let inseridos = 0;

        for (let linha of dadosPlanilha) {
            if (linha.Nome && linha.EAN) {
                let eanFormatado = String(linha.EAN).replace(/\.0$/, '');

                // INSERT com ON CONFLICT (Upsert)
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
                inseridos++; // Conta como processado (inserido ou atualizado)
            }
        }
        
        fs.unlinkSync(req.file.path);
        res.json({ mensagem: `Sucesso! ${inseridos} produtos foram importados/atualizados.` });
    } catch (erro) {
        console.error("Erro na importação:", erro);
        res.status(500).json({ erro: "Falha ao processar o arquivo Excel." });
    }
});
// 4. Rota que devolve todo o estoque cadastrado
app.get('/produtos', async (req, res) => {
    try {
        const todosProdutos = await db.all('SELECT * FROM produtos');
        res.json(todosProdutos);
    } catch (erro) {
        console.error("Erro no banco:", erro);
        res.status(500).json({ erro: "Erro ao buscar o estoque completo." });
    }
});

// Inicialização do Servidor e Banco
inicializarBanco().then(banco => {
    db = banco;
    app.listen(porta, () => {
        console.log(`🚀 Servidor e Banco de Dados rodando na porta ${porta}`);
    });
}).catch(erro => console.error("Erro ao iniciar o banco:", erro));