// Testes de integracao.
//
// Diferente dos testes unitarios, estes rodam contra um Redis DE VERDADE. Isso
// e importante porque algumas partes do projeto (principalmente o script Lua e
// o comportamento exato do SET com NX) dependem do Redis real para serem
// comprovadas de fato.
//
// Para rodar localmente e preciso ter um Redis no ar, por exemplo com:
//   docker run -d -p 6379:6379 redis:7-alpine

const Redis = require('ioredis');
const requisicaoDeTeste = require('supertest');

const { criarAplicacao } = require('../src/app');
const { adquirirTravaDoPagamento } = require('../src/servicoDeTrava');

const ENDERECO_DO_REDIS = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

describe('Integracao com o Redis real', () => {
  let conexaoComRedis;
  let aplicacao;

  beforeAll(() => {
    conexaoComRedis = new Redis(ENDERECO_DO_REDIS);
    aplicacao = criarAplicacao(conexaoComRedis);
  });

  // Ao final de todos os testes fechamos a conexao, senao o Jest ficaria
  // esperando por um recurso que nunca e liberado.
  afterAll(async () => {
    await conexaoComRedis.quit();
  });

  // Limpamos as chaves antes de cada teste para garantir que uma trava deixada
  // por um teste anterior nao atrapalhe o proximo.
  beforeEach(async () => {
    await conexaoComRedis.flushall();
  });

  test('o Redis real responde ao comando PING', async () => {
    const resposta = await conexaoComRedis.ping();

    expect(resposta).toBe('PONG');
  });

  test('a rota de healthcheck confirma a conexao com o Redis real', async () => {
    const resposta = await requisicaoDeTeste(aplicacao).get('/health');

    expect(resposta.status).toBe(200);
    expect(resposta.body.redis).toBe('conectado');
  });

  test('processa um pagamento usando o Redis real', async () => {
    const resposta = await requisicaoDeTeste(aplicacao)
      .post('/pagamentos')
      .send({ faturaId: 'FATURA-REAL-1', valor: 120 });

    expect(resposta.status).toBe(201);
    expect(resposta.body.pagamento.status).toBe('processado');
  });

  test('a trava expira sozinha depois do prazo definido', async () => {
    // Criamos manualmente uma trava com validade bem curta (300 ms) para nao
    // deixar o teste lento, e conferimos que o proprio Redis a remove.
    await conexaoComRedis.set(
      'trava:pagamento:FATURA-REAL-2',
      'token-qualquer',
      'PX',
      300,
      'NX',
    );

    // Logo apos criar, a trava ainda existe.
    const existeAgora = await conexaoComRedis.get(
      'trava:pagamento:FATURA-REAL-2',
    );
    expect(existeAgora).not.toBeNull();

    // Esperamos o prazo passar.
    await new Promise((resolver) => setTimeout(resolver, 500));

    const existeDepois = await conexaoComRedis.get(
      'trava:pagamento:FATURA-REAL-2',
    );
    expect(existeDepois).toBeNull();
  });

  // Este e o teste mais importante do projeto: ele comprova a tese de que duas
  // requisicoes simultaneas para a mesma fatura nao sao processadas duas vezes.
  test('duas requisicoes simultaneas: apenas uma e processada', async () => {
    const dadosDoPagamento = { faturaId: 'FATURA-CONCORRENTE', valor: 999 };

    // Disparamos as duas requisicoes SEM esperar a primeira terminar. O
    // Promise.all faz as duas correrem ao mesmo tempo, reproduzindo o clique
    // duplo no botao de pagar.
    const [primeiraResposta, segundaResposta] = await Promise.all([
      requisicaoDeTeste(aplicacao).post('/pagamentos').send(dadosDoPagamento),
      requisicaoDeTeste(aplicacao).post('/pagamentos').send(dadosDoPagamento),
    ]);

    const statusRecebidos = [primeiraResposta.status, segundaResposta.status];

    // Uma das duas precisa ter sido processada com sucesso (201) e a outra
    // precisa ter sido barrada pela trava (409). Nao importa qual delas venceu
    // a corrida, e sim que exatamente uma venceu.
    expect(statusRecebidos).toContain(201);
    expect(statusRecebidos).toContain(409);
  });

  test('a fatura volta a aceitar pagamento depois da trava ser liberada', async () => {
    // Primeiro pagamento: processa normalmente e libera a trava ao final.
    const primeiraResposta = await requisicaoDeTeste(aplicacao)
      .post('/pagamentos')
      .send({ faturaId: 'FATURA-REAL-3', valor: 50 });

    expect(primeiraResposta.status).toBe(201);

    // Como a trava ja foi liberada, uma nova tentativa nao recebe 409. Ela cai
    // na verificacao de idempotencia e recebe 200, informando que a fatura ja
    // havia sido paga.
    const segundaResposta = await requisicaoDeTeste(aplicacao)
      .post('/pagamentos')
      .send({ faturaId: 'FATURA-REAL-3', valor: 50 });

    expect(segundaResposta.status).toBe(200);
    expect(segundaResposta.body.mensagem).toContain('ja havia sido paga');
  });

  test('a trava adquirida por fora bloqueia a rota de pagamento', async () => {
    // Adquirimos a trava diretamente pelo servico, simulando outra instancia da
    // aplicacao que esta processando a fatura neste exato momento.
    const token = await adquirirTravaDoPagamento(
      conexaoComRedis,
      'FATURA-REAL-4',
    );
    expect(token).not.toBeNull();

    const resposta = await requisicaoDeTeste(aplicacao)
      .post('/pagamentos')
      .send({ faturaId: 'FATURA-REAL-4', valor: 77 });

    expect(resposta.status).toBe(409);
  });
});
