# AGENTS.md

## Editor de código (para estudiantes)

La plataforma incluye un editor de código en línea que permite a los estudiantes escribir, ejecutar y evaluar código en los lenguajes **Python, Typescript y C++**. El editor se integra con un servidor de lenguaje (LSP) para proporcionar autocompletado, resaltado de sintaxis y detección de errores en tiempo real, y con un servicio de edición simultánea que permite que hasta 4 estudiantes colaboren en un mismo proyecto.

### Restricciones del editor

- **Lenguaje único por proyecto**: Cada proyecto está asociado a un solo lenguaje de programación. No se permite mezclar lenguajes dentro de un mismo proyecto (por ejemplo, archivos Python y Java juntos). Al crear un nuevo proyecto, se debe seleccionar el lenguaje de programación que se usará en todos los archivos del proyecto.

## Desarrollo del sistema

El código fuente del sistema (backend, servicios, frontend) está escrito en **Python**, **JavaScript** y **TypeScript**.

### Documentación del código fuente

Al escribir código fuente en estos lenguajes, se debe documentar de manera sucinta, describiendo únicamente los comportamientos clave (funciones, clases, algoritmos principales). Se debe utilizar el formato de documentación estándar para cada lenguaje:

- **Python**: docstrings (`"""descripción"""`)
- **JavaScript**: comentarios JSDoc (`/** descripción */`) o comentarios de línea/bloque según corresponda
- **TypeScript**: comentarios JSDoc/TSDoc (`/** descripción */`)

No se requiere documentación exhaustiva línea por línea; basta con explicar el propósito y la lógica esencial de cada componente.

### Archivos de configuración

Todos los archivos de configuración (por ejemplo, de herramientas, despliegue, entornos, o cualquier archivo con extensión `.json`, `.yaml`, `.toml`, `.ini`, `.env`, etc.) deben incluir comentarios que expliquen cada sección o parámetro relevante, facilitando su mantenimiento y comprensión. Cuando el formato no soporte comentarios de forma nativa (como JSON puro), se debe adjuntar un archivo de documentación complementario o utilizar un esquema con descripciones.

### Documentación de componente
Buscar en la raiz del proyecto el directorio Extra-editable.wiki, si no esta no utilizarlo (esperar especificacion del usuario).

Documentar información de diseño y funcionalidades de los componentes: frontend, backend, servicio de lenguaje (LSP-service), servicio de edición colaborativa (collab-service), servicio de ejecución de código (code-execution-service) y balanceadores de carga.

## Distribuición de maquinas
| Name | Username | Password | IP_Address | Servicios |
|------|----------|----------|------------|-----------|
| S. Osorio | estudiante | | 10.43.99.252 | Control Node (solo Ansible) |
| Simón | estudiante | F0c4-16M4p4c | 10.43.99.67 | LSP Service (réplica) |
| David | estudiante | arquiDavid911 | 10.43.98.3 | Backend + Frontend + Gateway + Collab LB |
| S. Campos | estudiante | C4m4l30n+26C | 10.43.99.20 | LSP Load Balancer |
| Gabriel | estudiante | Gorila/32Ard | 10.43.100.88 | LSP Service (primario) |
| Chitiva | estudiante | Ll4m4/47M0n0 | 10.43.99.41 | Code Execution Service |
| Melissa | estudiante | Pulp0/373l3f | 10.43.100.126 | Collab Service (3 instancias) |
