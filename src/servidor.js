// Ponto de entrada da aplicacao.
//
// Este arquivo tem uma unica responsabilidade: criar a conexao real com o
// Redis, montar a aplicacao e colocar o servidor no ar. A separacao entre
// "montar a aplicacao" (app.js) e "subir o servidor" (este arquivo) e o que
// permite que os testes usem a aplicacao sem precisar ocupar uma porta de rede.

const { criarAplicacao } = require('./app');
const { criarConexaoComRedis } = require('./redis');

const PORTA = process.env.PORT || 3000;

const conexaoComRedis = criarConexaoComRedis();
const aplicacao = criarAplicacao(conexaoComRedis);

const servidor = aplicacao.listen(PORTA, () => {
  console.log(`API de pagamentos escutando na porta ${PORTA}`);
});

// Quando o Docker precisa parar o container, ele envia o sinal SIGTERM. Se
// ignorarmos esse sinal, o Docker espera alguns segundos e encerra o processo a
// forca. Tratando o sinal, fechamos o servidor e a conexao com o Redis de forma
// organizada.
function encerrarDeFormaOrganizada() {
  console.log('Sinal de encerramento recebido, fechando a aplicacao...');

  servidor.close(() => {
    conexaoComRedis.quit();
    process.exit(0);
  });
}

process.on('SIGTERM', encerrarDeFormaOrganizada);
process.on('SIGINT', encerrarDeFormaOrganizada);
