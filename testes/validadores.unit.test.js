// Testes unitarios do modulo de validadores.
//
// Estes sao os testes mais simples do projeto, e de proposito: o modulo
// validadores.js nao conversa com o Redis nem com o Express. Ele so recebe um
// objeto e responde se os dados estao corretos.
//
// Justamente por isso os testes daqui nao precisam de nenhuma preparacao: nao
// ha conexao para criar, nem aplicacao para montar, nem chave para limpar no
// final.

const { validarPagamento, VALOR_MINIMO } = require('../src/validadores');

describe('Validador de pagamento', () => {
  test('aceita um pagamento com faturaId e valor corretos', () => {
    const resultado = validarPagamento({ faturaId: 'FATURA-1', valor: 100 });

    expect(resultado.valido).toBe(true);
    expect(resultado.erro).toBeUndefined();
  });

  test('recusa quando o faturaId nao foi informado', () => {
    const resultado = validarPagamento({ valor: 100 });

    expect(resultado.valido).toBe(false);
    expect(resultado.erro).toContain('faturaId');
  });

  test('recusa quando o corpo da requisicao nao existe', () => {
    // A rota chama o validador com o corpo da requisicao, que pode vir vazio.
    // O validador precisa aguentar isso sem quebrar.
    expect(validarPagamento(undefined).valido).toBe(false);
    expect(validarPagamento(null).valido).toBe(false);
    expect(validarPagamento({}).valido).toBe(false);
  });

  test('recusa quando o valor nao e um numero', () => {
    expect(validarPagamento({ faturaId: 'F-1', valor: 'cem' }).valido).toBe(false);
    expect(validarPagamento({ faturaId: 'F-1', valor: null }).valido).toBe(false);
    expect(validarPagamento({ faturaId: 'F-1' }).valido).toBe(false);
  });

  test('recusa um valor igual ou menor que zero', () => {
    expect(validarPagamento({ faturaId: 'F-1', valor: VALOR_MINIMO }).valido).toBe(false);
    expect(validarPagamento({ faturaId: 'F-1', valor: -10 }).valido).toBe(false);
  });

  test('recusa o valor NaN, que passaria pela verificacao de tipo', () => {
    // O NaN e do tipo "number" em JavaScript, entao sem uma verificacao
    // propria ele escaparia da validacao e chegaria ao processamento.
    const resultado = validarPagamento({ faturaId: 'F-1', valor: NaN });

    expect(resultado.valido).toBe(false);
  });

  test('aceita um valor com centavos', () => {
    expect(validarPagamento({ faturaId: 'F-1', valor: 19.99 }).valido).toBe(true);
  });
});
