# Despliegue con Ansible — Extra-editable

## Prerequisitos

En la VM de **Samuel** (Control Node — `10.43.99.252`):

```bash
# Instalar Ansible
sudo apt update
sudo apt install -y ansible sshpass

# Verificar
ansible --version
```

## Configuración inicial

### 1. Cifrar credenciales con ansible-vault

```bash
cd ansible/
ansible-vault encrypt inventory/vault.yml
# Ingresa una contraseña maestra que recuerdes
```

### 2. Verificar conectividad SSH

```bash
ansible all -m ping --ask-vault-pass
```

Deberías ver `pong` de todas las VMs.

## Comandos de despliegue

### Despliegue completo

```bash
ansible-playbook playbooks/site.yml --ask-vault-pass
```

### Dry-run (verificar sin ejecutar)

```bash
ansible-playbook playbooks/site.yml --check --ask-vault-pass
```

### Desplegar un servicio específico

```bash
# Solo backend
ansible-playbook playbooks/site.yml --tags backend --ask-vault-pass

# Solo LSP
ansible-playbook playbooks/site.yml --limit lsp_servers --ask-vault-pass
```

## Health checks post-deploy

```bash
# Backend
curl http://10.43.98.3:8000/api/

# API Gateway
curl http://10.43.98.3:8080/api/

# Collab LB
curl http://10.43.98.3:8083/health

# Collab Service (directo)
curl http://10.43.100.126:1234

# Code Execution
curl http://10.43.99.41:8081

# LSP Service (Gabriel)
curl http://10.43.100.88:8135/docs

# LSP Service (Simon)
curl http://10.43.99.67:8135/docs

# LSP Load Balancer
curl http://10.43.99.20:8085/health

# Frontend
curl http://10.43.98.3:4200
```

## Distribución de VMs

| VM | IP | Servicios |
|----|-----|-----------|
| Samuel | 10.43.99.252 | Control Node (solo Ansible) |
| David | 10.43.98.3 | Backend + Frontend + Gateway + Collab LB |
| Melissa | 10.43.100.126 | Collab Service ×3 |
| Chitiva | 10.43.99.41 | Code Execution Service |
| Gabriel | 10.43.100.88 | LSP Service (primario) |
| Simon | 10.43.99.67 | LSP Service (réplica) |
| Campos | 10.43.99.20 | LSP Load Balancer |

## Troubleshooting

### Ver logs de un servicio

```bash
# En la VM correspondiente:
sudo journalctl -u extra-backend -f         # Backend
sudo journalctl -u extra-frontend -f        # Frontend
sudo journalctl -u extra-collab@1234 -f     # Collab instancia 1
sudo journalctl -u extra-code-exec -f       # Code Execution
sudo journalctl -u lsp-watcher -f           # LSP Watcher
docker logs api-gateway -f                  # API Gateway
docker logs collab-lb -f                    # Collab LB
```

### Reiniciar un servicio

```bash
sudo systemctl restart extra-backend
sudo systemctl restart extra-collab@1234
sudo systemctl restart extra-collab@1235
sudo systemctl restart extra-collab@1236
```

### Redesplegar solo un servicio desde Samuel

```bash
ansible-playbook playbooks/site.yml --limit melissa --ask-vault-pass
```
