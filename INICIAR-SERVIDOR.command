#!/bin/bash
cd "$(dirname "$0")/server"

echo "=========================================="
echo "  Dashboard Celeiro - Iniciando servidor"
echo "=========================================="
echo ""

if ! command -v node &> /dev/null; then
  echo "ERRO: Node.js não está instalado."
  echo "Instale em: https://nodejs.org"
  echo ""
  read -p "Pressione Enter para fechar..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Instalando dependências (primeira vez)..."
  npm install
  echo ""
fi

echo "Servidor subindo em: http://localhost:3001"
echo ""
echo "Abra no navegador: http://localhost:3001"
echo ""
echo "Para parar: feche esta janela ou pressione Ctrl+C"
echo "=========================================="
echo ""

npm start

read -p "Pressione Enter para fechar..."
