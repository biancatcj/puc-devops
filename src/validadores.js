// Regras de validacao dos dados que chegam pela API.
//
// Antes, estas verificacoes ficavam escritas dentro da propria rota, em
// app.js. Traze-las para um arquivo separado tem duas vantagens:
//
// 1. A rota fica mais curta e conta so a historia principal: valida, trava,
//    processa e libera.
// 2. As regras passam a ser testaveis sozinhas, sem precisar montar a
//    aplicacao inteira nem simular uma requisicao HTTP.

// Valor minimo aceito em um pagamento. Zero nao entra: e um numero valido,
// mas nao faz sentido como cobranca.
const VALOR_MINIMO = 0;

// Verifica os campos de um pedido de pagamento.
//
// Devolve sempre um objeto com o resultado, em vez de lancar um erro. Assim a
// rota decide o que fazer com a informacao, e quem le o codigo da rota enxerga
// o caminho de erro com clareza.
function validarPagamento(dados) {
  const { faturaId, valor } = dados || {};

  if (!faturaId) {
    return { valido: false, erro: 'O campo "faturaId" e obrigatorio.' };
  }

  if (typeof valor !== 'number' || Number.isNaN(valor) || valor <= VALOR_MINIMO) {
    return { valido: false, erro: 'O campo "valor" deve ser um numero maior que zero.' };
  }

  return { valido: true };
}

module.exports = { validarPagamento, VALOR_MINIMO };
