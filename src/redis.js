// Este arquivo concentra a criacao da conexao com o Redis.
//
// A conexao fica isolada aqui por dois motivos:
// 1. O restante da aplicacao nao precisa saber COMO o Redis e configurado,
//    apenas pedir uma conexao pronta para uso.
// 2. Nos testes unitarios nos trocamos esta conexao real por uma versao
//    simulada (em memoria), e isso so e simples porque a criacao esta em um
//    unico lugar.

const Redis = require('ioredis');

// O endereco do Redis vem de uma variavel de ambiente para que a aplicacao
// funcione tanto na maquina local (localhost) quanto dentro do Docker Compose,
// onde o Redis e alcancado pelo nome do servico ("redis"). Se a variavel nao
// estiver definida, assumimos o Redis local.
const ENDERECO_DO_REDIS = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

function criarConexaoComRedis() {
  const conexao = new Redis(ENDERECO_DO_REDIS, {
    // Se o Redis estiver fora do ar, preferimos que o comando falhe rapido e a
    // API responda um erro claro, em vez de deixar a requisicao pendurada
    // esperando indefinidamente por uma resposta.
    maxRetriesPerRequest: 2,
  });

  // Sem este tratador, uma falha de conexao viraria um erro nao capturado e
  // derrubaria o processo inteiro do Node.
  conexao.on('error', (erro) => {
    console.error('Erro na conexao com o Redis:', erro.message);
  });

  return conexao;
}

module.exports = { criarConexaoComRedis, ENDERECO_DO_REDIS };
