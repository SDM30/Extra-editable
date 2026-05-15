import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import jwt from 'jsonwebtoken';
import { loadDocument, storeDocument, checkProjectAccess } from './db.js';

const JWT_SECRET     = process.env.JWT_SECRET ?? 'django-insecure-dev-key'; // debe coincidir con Django SECRET_KEY
const PORT           = parseInt(process.env.PORT ?? '1234', 10);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:4200';

const INITIAL_DOCUMENT = `#include <iostream>\n\nint main() {\n    std::cout << "Hola C++" << std::endl;\n    return 0;\n}`;

// ── Health check (idéntico al original) ────────────────────────────────────
async function isCollabServiceRunningOnPort() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1500);
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

// ── CORS (idéntico al original) ────────────────────────────────────────────
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

  // ── HTTP handler: CORS + health ──────────────────────────────────────────
  // ELIMINADO: /dev-token — Django ya emite el JWT en /api/auth/login/
  // AGREGADO:  /health    — para health checks y el isCollabServiceRunningOnPort
  async onRequest({ request, response }) {
    setCorsHeaders(response);

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      throw null;
    }

    if (request.url === '/health' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
      throw null;
    }
  },

  // ── Auth: verifica JWT emitido por Django ─────────────────────────────────
  async onAuthenticate({ token, connection }) {
    if (!token) throw new Error('Token requerido');
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      connection.requiresAuthentication = true;
      // Guardamos el token original para reutilizarlo en checkProjectAccess
      return {
        userId:   String(payload.user_id ?? payload.sub ?? 'anon'),
        username: String(payload.username ?? 'Anónimo'),
        rawToken: token,
      };
    } catch (err) {
      console.error('[collab] Auth fallida:', err?.message ?? err);
      throw new Error('Token inválido o expirado');
    }
  },

  // ── Conexión: valida que el usuario tenga acceso al proyecto ──────────────
  // documentName debe tener formato "projectId:fileName" (ej: "42:main")
  async onConnect({ documentName, context }) {
    const [projectId] = documentName.split(':');

    if (projectId && projectId !== 'room-editor-1') {
      // room-editor-1 es el doc de demo sin projectId real (compatibilidad)
      const allowed = await checkProjectAccess(context.userId, projectId, context.rawToken);
      if (!allowed) {
        console.warn(`[collab] Acceso denegado: user=${context.userId} project=${projectId}`);
        throw new Error('Acceso denegado al proyecto');
      }
    }

    console.log(`[collab] ${context?.username ?? 'Anónimo'} se unió a "${documentName}"`);
  },

  // ── Desconexión (idéntico al original) ────────────────────────────────────
  async onDisconnect({ documentName, context }) {
    console.log(`[collab] ${context?.username ?? '?'} salió de "${documentName}"`);
  },

  // ── Carga del documento: Redis → PostgreSQL → INITIAL_DOCUMENT ────────────
  // Reemplaza el documentSnapshots Map en memoria por persistencia real.
  async onLoadDocument({ document, documentName }) {
    const stateUpdate = await loadDocument(documentName);

    if (stateUpdate) {
      Y.applyUpdate(document, stateUpdate);
      return document;
    }

    // Documento nuevo: inicializar con el template por defecto
    const sharedText = document.getText('codemirror');
    if (sharedText.length === 0) {
      sharedText.insert(0, INITIAL_DOCUMENT);
    }

    return document;
  },

  // ── Persistencia: guarda en Redis + PostgreSQL ─────────────────────────────
  // Reemplaza el documentSnapshots Map en memoria.
  async onStoreDocument({ document, documentName }) {
    const stateUpdate = Y.encodeStateAsUpdate(document);
    const sharedText  = document.getText('codemirror');
    const content     = sharedText.toString();

    await storeDocument(documentName, stateUpdate, content);
  },
});

// ── Bootstrap (idéntico al original) ──────────────────────────────────────
async function startServer() {
  try {
    await server.listen();
    console.log(`[collab] Servidor en http/ws://localhost:${PORT}`);
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

startServer();