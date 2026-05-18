import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import jwt from 'jsonwebtoken';
import { loadDocument, storeDocument, checkProjectAccess } from './db.js';

const JWT_SECRET      = process.env.JWT_SECRET ?? 'django-insecure-dev-key';
const PORT            = parseInt(process.env.PORT ?? '1234', 10);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:4200';
const SYNC_INTERVAL_MS   = parseInt(process.env.COLLAB_SYNC_INTERVAL_MS ?? '30000', 10);
const ENABLE_POLL_SYNC   = (process.env.COLLAB_ENABLE_POLL_SYNC ?? 'true').toLowerCase() === 'true';

const INITIAL_DOCUMENT = `#include <iostream>\n\nint main() {\n    std::cout << "Hola C++" << std::endl;\n    return 0;\n}`;

// Documentos activos en memoria para el poll-sync
const activeDocuments = new Map();

// ── Health check ───────────────────────────────────────────────────────────
async function isCollabServiceRunningOnPort() {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/health`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── CORS ───────────────────────────────────────────────────────────────────
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ── Servidor Hocuspocus ────────────────────────────────────────────────────
const server = Server.configure({
  port: PORT,

  async onRequest({ request, response }) {
    setCorsHeaders(response);

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      throw null;
    }

    if (request.url === '/health' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', port: PORT }));
      throw null;
    }
  },

  // ── Autenticación: JWT directo + headers inyectados por gateway ──────────
  // Conserva la lógica de dev: acepta identidad inyectada por Nginx/gateway
  // (X-Auth-User-Id, X-Auth-Username) además del JWT estándar.
  async onAuthenticate({ token, connection }) {
    try {
      const headers = (
        connection?.request?.headers ||
        connection?.context?.headers ||
        connection?.headers ||
        {}
      );
      const forwardedUserId  = headers['x-auth-user-id']  || headers['X-Auth-User-Id'];
      const forwardedUsername = headers['x-auth-username'] || headers['X-Auth-Username'];
      const forwardedRoom    = headers['x-auth-room']     || headers['X-Auth-Room'];

      // Identidad inyectada por el gateway (Nginx valida el token antes)
      if (!token && forwardedUserId) {
        connection.requiresAuthentication = true;
        connection.context = connection.context || {};
        Object.assign(connection.context, {
          userId:   String(forwardedUserId),
          username: String(forwardedUsername ?? 'anon'),
          room:     forwardedRoom,
          rawToken: null,
        });
        console.log(`[collab] Identidad via gateway: ${forwardedUsername ?? forwardedUserId}`);
        return {
          user:     { id: String(forwardedUserId), name: String(forwardedUsername ?? 'Anónimo') },
          userId:   String(forwardedUserId),
          username: String(forwardedUsername ?? 'Anónimo'),
        };
      }

      if (!token) throw new Error('Token requerido');

      const payload = jwt.verify(token, JWT_SECRET);
      connection.requiresAuthentication = true;
      const userId   = String(payload.user_id ?? payload.sub ?? 'anon');
      const username = String(payload.username ?? 'Anónimo');

      connection.context = connection.context || {};
      Object.assign(connection.context, { userId, username, rawToken: token });

      console.log(`[collab] ${username} autenticado via JWT`);
      return {
        user:     { id: userId, name: username },
        userId,
        username,
        rawToken: token,
      };
    } catch (err) {
      console.error('[collab] Auth fallida:', err?.message ?? err);
      throw new Error('Token inválido o expirado');
    }
  },

  // ── Conexión: valida acceso al proyecto ───────────────────────────────────
  async onConnect({ documentName, context }) {
    activeDocuments.set(documentName, null); // placeholder hasta onLoadDocument

    // Salas de proyecto (metadata) no requieren validación de archivo
    if (documentName.startsWith('project:') && !documentName.includes(':archivo:')) {
      console.log(`[collab] ${context?.username ?? 'Anónimo'} se unió a sala de proyecto "${documentName}"`);
      return;
    }

    const projectId = extractProjectId(documentName);
    if (projectId && context?.rawToken) {
      const allowed = await checkProjectAccess(context.userId, projectId, context.rawToken);
      if (!allowed) {
        console.warn(`[collab] Acceso denegado: user=${context.userId} project=${projectId}`);
        throw new Error('Acceso denegado al proyecto');
      }
    }

    console.log(`[collab] ${context?.username ?? 'Anónimo'} se unió a "${documentName}"`);
  },

  async onDisconnect({ documentName, context }) {
    console.log(`[collab] ${context?.username ?? '?'} salió de "${documentName}"`);
  },

  // ── Carga del documento: binario Yjs desde PostgreSQL ─────────────────────
  async onLoadDocument({ document, documentName }) {
    activeDocuments.set(documentName, document);

    // Salas de proyecto (no tienen archivo asociado)
    if (documentName.startsWith('project:') && !documentName.includes(':archivo:')) {
      return document;
    }

    const stateUpdate = await loadDocument(documentName);

    if (stateUpdate) {
      // Aplicar el estado Yjs binario — preserva historial de operaciones CRDT
      Y.applyUpdate(document, stateUpdate);
      console.log(`[collab] Estado Yjs aplicado: ${documentName}`);
      return document;
    }

    // Documento nuevo: inicializar con template por defecto
    const sharedText = document.getText('codemirror');
    if (sharedText.length === 0) {
      sharedText.insert(0, INITIAL_DOCUMENT);
    }

    return document;
  },

  // ── Persistencia: guarda estado Yjs binario en PostgreSQL ─────────────────
  async onStoreDocument({ document, documentName }) {
    if (documentName.startsWith('project:') && !documentName.includes(':archivo:')) {
      return; // salas de proyecto no persisten contenido de archivo
    }

    const stateUpdate = Y.encodeStateAsUpdate(document);
    const content     = document.getText('codemirror').toString();

    await storeDocument(documentName, stateUpdate, content);
  },

  async onChange({ document, documentName }) {
    if (documentName.startsWith('project:') && !documentName.includes(':archivo:')) {
      return;
    }
    // Persistencia incremental en cada cambio
    const stateUpdate = Y.encodeStateAsUpdate(document);
    const content     = document.getText('codemirror').toString();
    await storeDocument(documentName, stateUpdate, content);
  },
});

// ── Poll-sync: refresca documentos activos desde la BD ────────────────────
// Útil cuando otro servicio (Django/collab_sync) actualiza contenido directamente.
async function refreshActiveDocuments() {
  for (const [documentName, document] of activeDocuments.entries()) {
    if (!document) continue;
    if (documentName.startsWith('project:') && !documentName.includes(':archivo:')) continue;

    try {
      const stateUpdate = await loadDocument(documentName);
      if (!stateUpdate) continue;

      const remoteDoc = new Y.Doc();
      Y.applyUpdate(remoteDoc, stateUpdate);
      const remoteText = remoteDoc.getText('codemirror').toString();
      const localText  = document.getText('codemirror').toString();
      remoteDoc.destroy();

      if (remoteText !== localText) {
        // Aplicar diferencia sin sobrescribir el historial CRDT
        Y.applyUpdate(document, stateUpdate);
        console.log(`[collab] Poll-sync: cambio externo aplicado a "${documentName}"`);
      }
    } catch (err) {
      console.warn(`[collab] Poll-sync error en "${documentName}":`, err?.message ?? err);
    }
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
async function startServer() {
  try {
    await server.listen();
    console.log(`[collab] Servidor en http/ws://localhost:${PORT}`);

    if (ENABLE_POLL_SYNC) {
      setInterval(() => {
        refreshActiveDocuments().catch(err =>
          console.warn('[collab] Poll-sync error general:', err?.message ?? err)
        );
      }, SYNC_INTERVAL_MS);
      console.log(`[collab] Poll-sync habilitado cada ${SYNC_INTERVAL_MS}ms`);
    }
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      const alreadyRunning = await isCollabServiceRunningOnPort();
      if (alreadyRunning) {
        console.log(`[collab] Ya hay una instancia activa en el puerto ${PORT}.`);
        return;
      }
      console.error(`[collab] Puerto ${PORT} en uso por otro proceso.`);
      process.exitCode = 1;
      return;
    }
    console.error('[collab] Error al iniciar el servidor:', error);
    process.exitCode = 1;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function extractProjectId(documentName) {
  const m = documentName.match(/^(?:project:)?(\d+)/);
  return m ? m[1] : null;
}

startServer();