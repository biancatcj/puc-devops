// Aqui montamos a aplicacao Express com todas as rotas.
//
// Repare que a conexao com o Redis NAO e criada dentro deste arquivo: ela chega
// pronta, como parametro da funcao criarAplicacao. Isso e proposital e se chama
// injecao de dependencia. Gracas a isso, nos testes unitarios conseguimos
// entregar uma conexao simulada (em memoria) e, na execucao real, uma conexao
// de verdade, sem mudar uma unica linha deste arquivo.

const express = require('express');
const { adquirirTravaDoPagamento, liberarTrava } = require('./servicoDeTrava');
const { validarPagamento } = require('./validadores');

// Enquanto o objetivo do trabalho e demonstrar a trava distribuida, guardamos
// os pagamentos ja processados em um mapa na memoria. Em um sistema real este
// seria o banco de dados da aplicacao.
function criarAplicacao(conexaoComRedis) {
  const aplicacao = express();
  const pagamentosJaProcessados = new Map();

  // Permite que o Express entenda corpos de requisicao no formato JSON.
  aplicacao.use(express.json());

  // Rota de verificacao de saude. O Docker usa esta rota no HEALTHCHECK para
  // saber se o container esta realmente funcionando, e nao apenas "de pe".
  aplicacao.get('/health', async (_requisicao, resposta) => {
    try {
      // O comando PING confirma que o Redis esta respondendo. Nao basta a API
      // estar no ar: sem o Redis ela nao consegue travar nada.
      await conexaoComRedis.ping();
      return resposta.status(200).json({ status: 'ok', redis: 'conectado' });
    } catch (erro) {
      return resposta
        .status(503)
        .json({ status: 'indisponivel', redis: 'desconectado' });
    }
  });

  // Rota que processa um pagamento, protegida pela trava distribuida.
  aplicacao.post('/pagamentos', async (requisicao, resposta) => {
    const { faturaId, valor } = requisicao.body || {};

    // Passo 1: validar a entrada antes de qualquer outra coisa. Nao faz sentido
    // ocupar o Redis com uma requisicao que ja sabemos estar incorreta. As
    // regras ficam no modulo validadores.js, o que permite testa-las sozinhas.
    const validacao = validarPagamento(requisicao.body);

    if (!validacao.valido) {
      return resposta.status(400).json({ erro: validacao.erro });
    }

    // Passo 2: tentar adquirir a trava desta fatura.
    const token = await adquirirTravaDoPagamento(conexaoComRedis, faturaId);

    // Se o token veio nulo, outra requisicao pegou a trava primeiro. Esta e
    // exatamente a situacao que o projeto quer demonstrar: a segunda requisicao
    // simultanea e barrada, e a pessoa nao e cobrada duas vezes.
    if (token === null) {
      return resposta.status(409).json({
        erro: 'Esta fatura ja esta sendo processada neste momento.',
        faturaId,
      });
    }

    // A partir daqui somos os donos da trava. Usamos try/finally para garantir
    // que a trava sera liberada mesmo que o processamento lance um erro; sem
    // isso, uma falha deixaria a fatura bloqueada ate a expiracao do prazo.
    try {
      // Passo 3: verificar a idempotencia. Se a fatura ja foi paga antes, nao
      // processamos de novo; apenas devolvemos o resultado anterior.
      if (pagamentosJaProcessados.has(faturaId)) {
        return resposta.status(200).json({
          mensagem: 'Esta fatura ja havia sido paga anteriormente.',
          pagamento: pagamentosJaProcessados.get(faturaId),
        });
      }

      // Passo 4: processar o pagamento de fato.
      const pagamento = {
        faturaId,
        valor,
        status: 'processado',
        processadoEm: new Date().toISOString(),
      };

      pagamentosJaProcessados.set(faturaId, pagamento);

      return resposta.status(201).json({
        mensagem: 'Pagamento processado com sucesso.',
        pagamento,
      });
    } finally {
      // Passo 5: liberar a trava informando o nosso token, para que o script
      // Lua confirme que ainda somos o dono antes de apagar a chave.
      await liberarTrava(conexaoComRedis, faturaId, token);
    }
  });

  // Rota de consulta de um pagamento ja processado.
  aplicacao.get('/pagamentos/:faturaId', (requisicao, resposta) => {
    const { faturaId } = requisicao.params;
    const pagamento = pagamentosJaProcessados.get(faturaId);

    if (!pagamento) {
      return resposta
        .status(404)
        .json({ erro: 'Nenhum pagamento encontrado para esta fatura.' });
    }

    return resposta.status(200).json({ pagamento });
  });

  return aplicacao;
}

module.exports = { criarAplicacao };
