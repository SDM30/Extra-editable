# Despliegue con Ansible — Extra-editable

> Ejecutar todos los comandos desde la VM de **Samuel** (`10.43.99.252`), que actúa como Control Node.

## Distribución de VMs

| VM        | IP            | Servicios                                 |
|-----------|---------------|-------------------------------------------|
| Samuel    | 10.43.99.252  | Control Node (solo Ansible)               |
| David     | 10.43.98.3    | Backend + Frontend + Gateway + Collab LB  |
| Melissa   | 10.43.100.126 | Collab Service (3 instancias)             |
| Chitiva   | 10.43.99.41   | Code Execution Service                    |
| Gabriel   | 10.43.100.88  | LSP Service (primario)                    |
| Simon     | 10.43.99.67   | LSP Service (réplica)                     |
| Campos    | 10.43.99.20   | LSP Load Balancer                         |

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

| # | Tarea | VMs destino |
|---|-------|-------------|
| 1 | Paquetes base + clonar repo | **Todas** |
| 2 | Instalar Docker CE | david, chitiva, gabriel, simon |
| 3 | Instalar Node.js 22 | david, melissa, chitiva |
| 4 | Instalar Python 3 | david, campos |
| 5 | Backend Django | david |
| 6 | Collab Service ×3 (Hocuspocus) | melissa |
| 7 | Collab Load Balancer (nginx) | david |
| 8 | Code Execution Service | chitiva |
| 9 | LSP Service | gabriel, simon |
| 10 | LSP Load Balancer | campos |
| 11 | API Gateway (Docker) | david |
| 12 | Frontend Angular | david |

---

## Paso 7 — Health checks post-despliegue

```bash
curl http://10.43.98.3:8000/api/        # Backend Django
curl http://10.43.98.3:8080/api/        # API Gateway
curl http://10.43.98.3:8083/health      # Collab Load Balancer
curl http://10.43.100.126:1234         # Collab Service (directo)
curl http://10.43.99.41:8081           # Code Execution
curl http://10.43.100.88:8135/docs     # LSP Service — Gabriel
curl http://10.43.99.67:8135/docs      # LSP Service — Simon
curl http://10.43.99.20:8085/health    # LSP Load Balancer
curl http://10.43.98.3:4200             # Frontend
```

---

## Comandos útiles

### Redesplegar un solo host o grupo

```bash
# Solo collab (melissa):
ansible-playbook playbooks/site.yml --limit melissa --ask-vault-pass

# Solo los nodos LSP:
ansible-playbook playbooks/site.yml --limit lsp_servers --ask-vault-pass

# Solo el backend:
ansible-playbook playbooks/site.yml --limit main_node --tags backend --ask-vault-pass
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
