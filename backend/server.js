const express = require('express');
const cors = require('cors');
const produtos = require('./produtos.json'); //BANCO DE DADOS TEMPORÁRIO

const app = express();
const porta = 3000;

app.use(cors());
app.use(express.json());

app.get('/alertas', (req, res) => {
    let alertas = [];

    produtos.forEach(produto => {
        if (produto.estoque_atual < produto.estoque_alvo) {
            let quantidadePedir = produto.estoque_alvo - produto.estoque_atual;
            
            alertas.push({
                mensagem: `ALERTA: Pedir ${quantidadePedir}x unidades de "${produto.nome}" para o ${produto.fornecedor}. (EAN: ${produto.ean})`
            });
        }
    });

    res.json(alertas);
});

app.listen(porta, () => {
    console.log(`Servidor rodando na porta ${porta}`);
});