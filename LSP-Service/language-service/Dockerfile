# language-service/Dockerfile
FROM python:3.10-slim

# Instalar dependencias del sistema
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Instalar Docker CLI (para comunicarse con el daemon del host)
RUN curl -fsSL https://get.docker.com -o get-docker.sh && \
    sh get-docker.sh && \
    rm get-docker.sh

WORKDIR /app

# Copiar dependencias primero para aprovechar cache de Docker
COPY require.txt .
RUN pip install --no-cache-dir -r require.txt

# Copiar el código de la aplicación
COPY . .

# Crear directorio para proyectos
RUN mkdir -p /home/projects

EXPOSE 8135

# Comando para ejecutar la aplicación
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8135"]