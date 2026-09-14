// Testes unitarios.
//
// "Unitario" aqui significa que estes testes NAO dependem de um Redis de
// verdade instalado na maquina. No lugar dele usamos a biblioteca
// ioredis-mock, que simula o comportamento do Redis em memoria.
//
// A vantagem e que estes testes rodam em qualquer lugar, inclusive no CI, sem
// precisar subir nenhum servico externo.

const RedisSimulado = require('ioredis-mock');
const requisicaoDeTeste = require('supertest');

const { criarAplicacao } = require('../src/app');
const {
  adquirirTravaDoPagamento,
  liberarTrava,
  montarChaveDaTrava,
} = require('../src/servicoDeTrava');

describe('Servico de trava distribuida', () => {
  let conexaoSimulada;

  // Antes de cada teste criamos um Redis simulado novo e vazio, para que um
  // teste nunca seja influenciado pelas chaves deixadas por outro.
  beforeEach(() => {
    conexaoSimulada = new RedisSimulado();
  });

  afterEach(async () => {
    await conexaoSimulada.flushall();
  });

  test('consegue adquirir a trava de uma fatura que esta livre', async () => {
    const token = await adquirirTravaDoPagamento(conexaoSimulada, 'FATURA-1');

    // Quando a trava e adquirida, recebemos o token que identifica o dono.
    expect(token).not.toBeNull();
    expect(typeof token).toBe('string');
  });

  test('nao consegue adquirir a trava de uma fatura ja travada', async () => {
    // A primeira tentativa pega a trava.
    const primeiroToken = await adquirirTravaDoPagamento(
      conexaoSimulada,
      'FATURA-2',
    );

    // A segunda tentativa, com a trava ainda ativa, precisa ser recusada.
    const segundoToken = await adquirirTravaDoPagamento(
      conexaoSimulada,
      'FATURA-2',
    );

    expect(primeiroToken).not.toBeNull();
    expect(segundoToken).toBeNull();
  });

  test('libera a trava quando o token informado e o do dono', async () => {
    const token = await adquirirTravaDoPagamento(conexaoSimulada, 'FATURA-3');

    const foiLiberada = await liberarTrava(conexaoSimulada, 'FATURA-3', token);

    expect(foiLiberada).toBe(true);

    // Depois de liberada, a chave nao deve mais existir no Redis.
    const chaveAindaExiste = await conexaoSimulada.get(
      montarChaveDaTrava('FATURA-3'),
    );
    expect(chaveAindaExiste).toBeNull();
  });

  test('nao libera a trava quando o token pertence a outro processo', async () => {
    await adquirirTravaDoPagamento(conexaoSimulada, 'FATURA-4');

    // Tentamos liberar usando um token qualquer, que nao e o do dono. Este e o
    // cenario perigoso que o script Lua protege: um processo antigo tentando
    // apagar a trava que agora pertence a outro.
    const foiLiberada = await liberarTrava(
      conexaoSimulada,
      'FATURA-4',
      'token-de-outro-processo',
    );

    expect(foiLiberada).toBe(false);

    // A trava do dono legitimo precisa continuar intacta.
    const chaveAindaExiste = await conexaoSimulada.get(
      montarChaveDaTrava('FATURA-4'),
    );
    expect(chaveAindaExiste).not.toBeNull();
  });

  test('a trava volta a ficar disponivel depois de ser liberada', async () => {
    const primeiroToken = await adquirirTravaDoPagamento(
      conexaoSimulada,
      'FATURA-5',
    );
    await liberarTrava(conexaoSimulada, 'FATURA-5', primeiroToken);

    // Com a trava liberada, uma nova requisicao deve conseguir adquiri-la.
    const segundoToken = await adquirirTravaDoPagamento(
      conexaoSimulada,
      'FATURA-5',
    );

    expect(segundoToken).not.toBeNull();
  });
});

describe('Rotas da API de pagamentos', () => {
  let conexaoSimulada;
  let aplicacao;

  beforeEach(() => {
    conexaoSimulada = new RedisSimulado();
    aplicacao = criarAplicacao(conexaoSimulada);
  });

  afterEach(async () => {
    await conexaoSimulada.flushall();
  });

  test('a rota de healthcheck responde que esta tudo certo', async () => {
    const resposta = await requisicaoDeTeste(aplicacao).get('/health');

    expect(resposta.status).toBe(200);
    expect(resposta.body.status).toBe('ok');
  });

  test('processa um pagamento valido e devolve 201', async () => {
    const resposta = await requisicaoDeTeste(aplicacao)
      .post('/pagamentos')
      .send({ faturaId: 'FATURA-100', valor: 250.5 });

    expect(resposta.status).toBe(201);
    expect(resposta.body.pagamento.faturaId).toBe('FATURA-100');
    expect(resposta.body.pagamento.status).toBe('processado');
  });

  test('recusa um pagamento sem o campo faturaId', async () => {
    const resposta = await requisicaoDeTeste(aplicacao)
      .post('/pagamentos')
      .send({ valor: 100 });

    expect(resposta.status).toBe(400);
  });

  test('recusa um pagamento com valor invalido', async () => {
    const resposta = await requisicaoDeTeste(aplicacao)
      .post('/pagamentos')
      .send({ faturaId: 'FATURA-101', valor: -5 });

    expect(resposta.status).toBe(400);
  });

  test('consulta um pagamento que ja foi processado', async () => {
    await requisicaoDeTeste(aplicacao)
      .post('/pagamentos')
      .send({ faturaId: 'FATURA-102', valor: 80 });

    const resposta = await requisicaoDeTeste(aplicacao).get(
      '/pagamentos/FATURA-102',
    );

    expect(resposta.status).toBe(200);
    expect(resposta.body.pagamento.valor).toBe(80);
  });

  test('devolve 404 ao consultar uma fatura que nunca foi paga', async () => {
    const resposta = await requisicaoDeTeste(aplicacao).get(
      '/pagamentos/FATURA-INEXISTENTE',
    );

    expect(resposta.status).toBe(404);
  });

  test('barra a segunda requisicao quando a fatura ja esta travada', async () => {
    // Simulamos uma requisicao que pegou a trava e ainda nao a liberou,
    // adquirindo a trava por fora antes de chamar a rota.
    await adquirirTravaDoPagamento(conexaoSimulada, 'FATURA-103');

    const resposta = await requisicaoDeTeste(aplicacao)
      .post('/pagamentos')
      .send({ faturaId: 'FATURA-103', valor: 300 });

    // A API precisa recusar com 409 Conflict, e nao processar o pagamento.
    expect(resposta.status).toBe(409);
  });
});
