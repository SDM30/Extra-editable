import Docker from 'dockerode';
import { WebSocket } from 'ws';
import { Language } from './types';
import { runOnContainer } from './dockeRunner';

const docker = new Docker();

interface Runtime {
	stream?: NodeJS.WritableStream;
}

interface LanguagePool {
	container: Docker.Container;
	busy: boolean;
	queue: QueueEntry[];
}

interface QueueEntry {
	ws: WebSocket;
	language: Language;
	code: string;
	runtime: Runtime;
}

const pool: Record<Language, LanguagePool> = {
	cpp: { container: null!, busy: false, queue: [] },
	python: { container: null!, busy: false, queue: [] },
	typescript: { container: null!, busy: false, queue: [] },
};

function getImage(language: Language): string {
	switch (language) {
		case 'cpp':
			return 'secure-cpp-runner:latest';
		case 'python':
			return 'secure-python-runner:latest';
		case 'typescript':
			return 'secure-typescript-runner:latest';
	}
}

function send(ws: WebSocket, data: object) {
	if (ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(data));
	}
}

async function createPersistentContainer(language: Language): Promise<Docker.Container> {
	const container = await docker.createContainer({
		Image: getImage(language),
		Cmd: ['sh', '-c', 'while true; do sleep 3600; done'],
		Tty: false,
		OpenStdin: false,
		HostConfig: {
			NetworkMode: 'none',
			Memory: 256 * 1024 * 1024,
			NanoCpus: 1_000_000_000,
			PidsLimit: 64,
			AutoRemove: false,
			SecurityOpt: ['no-new-privileges'],
		},
	});
	await container.start();
	return container;
}

export async function initPool(): Promise<void> {
	for (const lang of ['cpp', 'python', 'typescript'] as Language[]) {
		pool[lang].container = await createPersistentContainer(lang);
	}
}

export async function enqueue(language: Language, ws: WebSocket, code: string, runtime: Runtime) {
	const entry = pool[language];

	entry.queue.push({ ws, language, code, runtime });

	send(ws, {
		type: 'queued',
		position: entry.queue.length,
		language,
	});

	processNext(language);
}

function processNext(language: Language): void {
	const entry = pool[language];

	if (entry.busy) {
		return;
	}

	const next = entry.queue.shift();

	if (!next) {
		return;
	}

	entry.busy = true;

	send(next.ws, {
		type: 'dequeued',
		data: `Tu ejecución de ${language} inició.`,
	});

	runOnContainer(
		next.language,
		entry.container,
		next.ws,
		next.code,
		(stream) => {
			next.runtime.stream = stream;
		}
	)
		.catch((err) => {
			send(next.ws, {
				type: 'error',
				data: err.message || 'Error ejecutando el código.',
			});
		})
		.finally(() => {
			next.runtime.stream = undefined;
			entry.busy = false;

			processNext(language);
		});
}

export function removeFromQueues(ws: WebSocket): void {
	for (const lang of Object.keys(pool) as Language[]) {
		const entry = pool[lang];

		entry.queue = entry.queue.filter(q => q.ws !== ws);
	}
}