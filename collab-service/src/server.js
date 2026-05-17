import { Server } from '@hocuspocus/server';
import jwt from 'jsonwebtoken';
import { getStoredDocumentContent, upsertStoredDocumentContent } from './documentStore.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-production';
const PORT = parseInt(process.env.PORT ?? '1234', 10);
const FRONTEND_ORIGIN = 'http://localhost:4200';
const INITIAL_DOCUMENT = `#include <iostream>\n\nint main() {\n    std::cout << "Hola C++" << std::endl;\n    return 0;\n}`;
const documentSnapshots = new Map();
const activeDocuments = new Map();
const roomConnectionCounts = new Map();
const suppressPersistCounts = new Map();
const SYNC_INTERVAL_MS = parseInt(process.env.COLLAB_SYNC_INTERVAL_MS ?? '1000', 10);
const ENABLE_POLL_SYNC = (process.env.COLLAB_ENABLE_POLL_SYNC ?? 'true').toLowerCase() === 'true';

function incrementRoomConnections(roomName) {
  const current = roomConnectionCounts.get(roomName) ?? 0;
  roomConnectionCounts.set(roomName, current + 1);
}

function decrementRoomConnections(roomName) {
  const current = roomConnectionCounts.get(roomName) ?? 0;
  const next = Math.max(0, current - 1);
  if (next === 0) {
    roomConnectionCounts.delete(roomName);
    activeDocuments.delete(roomName);
    return;
  }
  roomConnectionCounts.set(roomName, next);
}

function hasActiveConnections(roomName) {
  return (roomConnectionCounts.get(roomName) ?? 0) > 0;
}

function beginSuppressPersist(roomName) {
  const current = suppressPersistCounts.get(roomName) ?? 0;
  suppressPersistCounts.set(roomName, current + 1);
}

function endSuppressPersist(roomName) {
  const current = suppressPersistCounts.get(roomName) ?? 0;
  const next = Math.max(0, current - 1);
  if (next === 0) {
    suppressPersistCounts.delete(roomName);
    return;
  }
  suppressPersistCounts.set(roomName, next);
}

function shouldSuppressPersist(roomName) {
  return (suppressPersistCounts.get(roomName) ?? 0) > 0;
}

function applyContentToDocument(document, content) {
  const sharedText = document.getText('codemirror');
  const currentText = sharedText.toString();

  if (currentText === content) {
    return false;
  }

  beginSuppressPersist(document.name);
  try {
    document.transact(() => {
      sharedText.delete(0, sharedText.length);
      if (content.length > 0) {
        sharedText.insert(0, content);
      }
    }, 'collab-sync');
  } finally {
    endSuppressPersist(document.name);
  }

  return true;
}

async function persistDocument(document) {
  const sharedText = document.getText('codemirror').toString();
  documentSnapshots.set(document.name, sharedText);
  await upsertStoredDocumentContent(document.name, sharedText);
}

async function refreshActiveDocumentsFromStore() {
  for (const [roomName, document] of activeDocuments.entries()) {
    try {
      if (!hasActiveConnections(roomName)) {
        continue;
      }

      const stored = await getStoredDocumentContent(roomName);

      if (!stored.found) {
        continue;
      }

      const changed = applyContentToDocument(document, stored.content);
      if (changed) {
        documentSnapshots.set(roomName, stored.content);
        console.log(`[collab] Documento sincronizado desde el almacenamiento → "${roomName}"`);
      }
    } catch (error) {
      console.warn(`[collab] No se pudo refrescar "${roomName}" desde el almacenamiento:`, error?.message ?? error);
    }
  }
}

async function isCollabServiceRunningOnPort() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/dev-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'healthcheck', username: 'healthcheck' }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return typeof data?.token === 'string' && data.token.length > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ── Servidor Hocuspocus ────────────────────────────────────────────────────
const server = Server.configure({
  port: PORT,

  async onRequest({ request, response }) {
    setCorsHeaders(response);
    response.setHeader('X-Instance-Port', String(PORT));

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      throw null;
    }

    if (request.url === '/dev-token' && request.method === 'POST') {
      let body = '';
      request.on('data', chunk => {
        body += chunk;
      });

      request.on('end', () => {
        try {
          const { userId, username } = JSON.parse(body);
          const token = jwt.sign(
            { sub: userId, username },
            JWT_SECRET,
            { expiresIn: '8h' },
          );

          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ token }));
        } catch {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'userId y username requeridos' }));
        }
      });

      throw null;
    }
  },

  async onAuthenticate({ token, connection }) {
    if (!token) throw new Error('Token requerido');
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      connection.requiresAuthentication = true;
      console.log(`[collab] ${payload.username ?? payload.sub ?? 'Anónimo'} autenticado`);
      return {
        user: {
          id: payload.sub ?? 'anon',
          name: payload.username ?? 'Anónimo',
        },
        userId: payload.sub ?? 'anon',
        username: payload.username ?? 'Anónimo',
      };
    } catch (err) {
      console.error('[collab] Auth fallida:', err?.message ?? err);
      throw new Error('Token inválido o expirado');
    }
  },

  async onConnect({ documentName, connection }) {
    incrementRoomConnections(documentName);
    console.log(`[collab] Conexión iniciada a "${documentName}"`);
  },

  async onDisconnect({ documentName, connection }) {
    decrementRoomConnections(documentName);
    const user = connection?.context?.user;
    console.log(`[collab] ${user?.name ?? connection?.context?.username ?? '?'} salió de "${documentName}"`);
  },

  async onLoadDocument({ document }) {
    activeDocuments.set(document.name, document);

    const snapshot = documentSnapshots.get(document.name);

    if (snapshot) {
      const sharedText = document.getText('codemirror');
      if (sharedText.length === 0) {
        sharedText.insert(0, snapshot);
      }
      return document;
    }

    const stored = await getStoredDocumentContent(document.name);

    if (stored.found) {
      const sharedText = document.getText('codemirror');

      if (sharedText.length === 0) {
        sharedText.insert(0, stored.content);
      }

      documentSnapshots.set(document.name, stored.content);
      activeDocuments.set(document.name, document);
      return document;
    }

    const sharedText = document.getText('codemirror');

    if (sharedText.length === 0) {
      sharedText.insert(0, INITIAL_DOCUMENT);
      documentSnapshots.set(document.name, sharedText.toString());
      await upsertStoredDocumentContent(document.name, sharedText.toString());
    }

    activeDocuments.set(document.name, document);
    return document;
  },

  async onChange({ document }) {
    if (shouldSuppressPersist(document.name)) {
      return;
    }
    await persistDocument(document);
  },

  async onStoreDocument({ document }) {
    await persistDocument(document);
  },
});

async function startServer() {
  try {
    await server.listen();
    console.log(`[collab] Servidor en http/ws://localhost:${PORT}`);
    console.log(`[collab] Endpoint de token de prueba: POST http://localhost:${PORT}/dev-token`);

    if (ENABLE_POLL_SYNC) {
      setInterval(() => {
        refreshActiveDocumentsFromStore().catch((error) => {
          console.warn('[collab] Error en sincronización periódica desde almacenamiento:', error?.message ?? error);
        });
      }, SYNC_INTERVAL_MS);
    }
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      const alreadyRunning = await isCollabServiceRunningOnPort();
      if (alreadyRunning) {
        console.log(`[collab] Ya hay una instancia activa en el puerto ${PORT}. Reutilizando servicio existente.`);
        return;
      }

      console.error(`[collab] El puerto ${PORT} ya está en uso por otro proceso. Cierra el proceso que lo ocupa o cambia PORT.`);
      process.exitCode = 1;
      return;
    }

    console.error('[collab] Error al iniciar el servidor:', error);
    process.exitCode = 1;
  }
}

startServer();
