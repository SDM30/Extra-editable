FROM python:3.13-slim
WORKDIR /usr/local/app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# compilar/ejecutar C++
RUN apt-get update && apt-get install -y --no-install-recommends g++ \
    && rm -rf /var/lib/apt/lists/*

COPY . .
CMD ["uvicorn", "app.main:server", "--host", "0.0.0.0", "--port", "8000"]
