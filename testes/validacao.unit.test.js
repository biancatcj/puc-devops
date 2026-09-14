// Testes unitarios das regras de validacao dos pagamentos.
//
// Hoje a validacao dos campos "faturaId" e "valor" acontece dentro da propria
// rota, em src/app.js. Estes testes descrevem, de forma isolada, o que essas
// regras precisam garantir: eles passam pela rota agora e continuarao passando
// quando a validacao for movida para um modulo proprio.
//
// Assim como os demais testes unitarios do projeto, aqui usamos o Redis
// simulado em memoria (ioredis-mock). Nenhum servico externo precisa estar no
// ar para que estes testes rodem.

const RedisSimulado = require('ioredis-mock');
const requisicaoDeTeste = require('supertest');

const { criarAplicacao } = require('../src/app');

describe('Validacao dos dados do pagamento', () => {
  let conexaoSimulada;
  let aplicacao;

  beforeEach(() => {
    conexaoSimulada = new RedisSimulado();
    aplicacao = criarAplicacao(conexaoSimulada);
  });

  afterEach(async () => {
    await conexaoSimulada.flushall();
  });

  test('recusa a requisicao quando o corpo vem completamente vazio', async () => {
    const resposta = await requisicaoDeTeste(aplicacao).post('/pagamentos').send({});

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro).toContain('faturaId');
  });

  test('recusa a requisicao quando o valor nao e um numero', async () => {
    const resposta = await requisicaoDeTeste(aplicacao)
      .post('/pagamentos')
      .send({ faturaId: 'FATURA-200', valor: 'cem reais' });

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro).toContain('valor');
  });

  test('recusa a requisicao quando o valor e igual a zero', async () => {
    // O zero merece um teste proprio: ele e um numero valido, mas nao faz
    // sentido como cobranca, e a regra usa "maior que zero" justamente por isso.
    const resposta = await requisicaoDeTeste(aplicacao)
      .post('/pagamentos')
      .send({ faturaId: 'FATURA-201', valor: 0 });

    expect(resposta.status).toBe(400);
  });

  test('aceita um valor com centavos', async () => {
    const resposta = await requisicaoDeTeste(aplicacao)
      .post('/pagamentos')
      .send({ faturaId: 'FATURA-202', valor: 19.99 });

    expect(resposta.status).toBe(201);
    expect(resposta.body.pagamento.valor).toBe(19.99);
  });

  test('valida os campos antes de tentar usar o Redis', async () => {
    // Se a validacao acontecesse depois da trava, uma requisicao invalida
    // deixaria uma chave para tras no Redis. Conferimos que isso nao acontece.
    await requisicaoDeTeste(aplicacao).post('/pagamentos').send({ valor: 50 });

    const chaves = await conexaoSimulada.keys('trava:pagamento:*');
    expect(chaves).toHaveLength(0);
  });
});
