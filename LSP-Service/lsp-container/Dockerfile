FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_VERSION=20.x

# Instala dependencias base
RUN apt-get update && apt-get install -y \
    clangd \
    python3 python3-pip \
    curl \
    wget \
    ca-certificates \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Instala Node.js 20 (más reciente y compatible)
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_VERSION nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Instala servidores LSP + linters esenciales para diagnostics.
# Nota: `python-lsp-server[all]` debería incluirlos, pero los fijamos explícitamente
# para evitar imágenes que arranquen sin plugins de lint disponibles.
RUN pip3 install "python-lsp-server[all]" pyflakes pycodestyle
RUN python3 -c "import pylsp, pyflakes, pycodestyle; print('✅ pylsp + linters instalados')"
RUN npm install -g typescript-language-server typescript

# Crea directorio de trabajo para el puente WebSocket
WORKDIR /app

# Copia archivos de configuración del puente
COPY package.json .
COPY server.js .
COPY config/ ./config/

# Instala dependencias Node.js del puente
RUN npm install

# Script de entrada
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Puerto para WebSocket
EXPOSE 3000

# CORRECCIÓN: Crear el directorio /workspace durante el build
RUN mkdir -p /workspace

# Usuario no-root por seguridad
RUN useradd -m -u 1000 lspuser && \
    chown -R lspuser:lspuser /app /workspace

# Cambiar a usuario no-root
USER lspuser

ENTRYPOINT ["/entrypoint.sh"]
