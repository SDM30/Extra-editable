FROM python:3.13-slim
WORKDIR /usr/local/app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# compilar/ejecutar C++ + helper de sandbox (seccomp)
RUN apt-get update && apt-get install -y --no-install-recommends g++ gcc libseccomp-dev \
    && rm -rf /var/lib/apt/lists/*

COPY . .

# Compilar lanzador de sandbox que bloquea syscalls de procesos y red
RUN gcc -O2 -Wall -Wextra sandbox/sandbox_run.c -lseccomp -o /usr/local/bin/sandbox-run

# Ejecutar la API como usuario sin privilegios
RUN useradd --create-home --uid 10001 runner \
    && chown -R runner:runner /usr/local/app
USER runner

CMD ["uvicorn", "app.main:server", "--host", "0.0.0.0", "--port", "8000"]
