#!/bin/bash
set -e

echo "==================================="
echo "🚀 LSP Multiplexor para $LANGUAGE"
echo "==================================="
echo "📦 Lenguaje: $LANGUAGE"
echo "📁 Workspace: /workspace"
echo "🌐 Puerto WebSocket: ${LSPMUX_PORT:-3000}"
echo "👥 Máximo clientes: ${MAX_CLIENTS:-4}"
echo "==================================="

# Verificar que el LSP está instalado
case "$LANGUAGE" in
  python)
    which pylsp > /dev/null 2>&1 || { echo "❌ pylsp no encontrado"; exit 1; }
    echo "✅ pylsp: $(which pylsp)"
    ;;
  cpp)
    which clangd > /dev/null 2>&1 || { echo "❌ clangd no encontrado"; exit 1; }
    echo "✅ clangd: $(which clangd)"
    ;;
  typescript)
    which typescript-language-server > /dev/null 2>&1 || { echo "❌ typescript-language-server no encontrado"; exit 1; }
    echo "✅ typescript-language-server: $(which typescript-language-server)"
    ;;
  *)
    echo "❌ LANGUAGE no soportado: $LANGUAGE"
    echo "Use: python | cpp | typescript"
    exit 1
    ;;
esac

echo "==================================="
echo "🎯 Iniciando multiplexor..."
echo "==================================="

cd /app
exec node server.js