#!/bin/bash
# Teste local do deploy: build Docker e sobe o app (requer Docker instalado)
# Uso: ./test-deploy.sh
# Para parar: Ctrl+C e depois: docker stop celeiro-test

set -e
cd "$(dirname "$0")"

echo "🐳 Build da imagem Docker..."
docker build -t celeiro-dashboard:test .

echo ""
echo "✅ Build OK. Subindo container na porta 3001..."
echo "   Acesse: http://localhost:3001"
echo "   (Configure MONGODB_URI e ADMIN_USER/ADMIN_PASS no .env ou abaixo)"
echo ""

docker run --rm -p 3001:3001 \
  -e PORT=3001 \
  -e MONGODB_URI="${MONGODB_URI:-}" \
  -e ADMIN_USER="${ADMIN_USER:-admin}" \
  -e ADMIN_PASS="${ADMIN_PASS:-admin123}" \
  --name celeiro-test \
  celeiro-dashboard:test
