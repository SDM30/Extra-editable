import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     parseInt(process.env.DB_PORT ?? '5432'),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

/**
 * Carga el estado Yjs binario de un archivo desde PostgreSQL.
 * documentName tiene formato "projectId:archivoId" (ej: "42:archivo:7")
 * o el formato legacy "projectId:fileName".
 *
 * @param {string} documentName
 * @returns {Buffer|null}
 */
export async function loadDocument(documentName) {
  const { projectId, archivoId, fileName } = parseDocumentName(documentName);
  if (!projectId) return null;

  let result;

  if (archivoId) {
    result = await pool.query(
      `SELECT ydoc FROM archivos WHERE id = $1 AND proyecto_id = $2 LIMIT 1`,
      [archivoId, projectId],
    );
  } else if (fileName) {
    result = await pool.query(
      `SELECT ydoc FROM archivos WHERE proyecto_id = $1 AND nombre = $2 LIMIT 1`,
      [projectId, fileName],
    );
  } else {
    return null;
  }

  if (result.rows[0]?.ydoc) {
    console.log(`[db] Cargado desde PostgreSQL (binario Yjs): ${documentName}`);
    return result.rows[0].ydoc;
  }

  return null;
}

/**
 * Persiste el estado Yjs binario y el contenido de texto en PostgreSQL.
 *
 * @param {string}     documentName
 * @param {Uint8Array} stateUpdate   — Y.encodeStateAsUpdate(document)
 * @param {string}     content       — texto plano del Y.Text('codemirror')
 */
export async function storeDocument(documentName, stateUpdate, content) {
  const { projectId, archivoId, fileName } = parseDocumentName(documentName);
  if (!projectId) return;

  const buf = Buffer.from(stateUpdate);

  if (archivoId) {
    await pool.query(
      `UPDATE archivos
          SET ydoc = $1, contenido = $2, fecha_actualizacion = now()
        WHERE id = $3 AND proyecto_id = $4`,
      [buf, content, archivoId, projectId],
    );
  } else if (fileName) {
    await pool.query(
      `UPDATE archivos
          SET ydoc = $1, contenido = $2, fecha_actualizacion = now()
        WHERE proyecto_id = $3 AND nombre = $4`,
      [buf, content, projectId, fileName],
    );
  } else {
    return;
  }

  console.log(`[db] Guardado en PostgreSQL: ${documentName} (${buf.length} bytes Yjs)`);
}

/**
 * Verifica que un usuario tenga acceso a un proyecto consultando Django.
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {string} jwtToken
 * @returns {Promise<boolean>}
 */
export async function checkProjectAccess(userId, projectId, jwtToken) {
  const djangoUrl = process.env.DJANGO_API_URL ?? 'http://localhost:8000/api';
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

/**
 * Parsea el documentName a sus componentes.
 * Formatos soportados:
 *   "project:42:archivo:7"   → { projectId: '42', archivoId: '7' }
 *   "42:7"                   → { projectId: '42', archivoId: '7' }  (formato frontend actual)
 *   "project:42"             → sala de proyecto sin archivo (metadata)
 */
function parseDocumentName(documentName) {
  // Formato frontend actual: "projectId:archivoId"  ej "4:6"
  const simple = documentName.match(/^(\d+):(\d+)$/);
  if (simple) {
    return { projectId: simple[1], archivoId: simple[2], fileName: null };
  }

  // Formato con prefijo: "project:42:archivo:7"
  const full = documentName.match(/^project:(\d+):archivo:(\d+)$/);
  if (full) {
    return { projectId: full[1], archivoId: full[2], fileName: null };
  }

  // Sala de proyecto sin archivo: "project:42"
  const projectOnly = documentName.match(/^project:(\d+)$/);
  if (projectOnly) {
    return { projectId: projectOnly[1], archivoId: null, fileName: null };
  }

  // Formato legacy con nombre de archivo: "42:main.cpp"
  const legacy = documentName.match(/^(\d+):(.+)$/);
  if (legacy) {
    return { projectId: legacy[1], archivoId: null, fileName: legacy[2] };
  }

  return { projectId: null, archivoId: null, fileName: null };
}