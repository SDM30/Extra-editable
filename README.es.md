<!-- 🌐 [English](README.md) | [Español](README.es.md) -->

# Extra Editable

Aplicación web para edición y evaluación de código fuente, construida en torno a un editor de código online con soporte multi-lenguaje y evaluación automática de casos de prueba.

## Tecnologías

| Capa             | Tecnología                                                                                  |
|------------------|---------------------------------------------------------------------------------------------|
| Frontend         | Angular 21 (componentes standalone, signals), TypeScript 5.9                               |
| Editor           | CodeMirror vía `@acrodata/code-editor` (temas: Dracula, Nord, Solarized, Kimbie, One Dark) |
| Tooling frontend | Angular CLI 21, Vitest 4, npm 11, Node.js 22                                                |
| Backend          | Spring Boot 4.0.2, Java 25, Maven                                                           |
| Persistencia     | Spring Data JPA, Jakarta Persistence 3.1, ModelMapper 3.2, Lombok                           |
| Base de datos    | PostgreSQL                                                                                  |
| Testing          | Vitest (frontend), spring-boot-starter-webmvc-test (backend)                                |

## Arquitectura

El sistema sigue un modelo cliente-servidor: una SPA en Angular se comunica vía REST con un backend Spring Boot por capas.

```mermaid
flowchart LR
  subgraph Client["Frontend (Navegador)"]
    A["SPA Angular<br/>Editor CodeMirror"]
  end
  subgraph Server["Backend (Spring Boot)"]
    B["Controladores REST"]
    C["Servicios"]
    D["Repositorios (JPA)"]
  end
  E[("PostgreSQL")]

  A --"HTTP / REST (JSON)"--> B
  B --> C --> D --> E
```

### Capas del backend

```mermaid
flowchart TD
  L1["Capa Controladores<br/>(Ejercicio, CasoPrueba, CodigoFuente, Evaluacion)"]
  L2["Capa Servicios<br/>(Lógica de negocio + conversión DTO con ModelMapper)"]
  L3["Capa Repositorios<br/>(Interfaces Spring Data JPA)"]
  L4["Capa Modelo / Entidades<br/>(Entidades JPA)"]
  L1 --> L2 --> L3 --> L4
```

### Modelo de dominio

```mermaid
erDiagram
  Ejercicio ||--o{ CasoPrueba : "tiene"
  Ejercicio ||--o{ CodigoFuente : "tiene"
  CodigoFuente ||--o{ Evaluacion : "produce"
  Evaluacion ||--o{ CasoPrueba : "evalua"

  Ejercicio {
    Long id PK
  }
  CasoPrueba {
    Long id PK
  }
  CodigoFuente {
    Long id PK
  }
  Evaluacion {
    Long id PK
    Long puntuacion
    String descripcion
  }
```
