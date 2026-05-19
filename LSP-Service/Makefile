.PHONY: help setup deploy build up down logs restart clean test shell ps discover create-containers cleanup-containers

COMPOSE := $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")

# ─── Ayuda ───

help:
	@echo "╔════════════════════════════════════════════════════╗"
	@echo "║   LSP SERVICE - Comandos disponibles              ║"
	@echo "╠════════════════════════════════════════════════════╣"
	@echo "║ INSTALACIÓN Y DESPLIEGUE                          ║"
	@echo "║  make setup [n]   - Instalación completa (n instancias) (setup-dev.sh)"
	@echo "║  make deploy [n]  - Despliegue rápido (n instancias) (deploy-dev.sh)"
	@echo "║  make build       - Construir todas las imágenes"
	@echo "║  make up [n]      - Levantar servicios (n instancias)"
	@echo "║  make down        - Detener servicios"
	@echo "║  make restart     - Reiniciar servicios"
	@echo "║  make clean       - Limpiar todo"
	@echo "╠════════════════════════════════════════════════════╣"
	@echo "║ MONITOREO                                         ║"
	@echo "║  make logs        - Ver logs en tiempo real"
	@echo "║  make ps          - Ver todos los contenedores"
	@echo "║  make shell       - Entrar al contenedor del API"
	@echo "║  make redis-cli   - Acceder a Redis CLI"
	@echo "╠════════════════════════════════════════════════════╣"
	@echo "║ PRUEBAS                                           ║"
	@echo "║  make test        - Prueba rápida de creación y consulta"
	@echo "║  make discover    - Descubrir instancias"
	@echo "║  make create [n]  - Crear contenedores LSP en cada instancia"
	@echo "║  make cleanup-lsp - Eliminar contenedores LSP"
	@echo "║  make test-full   - Flujo completo de prueba"
	@echo "╚════════════════════════════════════════════════════╝"
	@echo ""
	@echo "Ejemplos:"
	@echo "  make setup 3     # Instalar con 3 instancias"
	@echo "  make deploy 2    # Desplegar 2 instancias"
	@echo "  make up 3        # Levantar 3 instancias"
	@echo "  make create 3    # Crear LSPs en 3 instancias"

# ─── Instalación y despliegue ───

setup:
	@chmod +x setup-dev.sh 2>/dev/null || true
	@./setup-dev.sh $(filter-out $@,$(MAKECMDGOALS))

deploy:
	@chmod +x deploy-dev.sh 2>/dev/null || true
	@./deploy-dev.sh $(filter-out $@,$(MAKECMDGOALS))

build:
	@echo "Construyendo imagen lsp-server..."
	@docker build -t lsp-server:latest ./lsp-container 2>/dev/null || echo "  (lsp-container no encontrado, saltando)"
	@echo "Construyendo imagen language-service..."
	$(COMPOSE) build

up:
	$(COMPOSE) up -d --scale language-service=$(or $(filter-out $@,$(MAKECMDGOALS)),1)

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart

clean:
	@echo "Limpiando todo..."
	$(COMPOSE) down -v
	-docker rm -f $$(docker ps -q --filter "name=lsp-") 2>/dev/null || true
	-docker rmi lsp-server:latest lsp-service-language-service 2>/dev/null || true
	@echo "✓ Limpieza completada"

# ─── Monitoreo ───

logs:
	$(COMPOSE) logs -f

ps:
	@echo "╔════════════════════════════════════════════════════╗"
	@echo "║   CONTENEDORES ACTIVOS                            ║"
	@echo "╠════════════════════════════════════════════════════╣"
	@echo "║ API (language-service):                           ║"
	@docker ps --filter "name=lsp-service-language-service" --format "  {{.Names}}\t{{.Ports}}" 2>/dev/null || echo "  (ninguno)"
	@echo "╠════════════════════════════════════════════════════╣"
	@echo "║ Contenedores LSP:                                 ║"
	@docker ps --filter "name=lsp-" --format "  {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "  (ninguno)"
	@echo "╠════════════════════════════════════════════════════╣"
	@echo "║ Otros:                                            ║"
	@docker ps --filter "name=redis-lsp" --format "  {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "  (ninguno)"
	@echo "╚════════════════════════════════════════════════════╝"

shell:
	@CONTAINER=$$(docker ps --filter "name=lsp-service-language-service" -q | head -1); \
	if [ -n "$$CONTAINER" ]; then \
		docker exec -it $$CONTAINER bash; \
	else \
		echo "No hay instancias corriendo. Ejecuta: make up"; \
	fi

redis-cli:
	docker exec -it redis-lsp redis-cli

# ─── Pruebas ───

discover:
	@chmod +x discover-dev.sh 2>/dev/null || true
	@./discover-dev.sh -d

create:
	@chmod +x discover-dev.sh create-lsp-dev.sh 2>/dev/null || true
	@./discover-dev.sh

create-containers:
	@chmod +x create-lsp-dev.sh 2>/dev/null || true
	@./create-lsp-dev.sh $(filter-out $@,$(MAKECMDGOALS))

cleanup-lsp:
	@chmod +x cleanup-dev.sh 2>/dev/null || true
	@./cleanup-dev.sh $(filter-out $@,$(MAKECMDGOALS))

test:
	@chmod +x cleanup-dev.sh 2>/dev/null || true
	@./discover-dev.sh $(filter-out $@,$(MAKECMDGOALS))

test-full:
	@echo "=== FLUJO COMPLETO DE PRUEBA ==="
	@echo ""
	@echo "1. Verificando servicios..."
	@docker ps --filter "name=lsp-service-language-service" --format "  {{.Names}}: {{.Ports}}" || echo "  ❌ No hay instancias"
	@echo ""
	@echo "2. Creando contenedores LSP..."
	@chmod +x discover-dev.sh 2>/dev/null || true
	@./discover-dev.sh
	@echo ""
	@echo "3. Verificando contenedores LSP..."
	@docker ps --filter "name=auto-project" --format "  {{.Names}}: {{.Ports}}" || echo "  ❌ No se crearon"
	@echo ""
	@echo "4. Probando conectividad..."
	@PORT=$$(docker ps --filter "name=lsp-service-language-service" --format '{{.Ports}}' | grep -oP '0\.0\.0\.0:\K[0-9]+' | head -1); \
	if [ -n "$$PORT" ]; then \
		echo "  Listando contenedores en puerto $$PORT:"; \
		curl -s http://localhost:$$PORT/lsp/ | python3 -m json.tool 2>/dev/null || echo "  ❌ No se pudo consultar"; \
	fi
	@echo ""
	@echo "✅ Prueba completada"

# ─── Atrapar argumentos extra ───
%:
	@: