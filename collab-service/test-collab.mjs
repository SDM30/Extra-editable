/**
 * test-collab.mjs
 * Prueba manual del servicio colaborativo.
 * Ejecutar: node test-collab.mjs
 *
 * Requiere: npm install ws @hocuspocus/provider yjs jsonwebtoken
 * (instalar en una carpeta temporal aparte, NO en collab-service)
 */

import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';

// Simula el mismo secret que usa el servidor
const JWT_SECRET = 'dev-secret-change-in-production';

// Genera un token de prueba
const token = jwt.sign(
  { sub: 'user-001', username: 'TestUser' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

console.log('Token generado:', token);
console.log('Conectando al servidor colaborativo...\n');

const ydoc = new Y.Doc();
const text = ydoc.getText('codemirror');
let testExecuted = false;

const provider = new HocuspocusProvider({
  url: 'ws://localhost:1234',
  name: 'test-room',
  document: ydoc,
  token,
  WebSocketPolyfill: WebSocket,
  onConnect() {
    if (testExecuted) {
      return;
    }
    testExecuted = true;
    console.log('✅ Conectado');

    // Simula una edición
    ydoc.transact(() => {
      text.insert(0, '#include <iostream>\nint main() { return 0; }');
    });
    console.log('📝 Texto insertado:', text.toString());

    // Espera un momento y desconecta
    setTimeout(() => {
      console.log('🔌 Desconectando...');
      provider.destroy();
      process.exit(0);
    }, 2000);
  },
  onDisconnect() {
    console.log('Desconectado');
  },
  onAuthenticationFailed({ reason }) {
    console.error('❌ Auth fallida:', reason);
    process.exit(1);
  },
});
