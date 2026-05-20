# LSP-Service/agent/Dockerfile
# Agente sidecar de recuperación para una instancia de language-service.
# Vive en el mismo nodo que el contenedor LSP y lo vigila vía Docker socket.
FROM python:3.13-slim

# Docker CLI para comunicarse con el daemon del host (docker inspect / docker start)
RUN apt-get update && apt-get install -y curl \
    && curl -fsSL https://get.docker.com -o get-docker.sh \
    && sh get-docker.sh && rm get-docker.sh \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir redis

COPY agent.py /agent.py

CMD ["python3", "/agent.py"]
