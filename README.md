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

### A liberação também precisa de cuidado

Na hora de liberar a trava não basta simplesmente apagar a chave. Considere esta
sequência problemática:

1. A requisição A pega a trava e começa a processar.
2. O processamento de A demora mais que os 10 segundos, e a trava expira.
3. A requisição B pega a trava, porque a chave estava livre.
4. A requisição A termina e manda apagar a chave.

No passo 4, a requisição A apagaria a trava que agora pertence à B. Para evitar
isso, cada trava guarda um **token único** que identifica o seu dono, e a
liberação só acontece se o token informado for igual ao que está gravado.

Essa verificação é feita por um pequeno script em Lua executado pelo próprio
Redis, porque o Redis roda o script inteiro sem interrupção. Isso garante que
nada aconteça entre "conferir o dono" e "apagar a chave".

## Endpoints disponíveis

| Método | Rota                      | O que faz                                              |
| ------ | ------------------------- | ------------------------------------------------------ |
| POST   | `/pagamentos`             | Processa um pagamento protegido pela trava distribuída |
| GET    | `/pagamentos/:faturaId`   | Consulta um pagamento já processado                    |
| GET    | `/health`                 | Informa se a API e o Redis estão saudáveis             |

### Respostas do POST /pagamentos

| Código | Quando acontece                                              |
| ------ | ------------------------------------------------------------ |
| 201    | O pagamento foi processado com sucesso                       |
| 200    | A fatura já havia sido paga antes (idempotência)             |
| 400    | Os campos "faturaId" ou "valor" estão ausentes ou inválidos  |
| 409    | A fatura já está sendo processada por outra requisição       |

## Estrutura do projeto

```
src/
  redis.js            cria a conexão com o Redis
  servicoDeTrava.js   adquire e libera a trava distribuída
  app.js              monta a aplicação Express e as rotas
  servidor.js         ponto de entrada que sobe o servidor
testes/
  trava.unit.test.js            testes unitários (Redis simulado)
  pagamentos.integration.test.js testes de integração (Redis real)
```

## Como executar com Docker Compose (jeito mais simples)

O Compose sobe a API e o Redis juntos, com um comando só. Não é preciso ter o
Node.js nem o Redis instalados na máquina, apenas o Docker.

```bash
docker compose up -d
```

A API fica disponível em `http://localhost:3001`. Para conferir se subiu:

```bash
docker ps
curl http://localhost:3001/health
```

Para encerrar:

```bash
docker compose down
```

### Vendo a trava funcionar na prática

Com a aplicação no ar, dispare duas requisições ao mesmo tempo para a mesma
fatura. O `&` no final de cada linha faz as duas correrem em paralelo:

```bash
curl -X POST http://localhost:3001/pagamentos \
  -H 'Content-Type: application/json' \
  -d '{"faturaId":"FATURA-DEMO","valor":150}' &
curl -X POST http://localhost:3001/pagamentos \
  -H 'Content-Type: application/json' \
  -d '{"faturaId":"FATURA-DEMO","valor":150}' &
wait
```

Uma das requisições responde **201** (pagamento processado) e a outra responde
**409** (barrada pela trava). É exatamente esse o comportamento que o projeto
quer demonstrar: a pessoa não é cobrada duas vezes.

## Como executar localmente (sem Docker)

Neste caso é preciso ter o Node.js instalado e um Redis disponível.

```bash
# 1. Instalar as dependências
npm install

# 2. Subir um Redis (caso ainda não tenha um)
docker run -d -p 6379:6379 redis:7-alpine

# 3. Iniciar a aplicação
npm start
```

A API sobe em `http://localhost:3000`. O endereço do Redis pode ser alterado
pela variável de ambiente `REDIS_URL`.

## Como rodar os testes

O projeto tem dois níveis de teste, com propósitos diferentes.

### Testes unitários

Usam a biblioteca `ioredis-mock`, que simula o Redis em memória. Por isso rodam
em qualquer lugar, sem precisar de nenhum serviço externo:

```bash
npm run test:unit
```

### Testes de integração

Rodam contra um Redis de verdade, comprovando o comportamento real do `SET NX`
e do script Lua. É aqui que fica o teste das duas requisições simultâneas:

```bash
# Sobe um Redis para os testes
docker run -d --name redis-teste -p 6379:6379 redis:7-alpine

npm run test:integration

# Ao terminar, remove o container
docker rm -f redis-teste
```

## CI/CD com GitHub Actions

O repositório tem dois workflows configurados:

- **CI** (`.github/workflows/ci.yml`) — roda a cada push e a cada Pull Request.
  Executa os testes unitários, os testes de integração (com um Redis subido
  automaticamente pelo GitHub como _service container_) e, se tudo passar,
  confirma que a imagem Docker continua sendo construída sem erros.
- **CD** (`.github/workflows/cd.yml`) — roda quando o código chega no branch
  `main`. Constrói a imagem Docker e a publica no GitHub Container Registry.

## Sobre a imagem Docker

O `Dockerfile` usa build em múltiplos estágios: um estágio instala as
dependências e outro monta a imagem final, que fica menor por não carregar nada
além do necessário para executar.

A aplicação roda com o usuário `node`, sem privilégios de administrador, e a
imagem tem um `HEALTHCHECK` que consulta a rota `/health` periodicamente para
que o Docker saiba se a aplicação está realmente saudável.
