// import { createClient } from 'redis';
import pg from 'pg';

const { Pool } = pg;

// ── Redis ──────────────────────────────────────────────────────────────────
// COMENTADO: Redis deshabilitado por el momento. Descomentar cuando sea necesario.
// const redisClient = createClient({
//   url: process.env.REDIS_URL ?? 'redis://localhost:6379',
// });
//
// redisClient.on('error', err => console.error('[redis] Error:', err));
//
// await redisClient.connect();
// console.log('[redis] Conectado');

// ── PostgreSQL ─────────────────────────────────────────────────────────────
const pool = new Pool({
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     parseInt(process.env.DB_PORT ?? '5432'),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

/**
 * Carga el estado Yjs de un documento desde PostgreSQL.
 * @param {string} documentName  — formato "projectId:fileName"
 * @returns {Buffer|null}
 */
export async function loadDocument(documentName) {
  // PostgreSQL — busca el archivo por project_id + nombre
  const [projectId, fileName] = documentName.split(':');
  if (!projectId || !fileName) return null;

  const result = await pool.query(
    `SELECT ydoc FROM archivos
      WHERE proyecto_id = $1 AND nombre = $2
      LIMIT 1`,
    [projectId, fileName],
  );

  if (result.rows[0]?.ydoc) {
    const ydoc = result.rows[0].ydoc;
    console.log(`[db] Cargado desde PostgreSQL: ${documentName}`);
    return ydoc;
  }

  return null;
}

/**
 * Persiste el estado Yjs de un documento en PostgreSQL.
 * @param {string} documentName
 * @param {Uint8Array} stateUpdate  — Y.encodeStateAsUpdate(document)
 * @param {string}    content       — texto plano extraído del Y.Text
 */
export async function storeDocument(documentName, stateUpdate, content) {
  const [projectId, fileName] = documentName.split(':');
  if (!projectId || !fileName) return;

  const buf = Buffer.from(stateUpdate);

  // PostgreSQL — actualiza ydoc y contenido en archivos
  await pool.query(
    `UPDATE archivos
        SET ydoc = $1, contenido = $2, fecha_actualizacion = now()
      WHERE proyecto_id = $3 AND nombre = $4`,
    [buf, content, projectId, fileName],
  );

  console.log(`[db] Guardado en PostgreSQL: ${documentName} (${buf.length} bytes)`);

  // COMENTADO: Redis caché
  // redisClient.set(`doc:${documentName}`, buf.toString('base64'), { EX: 86400 })
  //   .catch(err => console.error('[redis] Error al guardar:', err));
}

/**
 * Verifica que un usuario tenga acceso a un proyecto.
 * Llama al endpoint de Django; retorna true/false.
 * @param {string} userId
 * @param {string} projectId
 * @param {string} jwtToken   — token original del cliente para re-autenticar vs Django
 */
export async function checkProjectAccess(userId, projectId, jwtToken) {
  const djangoUrl = process.env.DJANGO_API_URL ?? 'http://localhost:8080/api';
  try {
    const resp = await fetch(`${djangoUrl}/projects/${projectId}/collab-access/`, {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return resp.ok;
  } catch (err) {
    console.error('[db] Error verificando acceso a proyecto:', err);
    return false;
  }
}