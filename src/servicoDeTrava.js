// Servico responsavel pela trava distribuida (tambem chamada de "lock").
//
// A trava e o mecanismo que garante que apenas uma requisicao por vez consiga
// processar uma determinada fatura. Todo o raciocinio esta comentado passo a
// passo porque esta e a parte mais importante do projeto.

const crypto = require('crypto');

// Tempo de vida da trava, em milissegundos. Depois desse prazo o Redis apaga a
// chave sozinho. Isso evita que uma fatura fique bloqueada para sempre caso a
// aplicacao seja encerrada no meio do processamento, antes de liberar a trava.
const TEMPO_DE_VIDA_DA_TRAVA_EM_MS = 10000;

// Monta o nome da chave usada no Redis. Usamos um prefixo para deixar claro,
// ao inspecionar o Redis, que aquela chave e uma trava de pagamento.
function montarChaveDaTrava(faturaId) {
  return `trava:pagamento:${faturaId}`;
}

// Cada tentativa de trava recebe um token aleatorio e unico. Esse token e o
// "dono" da trava, e ele sera essencial na hora de liberar com seguranca.
function gerarTokenDoDono() {
  return crypto.randomUUID();
}

// Tenta adquirir a trava da fatura.
//
// Retorna o token do dono se conseguiu, ou null se a fatura ja estava travada
// por outra requisicao.
async function adquirirTravaDoPagamento(conexaoComRedis, faturaId) {
  const chave = montarChaveDaTrava(faturaId);
  const token = gerarTokenDoDono();

  // Aqui esta o coracao da solucao. O comando executado e:
  //
  //   SET trava:pagamento:<id> <token> NX PX 10000
  //
  // O parametro NX ("only set if Not eXists") faz o Redis gravar a chave
  // somente se ela ainda nao existir. Como o Redis processa os comandos um de
  // cada vez, nao existe a possibilidade de duas requisicoes simultaneas
  // receberem "OK" ao mesmo tempo: uma delas obrigatoriamente chega depois e
  // encontra a chave ja criada.
  //
  // O parametro PX define a validade da chave em milissegundos, funcionando
  // como a rede de seguranca explicada acima.
  const resposta = await conexaoComRedis.set(
    chave,
    token,
    'PX',
    TEMPO_DE_VIDA_DA_TRAVA_EM_MS,
    'NX',
  );

  // Quando o NX impede a gravacao, o Redis devolve null em vez de "OK".
  if (resposta !== 'OK') {
    return null;
  }

  return token;
}

// Script em linguagem Lua usado para liberar a trava com seguranca.
//
// Por que um script em vez de simplesmente apagar a chave?
//
// Imagine este cenario problematico:
//   1. A requisicao A pega a trava e comeca a processar.
//   2. O processamento de A demora mais que os 10 segundos e a trava expira.
//   3. A requisicao B pega a trava, porque a chave estava livre.
//   4. A requisicao A termina e manda apagar a chave.
//
// No passo 4, a requisicao A apagaria a trava que agora pertence a B, e B
// ficaria desprotegida. Para evitar isso, so apagamos a chave se o valor
// guardado nela ainda for o nosso token.
//
// A verificacao e a exclusao precisam acontecer de forma indivisivel, sem que
// nada aconteca entre uma e outra. O Redis executa cada script Lua inteiro sem
// interrupcao, e e justamente isso que garante essa indivisibilidade.
const SCRIPT_LUA_DE_LIBERACAO = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

// Libera a trava da fatura, mas apenas se o token informado for o dono dela.
//
// Retorna true se a trava foi realmente liberada por nos, e false se ela ja
// pertencia a outra requisicao (ou ja havia expirado).
async function liberarTrava(conexaoComRedis, faturaId, token) {
  const chave = montarChaveDaTrava(faturaId);

  // O "1" indica ao Redis que o primeiro argumento e uma chave (KEYS[1]) e os
  // seguintes sao valores comuns (ARGV[1]).
  const quantidadeDeChavesApagadas = await conexaoComRedis.eval(
    SCRIPT_LUA_DE_LIBERACAO,
    1,
    chave,
    token,
  );

  return Number(quantidadeDeChavesApagadas) === 1;
}

module.exports = {
  adquirirTravaDoPagamento,
  liberarTrava,
  montarChaveDaTrava,
  TEMPO_DE_VIDA_DA_TRAVA_EM_MS,
};
