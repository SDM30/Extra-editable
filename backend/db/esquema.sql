-- ============================================================
-- Extra Editable — Schema PostgreSQL
-- ============================================================

CREATE TYPE rol_usuario AS ENUM ('USUARIO', 'ADMIN');
CREATE TYPE lenguaje_proyecto AS ENUM ('CPP', 'PYTHON', 'TYPESCRIPT');

-- ============================================================
-- USUARIOS
-- ============================================================
CREATE TABLE usuarios (
    id          BIGSERIAL PRIMARY KEY,
    username    VARCHAR(150) NOT NULL UNIQUE,
    nombre      VARCHAR(255) NOT NULL DEFAULT '',
    email       VARCHAR(254) NOT NULL UNIQUE,
    password    VARCHAR(128) NOT NULL,
    bio         VARCHAR(500) NOT NULL DEFAULT '',
    rol         rol_usuario  NOT NULL DEFAULT 'USUARIO',

    -- campos requeridos por Django Auth
    is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
    is_staff       BOOLEAN     NOT NULL DEFAULT FALSE,
    is_superuser   BOOLEAN     NOT NULL DEFAULT FALSE,
    date_joined    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login     TIMESTAMPTZ
);

-- ============================================================
-- PROYECTOS
-- ============================================================
CREATE TABLE proyectos (
    id              BIGSERIAL PRIMARY KEY,
    nombre          VARCHAR(255)       NOT NULL,
    descripcion     TEXT               NOT NULL DEFAULT '',
    fecha_creacion  TIMESTAMPTZ        NOT NULL DEFAULT now(),
    lenguaje        lenguaje_proyecto  NOT NULL,
    usuario_id      BIGINT             NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE INDEX idx_proyectos_usuario ON proyectos(usuario_id);

-- ============================================================
-- ARCHIVOS
-- ============================================================
CREATE TABLE archivos (
    id                   BIGSERIAL PRIMARY KEY,
    nombre               VARCHAR(255) NOT NULL,
    contenido            TEXT         NOT NULL DEFAULT '',
    ydoc                 BYTEA,                          -- estado binario Yjs (HocusPocus)
    fecha_creacion       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    fecha_actualizacion  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    proyecto_id          BIGINT       NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,

    UNIQUE(proyecto_id, nombre)
);

CREATE INDEX idx_archivos_proyecto ON archivos(proyecto_id);

-- Actualizar fecha_actualizacion automáticamente
CREATE OR REPLACE FUNCTION set_fecha_actualizacion()
RETURNS TRIGGER AS $$
BEGIN
    NEW.fecha_actualizacion = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_archivos_actualizacion
    BEFORE UPDATE ON archivos
    FOR EACH ROW EXECUTE FUNCTION set_fecha_actualizacion();