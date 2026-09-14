# Dockerfile em multiplos estagios (multi-stage build).
#
# A ideia de usar dois estagios e simples: no primeiro instalamos tudo o que for
# necessario, e no segundo copiamos apenas o que a aplicacao realmente precisa
# para rodar. Assim a imagem final fica menor e carrega menos coisas
# desnecessarias.

# ----------------------------------------------------------------------------
# Estagio 1: instalacao das dependencias
# ----------------------------------------------------------------------------
FROM node:24-alpine AS dependencias

WORKDIR /app

# Copiamos primeiro apenas os arquivos de dependencias, antes do codigo fonte.
# Isso e proposital: o Docker guarda em cache cada etapa, e enquanto estes dois
# arquivos nao mudarem ele reaproveita a instalacao ja feita, deixando os builds
# seguintes bem mais rapidos.
COPY package.json package-lock.json ./

# O comando "npm ci" instala exatamente as versoes registradas no
# package-lock.json. O parametro --omit=dev descarta as dependencias que so
# servem para teste, pois elas nao sao necessarias em producao.
RUN npm ci --omit=dev

# ----------------------------------------------------------------------------
# Estagio 2: imagem final que vai de fato executar a aplicacao
# ----------------------------------------------------------------------------
FROM node:24-alpine AS producao

WORKDIR /app

# A imagem oficial do Node ja traz um usuario sem privilegios chamado "node".
# Rodar a aplicacao com ele, em vez do usuario root, e uma boa pratica de
# seguranca: se alguem conseguir explorar alguma falha da aplicacao, tera
# permissoes bem limitadas dentro do container.
ENV NODE_ENV=production

# Trazemos do primeiro estagio apenas a pasta de dependencias ja instalada.
COPY --from=dependencias /app/node_modules ./node_modules

# Agora copiamos o codigo da aplicacao, ja definindo o usuario "node" como dono
# dos arquivos.
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

# A partir daqui todos os comandos rodam com o usuario sem privilegios.
USER node

# Porta em que a aplicacao escuta dentro do container.
EXPOSE 3000

# O HEALTHCHECK ensina o Docker a verificar se a aplicacao esta realmente
# funcionando, e nao apenas se o processo esta de pe. Ele chama a rota /health,
# que por sua vez confirma tambem a conexao com o Redis.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/servidor.js"]
