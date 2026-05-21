# Despliegue con Ansible — Extra-editable

> Ejecutar todos los comandos desde la VM de **Samuel** (`10.43.99.252`), que actúa como Control Node.

## Distribución de VMs

| VM      | IP             | Servicios                                |
|---------|----------------|------------------------------------------|
| Samuel  | 10.43.99.252   | Control Node (solo Ansible)              |
| David   | 10.43.98.3     | Backend + Frontend + Gateway + Collab LB |
| Melissa | 10.43.100.126  | Collab Service (3 instancias)            |
| Chitiva | 10.43.99.41    | Code Execution Service                   |
| Gabriel | 10.43.100.88   | LSP Service (primario)                   |
| Simon   | 10.43.99.67    | LSP Service (réplica)                    |
| Campos  | 10.43.99.20    | LSP Load Balancer                        |

---

## Cómo abrir la aplicación web

Una vez que el despliegue terminó exitosamente, abrir en el navegador:

```
http://10.43.98.3:4200
```

Flujo básico:
1. Registrarse o hacer login
2. Crear un proyecto (C++, Python o TypeScript)
3. Escribir código en el editor
4. Clic en **RUN** — la salida aparece en tiempo real en el panel **OUTPUT**
5. Para programas interactivos: escribir en el campo `>` del panel de salida y presionar Enter

> **Nota:** El frontend usa `ng serve` (modo desarrollo). La primera carga puede tomar 15–30 segundos
> mientras Angular compila. Los logs se ven con `sudo journalctl -u extra-frontend -f` en David.

---

## Paso 1 — Instalar Ansible en Samuel *(solo la primera vez)*

```bash
sudo apt update && sudo apt install -y ansible sshpass
ansible --version
```

---

## Paso 2 — Clonar el repositorio en Samuel

```bash
git clone https://github.com/SDM30/Extra-editable.git
cd Extra-editable/ansible
```

---

## Paso 3 — Cifrar las credenciales con Vault *(solo la primera vez o si cambiaron)*

El archivo `inventory/group_vars/all/vault.yml` contiene contraseñas en texto plano. Hay que cifrarlo antes de cualquier despliegue.

```bash
ansible-vault encrypt inventory/group_vars/all/vault.yml
# Ingresa una contraseña maestra y recuérdala — se necesita en cada deploy
```

Para editarlo después:

```bash
ansible-vault edit inventory/group_vars/all/vault.yml --ask-vault-pass
```

---

## Paso 4 — Verificar conectividad SSH con todas las VMs

```bash
ansible all -m ping --ask-vault-pass
```

Debes ver `pong` de las 6 VMs: david, melissa, chitiva, gabriel, simon, campos.

---

## Paso 5 — *(Opcional)* Dry-run — revisar sin ejecutar

```bash
ansible-playbook playbooks/site.yml --check --ask-vault-pass
```

---

## Paso 6 — Ejecutar el despliegue completo

```bash
ansible-playbook playbooks/site.yml --ask-vault-pass
```

El playbook ejecuta 12 pasos en orden:

| #  | Tarea                                | VMs destino                          |
|----|--------------------------------------|--------------------------------------|
| 1  | Paquetes base + clonar repo          | **Todas**                            |
| 2  | Instalar Docker CE                   | david, chitiva, gabriel, simon       |
| 3  | Instalar Node.js 22                  | david, melissa, chitiva              |
| 4  | Instalar Python 3                    | david, campos                        |
| 5  | Backend Django                       | david                                |
| 6  | Collab Service ×3 (Hocuspocus)       | melissa                              |
| 7  | Collab Load Balancer (nginx)         | david                                |
| 8  | Code Execution Service               | chitiva                              |
| 9  | LSP Service                          | gabriel, simon                       |
| 10 | LSP Load Balancer                    | campos                               |
| 11 | API Gateway (Docker)                 | david                                |
| 12 | Frontend Angular                     | david                                |

---

## Paso 7 — Health checks post-despliegue

```bash
curl http://10.43.98.3:8000/api/        # Backend Django
curl http://10.43.98.3:8080/api/        # API Gateway
curl http://10.43.98.3:8083/health      # Collab Load Balancer
curl http://10.43.100.126:1234          # Collab Service (directo)
curl http://10.43.99.41:8081/health     # Code Execution
curl http://10.43.100.88:8135/docs      # LSP Service — Gabriel
curl http://10.43.99.67:8135/docs       # LSP Service — Simon
curl http://10.43.99.20:8085/health     # LSP Load Balancer
curl http://10.43.98.3:4200             # Frontend
```

---

## Comandos útiles

### Redesplegar un solo host o rol

```bash
# Solo el frontend (si cambió enviroment.ts):
ansible-playbook playbooks/site.yml --limit main_node --tags frontend --ask-vault-pass

# Solo collab (melissa):
ansible-playbook playbooks/site.yml --limit melissa --ask-vault-pass

# Solo los nodos LSP:
ansible-playbook playbooks/site.yml --limit lsp_servers --ask-vault-pass

# Solo el backend:
ansible-playbook playbooks/site.yml --limit main_node --tags backend --ask-vault-pass

# Solo el gateway:
ansible-playbook playbooks/site.yml --limit main_node --tags gateway --ask-vault-pass
```

### Ver logs en cada VM

```bash
# Backend (david)
sudo journalctl -u extra-backend -f

# Frontend (david)
sudo journalctl -u extra-frontend -f

# API Gateway (david)
docker logs api-gateway -f

# Collab LB (david)
docker logs collab-lb -f

# Collab Service — instancias (melissa)
sudo journalctl -u extra-collab@1234 -f
sudo journalctl -u extra-collab@1235 -f
sudo journalctl -u extra-collab@1236 -f

# Code Execution (chitiva)
sudo journalctl -u extra-code-exec -f

# LSP Watcher (gabriel / simon)
sudo journalctl -u lsp-watcher -f
```

### Reiniciar un servicio

```bash
sudo systemctl restart extra-backend
sudo systemctl restart extra-frontend
sudo systemctl restart extra-collab@1234
sudo systemctl restart extra-collab@1235
sudo systemctl restart extra-collab@1236
sudo systemctl restart extra-code-exec
sudo systemctl restart lsp-watcher
docker restart api-gateway
docker restart collab-lb
```

---

## Limitaciones conocidas (requieren cambio de código)

Estas limitaciones provienen del código de los servicios y NO se arreglan en
el playbook Ansible. Se documentan aquí para futura referencia.

### A. `collab-service` ignora la variable `FRONTEND_ORIGIN`

En `collab-service/src/server.js:7` el origen permitido para CORS está
hardcodeado a `http://localhost:4200` y el código no lee la variable de
entorno `FRONTEND_ORIGIN` aunque el systemd la inyecte.

**Impacto:** las respuestas HTTP directas al servicio collab (por ejemplo
`/dev-token`) devuelven `Access-Control-Allow-Origin: http://localhost:4200`.
Las conexiones WebSocket no se ven afectadas porque Hocuspocus no valida
Origin por defecto, y el cliente normalmente entra por el gateway (que sí
toma la IP correcta).

**Workaround:** sólo es relevante si se accede directo al collab desde un
Origin distinto. Acceder vía el gateway (`http://10.43.98.3:8080/collab`)
sigue funcionando. Resolución definitiva: PR al código que cambie la línea 7
a `const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:4200';`.

### B. `language-service` se registra en Redis con la IP del bridge docker

En `LSP-Service/language-service/app/main.py:48`, el `instance_id` que se
guarda en `lsp:instances` se calcula con
`socket.gethostbyname(socket.gethostname())`. Dentro de un contenedor en
modo bridge eso devuelve la IP del bridge (172.x.x.x), no la del host.
Resultado: el watcher en Campos genera upstreams a IPs inalcanzables.

**Workaround aplicado en el playbook:** Ansible despliega un
`docker-compose.ansible.yml` en cada nodo LSP (reemplaza al
`docker-compose.yml` del repo al lanzar el stack) que pone
`hostname: <ip_del_nodo>` y `ports: "8135:8135"` para el servicio
`language-service`. Con el hostname puesto a una IP literal,
`socket.gethostbyname(socket.gethostname())` la devuelve tal cual sin pasar
por /etc/hosts ni DNS, así que el `instance_id` que se registra en Redis
queda como `10.43.100.88:8135:<pid>` (o `10.43.99.67:8135:<pid>`) — la IP
real del nodo, alcanzable desde Campos.

El servicio se lanza con
`docker compose -f docker-compose.ansible.yml up -d --build`. El archivo
`docker-compose.yml` original del repo queda intacto para desarrollo local.

Resolución definitiva: PR al código que cambie `_get_instance_id` a usar
`os.getenv("WS_PUBLIC_HOST")` antes de caer en `gethostbyname`.

---

## Solución de errores comunes

### Frontend — La página no carga en `http://10.43.98.3:4200`

**Síntoma:** El navegador no conecta o muestra "Connection refused".

```bash
# Verificar que el servicio está corriendo (en David):
sudo systemctl status extra-frontend

# Si está fallando, ver el error:
sudo journalctl -u extra-frontend -n 50

# Reiniciar:
sudo systemctl restart extra-frontend
```

Si el servicio no existe aún, correr solo el rol frontend:

```bash
ansible-playbook playbooks/site.yml --limit main_node --tags frontend --ask-vault-pass
```

---

### Frontend — La app abre pero login / API no responde (error CORS o red)

**Síntoma:** En DevTools del navegador aparece `CORS error` o `net::ERR_CONNECTION_REFUSED`
apuntando a `localhost:8000` o `localhost:8080`.

**Causa:** El `enviroment.ts` en la VM todavía tiene URLs de `localhost` (no se ejecutó el rol frontend).

```bash
# Verificar el environment en David (conectarse vía SSH):
ssh estudiante@10.43.98.3
cat ~/Extra-editable/frontend/src/app/environments/enviroment.ts
# Debe mostrar 10.43.98.3:8080, NO localhost
```

Si muestra `localhost`, el Ansible no actualizó el archivo. Re-ejecutar solo el rol frontend:

```bash
ansible-playbook playbooks/site.yml --limit main_node --tags frontend --ask-vault-pass
```

Después verificar que el servicio se reinició con las nuevas URLs:

```bash
sudo systemctl restart extra-frontend
sudo journalctl -u extra-frontend -f   # esperar que Angular recompile (~30s)
```

---

### Frontend — El panel OUTPUT no muestra nada al hacer RUN

**Síntoma:** Se hace clic en RUN, el botón se pone en "cargando" pero nunca aparece output.

**Causa más común:** El WebSocket de ejecución (`ws://10.43.98.3:8080/ejecutar/ws/execute`) no está llegando al Code Execution Service (Chitiva).

1. Verificar que Chitiva responde:
   ```bash
   curl http://10.43.99.41:8081/health
   # Debe devolver: {"status":"ok"}
   ```

2. Verificar que el gateway proxea correctamente:
   ```bash
   # En David, revisar que el container api-gateway esté corriendo:
   docker ps | grep api-gateway
   docker logs api-gateway --tail 50
   ```

3. Verificar que el Code Execution Service está activo en Chitiva:
   ```bash
   ssh estudiante@10.43.99.41
   sudo systemctl status extra-code-exec
   sudo journalctl -u extra-code-exec -n 30
   ```

4. Si el servicio cayó, reiniciarlo:
   ```bash
   sudo systemctl restart extra-code-exec
   ```

---

### Code Execution — Las imágenes Docker no existen (Chitiva)

**Síntoma:** `extra-code-exec` falla al intentar crear un contenedor. Log dice algo como
`No such image: secure-cpp-runner:latest`.

```bash
# Verificar imágenes presentes (en Chitiva):
docker images | grep runner
# Debe mostrar: secure-cpp-runner, secure-python-runner, secure-typescript-runner

# Si faltan, construirlas manualmente:
cd ~/Extra-editable/code-execution-service/docker-images/cpp
docker build -t secure-cpp-runner:latest .

cd ~/Extra-editable/code-execution-service/docker-images/python
docker build -t secure-python-runner:latest .

cd ~/Extra-editable/code-execution-service/docker-images/typescript
docker build -t secure-typescript-runner:latest .

# Reiniciar el servicio:
sudo systemctl restart extra-code-exec
```

O re-ejecutar el rol desde Samuel:

```bash
ansible-playbook playbooks/site.yml --limit chitiva --ask-vault-pass
```

---

### PostgreSQL — Error al recrear la base de datos (David)

**Síntoma:** El playbook falla con `ERROR: database "extraeditable" is being accessed by other users`.

**El rol Ansible ya incluye un paso que termina las conexiones activas**, pero si falla manualmente:

```bash
# Conectarse a David y terminar conexiones:
ssh estudiante@10.43.98.3
sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'extraeditable' AND pid <> pg_backend_pid();"

# Luego re-ejecutar el rol postgres:
ansible-playbook playbooks/site.yml --limit main_node --tags postgres --ask-vault-pass
```

---

### PostgreSQL — Error de privilegios al eliminar usuario (David)

**Síntoma:** `ERROR: role "extrauser" cannot be dropped because some objects depend on it`.

```bash
# Conectarse a David:
ssh estudiante@10.43.98.3
sudo -u postgres psql -c "DROP OWNED BY extrauser;"
sudo -u postgres psql -c "DROP USER IF EXISTS extrauser;"
```

El rol Ansible ya incluye `DROP OWNED BY` antes de `DROP USER`, pero si falla:

```bash
ansible-playbook playbooks/site.yml --limit main_node --tags postgres --ask-vault-pass
```

---

### Backend Django — No arranca o error 500

**Síntoma:** `curl http://10.43.98.3:8000/api/` devuelve error o no responde.

```bash
# Ver logs en David:
sudo journalctl -u extra-backend -n 50

# Verificar que el .env existe y tiene las variables correctas:
cat ~/Extra-editable/backend/.env
# Debe tener: SECRET_KEY, DB_HOST=10.43.98.3, CORS_ALLOWED_ORIGINS=http://10.43.98.3:4200

# Verificar que PostgreSQL está corriendo:
sudo systemctl status postgresql

# Reiniciar backend:
sudo systemctl restart extra-backend
```

> **Importante:** No correr `python manage.py migrate` manualmente. El esquema se aplica
> desde `backend/db/esquema.sql` vía Ansible para evitar conflictos con PostgreSQL.

---

### Collab — Editor no sincroniza entre usuarios

**Síntoma:** Dos usuarios abren el mismo archivo pero los cambios no se propagan.

1. Verificar que el Collab LB (David) responde:
   ```bash
   curl http://10.43.98.3:8083/health
   ```

2. Verificar las 3 instancias en Melissa:
   ```bash
   ssh estudiante@10.43.100.126
   sudo systemctl status extra-collab@1234
   sudo systemctl status extra-collab@1235
   sudo systemctl status extra-collab@1236
   ```

3. Si alguna instancia está caída:
   ```bash
   sudo systemctl restart extra-collab@1234
   # Repetir para 1235 y 1236 si es necesario
   ```

4. Verificar que PostgreSQL en David acepta conexiones desde Melissa
   (el collab persiste documentos en la BD de David):
   ```bash
   # En Melissa:
   psql -h 10.43.98.3 -U extrauser -d extraeditable -c "SELECT 1;"
   ```

---

### LSP — Autocompletado no funciona en el editor

**Síntoma:** No aparecen sugerencias de código o hay error de conexión LSP en la consola del navegador.

1. Verificar el LSP Load Balancer (Campos):
   ```bash
   curl http://10.43.99.20:8085/health
   ```

2. Verificar los nodos LSP (Gabriel y Simon):
   ```bash
   curl http://10.43.100.88:8135/docs
   curl http://10.43.99.67:8135/docs
   ```

3. Si un nodo LSP no responde, reiniciar Docker Compose:
   ```bash
   ssh estudiante@10.43.100.88   # o 10.43.99.67 para Simon
   cd ~/Extra-editable/LSP-Service
   docker compose restart
   ```

4. Verificar Redis (requerido por el LSP service):
   ```bash
   docker exec redis-lsp redis-cli ping
   # Debe responder: PONG
   
   # Si no responde, reiniciar Redis:
   docker restart redis-lsp
   # O crearlo si no existe:
   docker run -d --name redis-lsp --restart unless-stopped \
     -p 6379:6379 redis:7-alpine \
     redis-server --save "" --appendonly no
   ```

5. Si los contenedores LSP (cpp, python, ts) no existen:
   ```bash
   cd ~/Extra-editable/LSP-Service
   bash discover-dev.sh
   ```

---

### API Gateway — No proxea las peticiones (David)

**Síntoma:** `curl http://10.43.98.3:8080/api/` falla aunque Django sí responde en `:8000`.

```bash
# Verificar que el container está corriendo:
docker ps | grep api-gateway

# Si no está corriendo:
docker start api-gateway

# Si el container no existe, recrearlo:
ansible-playbook playbooks/site.yml --limit main_node --tags gateway --ask-vault-pass

# Ver logs de nginx dentro del container:
docker logs api-gateway --tail 50
```

**Problema con `host.docker.internal`:** En Linux, Docker no resuelve `host.docker.internal`
automáticamente. El container gateway debe tener `--add-host=host.docker.internal:host-gateway`
en su configuración (el Ansible ya lo incluye). Si no funciona, verificar:

```bash
docker inspect api-gateway | grep HostGateway
# Debe aparecer "host-gateway" como IP extra
```

---

### SSH / Ansible — No puede conectar a una VM

**Síntoma:** `ansible all -m ping` devuelve `UNREACHABLE` para alguna VM.

```bash
# Verificar conectividad básica:
ping 10.43.98.3

# Verificar SSH manual:
ssh -o StrictHostKeyChecking=no estudiante@10.43.98.3

# Si pide contraseña (no debería con sshpass configurado):
# Verificar que sshpass está instalado en Samuel:
which sshpass

# Verificar la contraseña en el vault:
ansible-vault view inventory/group_vars/all/vault.yml --ask-vault-pass
```

---

### Ansible Vault — Contraseña incorrecta

**Síntoma:** `ERROR! Decryption failed (no vault secrets were found that could decrypt)`

```bash
# Re-cifrar con la contraseña correcta:
ansible-vault decrypt inventory/group_vars/all/vault.yml --ask-vault-pass
ansible-vault encrypt inventory/group_vars/all/vault.yml
```

---

### Verificación completa del estado de los 21 servicios

```bash
# Desde Samuel, correr contra todas las VMs en paralelo:

# David (5 servicios):
ssh estudiante@10.43.98.3 "systemctl is-active extra-backend extra-frontend && docker inspect -f '{{.State.Status}}' api-gateway collab-lb && systemctl is-active postgresql"

# Melissa (3 instancias collab):
ssh estudiante@10.43.100.126 "systemctl is-active extra-collab@1234 extra-collab@1235 extra-collab@1236"

# Chitiva (1 servicio + 3 imágenes Docker):
ssh estudiante@10.43.99.41 "systemctl is-active extra-code-exec && docker images --format '{{.Repository}}' | grep runner"

# Gabriel (lsp-agent + redis-lsp + lsp-language-service-1):
ssh estudiante@10.43.100.88 "cd ~/Extra-editable/LSP-Service && docker compose ps"

# Simon (lsp-lb + lsp-1-cpp + redis-lsp):
ssh estudiante@10.43.99.67 "cd ~/Extra-editable/LSP-Service && docker compose ps"

# Campos (lsp-nginx + lsp-watcher):
ssh estudiante@10.43.99.20 "systemctl is-active lsp-watcher && docker ps --filter name=lsp-nginx --format '{{.Status}}'"
```
