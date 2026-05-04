import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import { ClientMessage } from './types';
import { enqueue, initPool, removeFromQueues } from './containerPool';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => {
	res.json({ status: 'ok' });
});

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: '/ws/execute' });

wss.on('connection', (ws) => {
	const runtime: {
		stream?: NodeJS.WritableStream;
	} = {};

	ws.send(JSON.stringify({
		type: 'connected',
		data: 'Conectado al servicio de ejecución'
	}));

	ws.on('message', async (raw) => {
		try {
			const message = JSON.parse(raw.toString()) as ClientMessage;

			if (message.type === 'run') {
				enqueue(message.language, ws, message.code, runtime);
			}

			if (message.type === 'input') {

				if (runtime.stream) {
					runtime.stream.write(message.data)
				} else {
					ws.send(JSON.stringify({
						type: 'output',
						data: '\nTu programa aún está en cola o no está esperando entrada.\n',
					}));
				}
			}

			if (message.type === 'stop') {
				ws.send(JSON.stringify({
					type: 'output',
					data: '\nStop todavía no está implementado para contenedores persistentes.\n',
				}));
			}

			ws.on('close', async () => {
				removeFromQueues(ws);
			});

		} catch (error: any) {
			ws.send(JSON.stringify({
				type: 'error',
				data: error.message || 'Error interno del servicio'
			}));
		}
	});
});

async function main() {
	await initPool();

	server.listen(8081, () => {
		console.log('Servicio de ejecución escuchando en http://localhost:8081');
		console.log('WebSocket en ws://localhost:8081/ws/execute');
	});
}

main().catch((error) => {
	console.error('Error iniciando el servicio:', error);
	process.exit(1);
});