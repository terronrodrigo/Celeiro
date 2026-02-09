# Dashboard Celeiro - deploy em cloud (Node + servir frontend estático)
FROM node:20-alpine

WORKDIR /app

# Dependências do servidor
COPY server/package*.json server/
RUN cd server && npm ci --omit=dev

# Código do servidor
COPY server server/

# Frontend (servido por express.static em server.js)
COPY index.html app.js styles.css ./

WORKDIR /app/server

# Uploads: diretório será criado em runtime (efêmero sem volume)
ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "server.js"]
