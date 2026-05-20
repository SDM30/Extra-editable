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
    id                BIGSERIAL PRIMARY KEY,
    nombre            VARCHAR(255)       NOT NULL,
    descripcion       TEXT               NOT NULL DEFAULT '',
    fecha_creacion    TIMESTAMPTZ        NOT NULL DEFAULT now(),
    lenguaje          lenguaje_proyecto  NOT NULL,
    usuario_id        BIGINT             NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,

    -- Límites de seguridad (defence in depth junto con validación en serializer/view)
    max_archivos      INT                NOT NULL DEFAULT 10,
    max_bytes_total   INT                NOT NULL DEFAULT 524288  -- 512 KB
);

CREATE INDEX idx_proyectos_usuario ON proyectos(usuario_id);

-- ============================================================
-- ARCHIVOS
-- ============================================================
CREATE TABLE archivos (
    id                   BIGSERIAL PRIMARY KEY,
    nombre               VARCHAR(255) NOT NULL,
    contenido            TEXT         NOT NULL DEFAULT '',
    ydoc                 BYTEA,
    fecha_creacion       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    fecha_actualizacion  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    proyecto_id          BIGINT       NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,

    UNIQUE(proyecto_id, nombre),

    -- Límite por archivo: 64 KB
    CONSTRAINT chk_contenido_max_size CHECK (octet_length(contenido) <= 65536)
);

CREATE INDEX idx_archivos_proyecto ON archivos(proyecto_id);

-- ============================================================
-- COLLAB SESSIONS
-- ============================================================
CREATE TABLE collab_sessions (
    id          BIGSERIAL    PRIMARY KEY,
    proyecto_id BIGINT       NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
    usuario_id  BIGINT                REFERENCES usuarios(id)  ON DELETE SET NULL,
    token       VARCHAR(512) NOT NULL DEFAULT '',
    last_seen   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_collab_sessions_proyecto  ON collab_sessions(proyecto_id);
CREATE INDEX idx_collab_sessions_last_seen ON collab_sessions(last_seen);

-- ============================================================
-- Trigger: actualizar fecha_actualizacion automáticamente
-- ============================================================
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

-- ============================================================
-- Trigger: validar límite de archivos por proyecto
-- ============================================================
CREATE OR REPLACE FUNCTION check_max_archivos()
RETURNS TRIGGER AS $$
DECLARE
    v_count INT;
    v_max   INT;
BEGIN
    SELECT max_archivos INTO v_max FROM proyectos WHERE id = NEW.proyecto_id;

    SELECT COUNT(*) INTO v_count FROM archivos WHERE proyecto_id = NEW.proyecto_id;

    IF v_count >= v_max THEN
        RAISE EXCEPTION 'Límite de archivos alcanzado para el proyecto % (máx: %)',
            NEW.proyecto_id, v_max;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_max_archivos
    BEFORE INSERT ON archivos
    FOR EACH ROW EXECUTE FUNCTION check_max_archivos();

-- ============================================================
-- Trigger: validar peso total del proyecto
-- ============================================================
CREATE OR REPLACE FUNCTION check_max_bytes_total()
RETURNS TRIGGER AS $$
DECLARE
    v_total BIGINT;
    v_max   INT;
    v_nuevo INT;
BEGIN
    v_nuevo := octet_length(NEW.contenido);

    SELECT max_bytes_total INTO v_max FROM proyectos WHERE id = NEW.proyecto_id;

    SELECT COALESCE(SUM(octet_length(contenido)), 0) INTO v_total
      FROM archivos
     WHERE proyecto_id = NEW.proyecto_id
       AND id IS DISTINCT FROM NEW.id;

    IF (v_total + v_nuevo) > v_max THEN
        RAISE EXCEPTION 'Límite de almacenamiento alcanzado para el proyecto % (máx: % bytes)',
            NEW.proyecto_id, v_max;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_max_bytes_total
    BEFORE INSERT OR UPDATE OF contenido ON archivos
    FOR EACH ROW EXECUTE FUNCTION check_max_bytes_total();