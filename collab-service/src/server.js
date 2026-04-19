import { Server } from '@hocuspocus/server';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-production';
const PORT = parseInt(process.env.PORT ?? '1234', 10);
const FRONTEND_ORIGIN = 'http://localhost:4200';

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
      return {
        userId: payload.sub ?? 'anon',
        username: payload.username ?? 'Anónimo',
      };
    } catch {
      throw new Error('Token inválido o expirado');
    }
  },

  async onConnect({ documentName, context }) {
    console.log(`[collab] ${context.username} se unió a "${documentName}"`);
  },

  async onDisconnect({ documentName, context }) {
    console.log(`[collab] ${context?.username ?? '?'} salió de "${documentName}"`);
  },

  async onLoadDocument({ document }) {
    return document;
  },
});

async function startServer() {
  try {
    await server.listen();
    console.log(`[collab] Servidor en http/ws://localhost:${PORT}`);
    console.log(`[collab] Endpoint de token de prueba: POST http://localhost:${PORT}/dev-token`);
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      console.error(`[collab] El puerto ${PORT} ya está en uso. Cierra el proceso que lo ocupa o cambia PORT.`);
      process.exitCode = 1;
      return;
    }

    console.error('[collab] Error al iniciar el servidor:', error);
    process.exitCode = 1;
  }
}

startServer();