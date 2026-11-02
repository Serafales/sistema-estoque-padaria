const express = require('express');
const cors = require('cors');
const { inicializarBanco } = require('./src/config/db');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');

const app = express();
const port = 3000;
let db;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// Middleware de Acesso
const checkAdmin = (req, res, next) => {
    if (req.headers['x-perfil'] !== 'admin') {
        return res.status(403).json({ erro: "Acesso restrito." });
    }
    next();
};

// Autenticação
app.post('/login', (req, res) => {
    const { username, senha } = req.body;
    db.get('SELECT username, perfil FROM usuarios WHERE username = ? AND senha = ?', [username, senha])
        .then(user => {
            if (user) res.json(user);
            else res.status(401).json({ erro: "Credenciais inválidas." });
        })
        .catch(err => res.status(500).json({ erro: "Erro interno." }));
});

// Gestão de Usuários
app.get('/usuarios', checkAdmin, (req, res) => {
    db.all('SELECT id, username, perfil FROM usuarios')
        .then(users => res.json(users))
        .catch(err => res.status(500).json({ erro: "Erro ao buscar usuários." }));
});

app.post('/usuarios', checkAdmin, (req, res) => {
    const { username, senha, perfil } = req.body;
    if (!['admin', 'estoquista'].includes(perfil)) {
        return res.status(400).json({ erro: "Perfil inválido." });
    }

    db.run('INSERT INTO usuarios (username, senha, perfil) VALUES (?, ?, ?)', [username, senha, perfil])
        .then(() => res.status(201).json({ msg: "Criado com sucesso." }))
        .catch(err => res.status(500).json({ erro: "Erro ou usuário duplicado." }));
});

app.delete('/usuarios/:id', checkAdmin, async (req, res) => {
    const id = req.params.id;
    try {
        const user = await db.get('SELECT username FROM usuarios WHERE id = ?', [id]);
        if (user?.username === 'admin') return res.status(403).json({ erro: "Admin principal protegido." });
        
        await db.run('DELETE FROM usuarios WHERE id = ?', [id]);
        res.json({ msg: "Usuário removido." });
    } catch (err) {
        res.status(500).json({ erro: "Falha na exclusão." });
    }
});

// Estoque e Alertas
app.get('/alertas', (req, res) => {
    db.all('SELECT ean, nome, fornecedor, estoque_alvo, estoque_atual FROM produtos WHERE estoque_atual < estoque_alvo')
        .then(baixa => {
            const list = baixa.map(p => ({
                ...p,
                quantidadePedir: p.estoque_alvo - p.estoque_atual
            }));
            res.json(list);
        })
        .catch(err => res.status(500).json({ erro: "Falha ao ler alertas." }));
});

app.put('/repor/:ean', async (req, res) => {
    const ean = req.params.ean;
    const { quantidade, tipo } = req.body || {};
    const user = req.headers['x-usuario'] || 'Sys';

    try {
        const prod = await db.get('SELECT nome, estoque_atual, estoque_alvo FROM produtos WHERE ean = ?', [ean]);
        if (!prod) return res.status(404).json({ erro: "Não encontrado." });

        let acao = "";

        if (!quantidade) {
            await db.run('UPDATE produtos SET estoque_atual = estoque_alvo WHERE ean = ?', [ean]);
            acao = `Reposição total (+${prod.estoque_alvo - prod.estoque_atual})`;
        } else if (tipo === 'adicionar') {
            await db.run('UPDATE produtos SET estoque_atual = estoque_atual + ? WHERE ean = ?', [quantidade, ean]);
            acao = `Adição parcial (+${quantidade})`;
        } else if (tipo === 'montante') {
            await db.run('UPDATE produtos SET estoque_atual = ? WHERE ean = ?', [quantidade, ean]);
            acao = `Ajuste manual (= ${quantidade})`;
        }
        
        await db.run('INSERT INTO historico (ean, nome_produto, acao, usuario) VALUES (?, ?, ?, ?)', 
            [ean, prod.nome, acao, user]);

        res.json({ msg: "Atualizado." });
    } catch (err) {
        res.status(500).json({ erro: "Erro ao atualizar." });
    }
});

// Importação Excel
app.post('/importar', checkAdmin, upload.single('planilha'), async (req, res) => {
    if (!req.file) return res.status(400).json({ erro: "Sem arquivo." });

    try {
        const wb = xlsx.readFile(req.file.path);
        const ws = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        let count = 0;

        for (let row of ws) {
            if (row.Nome && row.EAN) {
                const eanLimpo = String(row.EAN).replace(/\.0$/, '');
                await db.run(`
                    INSERT INTO produtos (nome, ean, fornecedor, estoque_atual, estoque_alvo) 
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(ean) DO UPDATE SET 
                        estoque_atual = excluded.estoque_atual,
                        estoque_alvo = excluded.estoque_alvo,
                        nome = excluded.nome,
                        fornecedor = excluded.fornecedor`,
                    [row.Nome, eanLimpo, row.Fornecedor || "Desc", row.EstoqueAtual || 0, row.EstoqueAlvo || 10]
                );
                count++;
            }
        }
        fs.unlinkSync(req.file.path);
        res.json({ msg: `${count} importados.` });
    } catch (err) {
        res.status(500).json({ erro: "Falha na leitura." });
    }
});

// CRUD de Produtos
app.get('/produtos', (req, res) => {
    db.all('SELECT * FROM produtos')
        .then(itens => res.json(itens))
        .catch(err => res.status(500).json({ erro: "Erro de consulta." }));
});

app.post('/produtos', checkAdmin, (req, res) => {
    const { nome, ean, fornecedor, estoque_atual, estoque_alvo } = req.body;
    db.run('INSERT INTO produtos (nome, ean, fornecedor, estoque_atual, estoque_alvo) VALUES (?, ?, ?, ?, ?)', 
        [nome, ean, fornecedor || "Desc", estoque_atual || 0, estoque_alvo || 1])
        .then(() => res.status(201).json({ msg: "Cadastrado." }))
        .catch(err => res.status(500).json({ erro: "Falha ao salvar." }));
});

app.put('/produtos/:ean', checkAdmin, (req, res) => {
    const { nome, fornecedor, estoque_atual, estoque_alvo } = req.body;
    db.run('UPDATE produtos SET nome = ?, fornecedor = ?, estoque_atual = ?, estoque_alvo = ? WHERE ean = ?', 
        [nome, fornecedor, estoque_atual, estoque_alvo, req.params.ean])
        .then(() => res.json({ msg: "Atualizado." }))
        .catch(err => res.status(500).json({ erro: "Erro de update." }));
});

app.delete('/produtos/:ean', checkAdmin, (req, res) => {
    db.run('DELETE FROM produtos WHERE ean = ?', [req.params.ean])
        .then(() => res.json({ msg: "Apagado." }))
        .catch(err => res.status(500).json({ erro: "Falha ao excluir." }));
});

// Histórico
app.get('/historico', (req, res) => {
    db.all('SELECT * FROM historico ORDER BY data_hora DESC LIMIT 50')
        .then(logs => res.json(logs))
        .catch(err => res.status(500).json({ erro: "Erro no log." }));
});

// Boot
inicializarBanco().then(b => {
    db = b;
    app.listen(port, () => console.log(`Rodando na porta ${port}`));
}).catch(err => console.error("Falha no boot:", err));