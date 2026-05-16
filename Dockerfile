# Dashboard Celeiro - deploy em cloud (Node + servir frontend estático)
FROM node:20-alpine

WORKDIR /app

# Ferramentas de build (algumas deps nativas do npm)
RUN apk add --no-cache python3 make g++

# Dependências do servidor (npm install tolera lock file desatualizado)
COPY server/package*.json server/
RUN cd server && npm install --omit=dev

# Código do servidor
COPY server server/

# Frontend (servido por express.static em server.js)
COPY index.html app.js styles.css ./
COPY assets assets/

WORKDIR /app/server

# Uploads: diretório será criado em runtime (efêmero sem volume)
ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "server.js"]
