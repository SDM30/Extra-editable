# FRONTEND

Angular CLI       : 21.1.3

Node.js           : 22.19.0

Package Manager   : npm 11.9.0

## Editor de código
Envoltorio: https://github.com/acrodata/code-editor

# BACKEND

Versión de java: 25 (openjdk)

# PRUEBAS DE DESPLIEGUE (Prueba de Concepto - PoC)

## Tecnologías Usadas
- **Docker & Docker Compose**: Contenerización y orquestación local de servicios.
- **Nginx**: Servidor web usado como balanceador de carga y proxy inverso.
- **Node.js**: Entorno de ejecución para los servicios de prueba.
- **k6 (Grafana)**: Herramienta de pruebas de carga y rendimiento.
- **GitHub Actions**: Automatización de integración continua (CI/CD).

## Descripción de los Casos de Prueba

### Caso 1: Integración Continua (CI/CD)
**Carpeta:** `poc_despliegue/casos/caso1_ci-cd`
Verifica la automatización del proceso de integración continua. Emplea un flujo de trabajo (workflow de GitHub Actions) configurado para construir, verificar y validar el entorno cuando hay cambios en el código.

### Caso 2: Despliegue a Escala (Scaled Rollout)
**Carpeta:** `poc_despliegue/casos/caso2_scaled-rollout`
Simula el arranque de múltiples contenedores y el balanceo de carga. Utiliza Nginx para distribuir peticiones entre varias réplicas del servicio garantizando su escalabilidad. 

### Caso 3: Monitoreo de Salud y Resiliencia (Healthcheck)
**Carpeta:** `poc_despliegue/casos/caso3_healthcheck`
Prueba la tolerancia a fallos y el enrutamiento dinámico del sistema. Combina *Docker Healthchecks* con Nginx y pruebas de carga generadas por **k6**. Se enfoca en validar el comportamiento del proxy balanceador al apagar de forma abrupta una instancia.