# API de Pagamentos com Trava Distribuída no Redis

Projeto desenvolvido para a disciplina de DevOps. A proposta é construir uma API
de pagamentos em Node.js que resolva um problema muito comum em sistemas que
rodam em mais de uma instância: o **processamento em duplicidade**.

Este README é escrito de forma didática, explicando o problema antes de mostrar
a solução, para que qualquer pessoa consiga entender o raciocínio por trás do
código.

## O problema que este projeto resolve

Imagine que uma pessoa clica duas vezes no botão "Pagar" da tela de checkout.
Os dois cliques viram duas requisições para a mesma fatura, e elas chegam ao
servidor praticamente no mesmo instante.

Se a aplicação não tiver nenhuma proteção, as duas requisições vão:

1. Consultar o banco e ver que a fatura ainda não foi paga.
2. Concluir, cada uma por conta própria, que precisa processar o pagamento.
3. Cobrar a pessoa duas vezes pelo mesmo valor.

Esse cenário é conhecido como **condição de corrida** (ou _race condition_).
Ele fica ainda mais provável quando a aplicação roda em várias instâncias ao
mesmo tempo, porque aí nem mesmo uma variável em memória resolveria o problema:
cada instância tem a sua própria memória, e uma não enxerga a outra.

## Como a trava distribuída resolve

A ideia é combinar um ponto de acordo entre todas as instâncias. Esse ponto
comum é o **Redis**, um banco de dados em memória que todas as instâncias
conseguem acessar.

Antes de processar qualquer pagamento, a aplicação tenta "pegar a chave" da
fatura no Redis, usando o comando:

> SET trava:pagamento:FATURA token NX PX 10000

Os dois parâmetros do final são o coração da solução:

- **NX** significa _only set if Not eXists_, ou seja, "só grave se ainda não
  existir". É isso que garante que apenas uma requisição consegue criar a
  chave. Como o Redis executa os comandos um de cada vez, não existe a
  possibilidade de duas requisições vencerem juntas.
- **PX 10000** define um prazo de validade de 10 segundos para a trava. Esse
  prazo é uma rede de segurança: se a aplicação travar ou for reiniciada no meio
  do processamento, a trava expira sozinha e a fatura não fica bloqueada para
  sempre.

Quem consegue gravar a chave processa o pagamento. Quem não consegue recebe uma
resposta **409 Conflict**, indicando que aquela fatura já está sendo processada
naquele exato momento.

## Endpoints disponíveis

| Método | Rota                      | O que faz                                              |
| ------ | ------------------------- | ------------------------------------------------------ |
| POST   | `/pagamentos`             | Processa um pagamento protegido pela trava distribuída |
| GET    | `/pagamentos/:faturaId`   | Consulta um pagamento já processado                    |
| GET    | `/health`                 | Informa se a API e o Redis estão saudáveis             |

## Como executar

As instruções completas de execução local, via Docker Compose e de cada suíte de
testes são detalhadas ao longo do desenvolvimento do projeto.
