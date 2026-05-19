# Plan de Pruebas - Sistema Colaborativo

## Archivos Base Utilizados

- `PRUEBAS_API.md`
- `README.md`
- `nginx.conf`
- `nginx.config`
- `update_nginx.py`
- `views.py`
- `urls.py`
- `server.js`
- `test_collab_lb.sh`
- `prueba_real_lsp.py`

---

## Fase 0: Preparación y Línea Base (1 día)

### Metas por Entorno
| Métrica | Objetivo |
|---------|----------|
| Disponibilidad objetivo | 99.5% en pruebas |
| API p95 objetivo inicial | < 500 ms |
| Error rate objetivo | < 1% |

### Actividades
- Congelar versión de configuración y puertos
- Activar métricas mínimas:
  - Nginx access/error logs
  - Django logs
  - PostgreSQL métricas de conexiones y escritura
  - Métricas de contenedores Docker (CPU/Mem)

### Dataset de Prueba
| Tipo | Cantidad/Detalle |
|------|------------------|
| Usuarios | 100, 500, 2000 |
| Proyectos y archivos | Por usuario |
| Tokens | Válidos / expirados / falsos |

---

## Fase 1: Pruebas Funcionales Críticas (Smoke + Regresión)

### API Auth y Recursos Protegidos
- [ ] Login, refresh, acceso sin token, token inválido
- [ ] Endpoints de proyectos/archivos

### Colaboración
- [ ] Emisión de token de colaboración
- [ ] Join a sala, edición concurrente, reconexión
- [ ] Persistencia del documento entre sesiones

### LSP (Language Server Protocol)
- [ ] Crear contenedor por proyecto/lenguaje
- [ ] Consultar estado, listar y destruir
- [ ] Aislamiento entre proyectos

**Referencia funcional directa:**
- Validación token colaborativo y headers de identidad en `views.py`
- Rutas de validación y proyectos en `urls.py`
- Login/refresh en `urls.py`

---

## Fase 2: Seguridad, Acceso, Tokens y Sesiones

### Token y Sesión
| Prueba | Estado |
|--------|--------|
| Token expirado | [ ] |
| Firma inválida | [ ] |
| Token faltante | [ ] |
| Reuso de token entre usuarios | [ ] |
| Token válido pero room no autorizada | [ ] |

### Gateway y Balanceadores
- [ ] Verificar que no exista bypass directo al backend sin validación
- [ ] Confirmar que `auth_request` de collab bloquea conexión sin cookie token
- [ ] Validar headers propagados `X-Auth-*`

### Pruebas Negativas
- [ ] CORS estricto por origen
- [ ] Métodos HTTP no permitidos
- [ ] Rutas inexistentes y verb tampering

### Checklist OWASP Básico
- [ ] Broken auth
- [ ] Security misconfiguration
- [ ] Rate limiting básico en login y join

**Base técnica:**
- `auth_request` y sticky session en `nginx.config`
- CORS/proxy global en `nginx.conf`
- Lógica de autenticación ws y fallback de headers en `server.js`

---

## Fase 3: Pruebas de Escritura a Base de Datos

### Escenarios de Escritura Intensiva
- Crear proyectos/archivos en ráfaga
- Edición colaborativa concurrente con persistencia
- Join/leave masivo de sesiones

### Validaciones de Integridad
- [ ] No pérdida de contenido
- [ ] Última versión consistente tras reconexiones
- [ ] Sin sesiones huérfanas excesivas

### Métricas Objetivo
| Métrica | Descripción |
|---------|-------------|
| TPS de escritura | Transacciones por segundo |
| Tiempo medio y p95 | Operaciones write |
| Bloqueos/esperas | Base de datos |
| Pool de conexiones | Estado y saturación |

---

## Fase 4: Carga Alta (REST + WebSocket + LSP)

### Perfil de Carga Sugerido
| Escalón | Usuarios Concurrentes |
|---------|----------------------|
| 1 | 200 |
| 2 | 500 |
| 3 | 1000+ (si infraestructura lo soporta) |

### Mix Realista de Tráfico
| Tipo de Operación | Porcentaje |
|-------------------|------------|
| Operaciones colaborativas ws | 60% |
| API proyectos/archivos | 25% |
| API LSP (create/status/delete) | 15% |

### Duración de Pruebas
| Tipo | Duración |
|------|----------|
| Spike | 5-10 min |
| Sustained | 30-60 min |
| Soak | 4-8 horas |

### Herramientas Recomendadas
| Herramienta | Propósito |
|-------------|-----------|
| k6 | Pruebas REST |
| Artillery o ws scripts | WebSocket |
| `prueba_real_lsp.py` | LSP stress (script existente) |

---

## Fase 5: Balanceadores y Resiliencia

### Collab LB
- [ ] Verificar sticky sessions bajo carga
- [ ] Simular caída de una instancia collab y medir reconexión
- [ ] Confirmar impacto en documentos en memoria

### LSP LB
- [ ] Verificar descubrimiento dinámico de instancias
- [ ] Simular alta/baja de instancias y validar reload Nginx
- [ ] Confirmar distribución y salud de upstreams

### Gateway Principal
- [ ] Degradación controlada sin cascada de 502
- [ ] Timeouts correctos y sin cortes prematuros ws

**Base:**
- Test de collab LB en `test_collab_lb.sh`
- Watcher de LSP LB en `update_nginx.py`

---

## Criterios de Aceptación (Go/No-Go)

| # | Criterio | Umbral |
|---|----------|--------|
| 1 | Error rate total | < 1% en carga sostenida |
| 2 | API crítica p95 | < 500 ms |
| 3 | API crítica p99 | < 1000 ms |
| 4 | Conexiones ws | Estables durante 60 min sin pérdidas masivas |
| 5 | Integridad de documentos | Sin corrupción en edición colaborativa |
| 6 | Failover | Una instancia caída sin caída total del servicio |
| 7 | Validación token/sesión | Sin bypass |

---

## ⚠️ Riesgo Importante Detectado

> **Hay marcadores de conflicto de merge en `views.py`.**  
> Esto puede romper pruebas o comportamiento de auth/search.  
> **Conviene resolverlo antes del ciclo fuerte de QA.**

---

## Próximos Pasos (Formato Ejecutable)

Si se requiere, se puede elaborar:

1. **Matriz de casos** (ID, precondición, pasos, esperado) para QA manual/automático
2. **Scripts de carga iniciales** k6 y ws listos para correr en tu estructura
3. **Cronograma de 2 semanas** con orden óptimo de ejecución y reporte

---

*Documento adaptado del repositorio original - Plan de Pruebas v1.0*