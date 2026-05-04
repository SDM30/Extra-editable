import Docker from 'dockerode';
import { WebSocket } from 'ws';
import { Language } from './types';
import { PassThrough } from 'stream';

function getCommand(language: Language): string[] {
	switch (language) {
		case 'cpp':
			return ['sh', '-c', 'cd /tmp && printf "%s" "$CODE_B64" | base64 -d > main.cpp && g++ main.cpp -o main && ./main'];

		case 'python':
			return ['sh', '-c', 'cd /tmp && printf "%s" "$CODE_B64" | base64 -d > main.py && python3 main.py'];

		case 'typescript':
			return ['sh', '-c', 'cd /tmp && printf "%s" "$CODE_B64" | base64 -d > main.ts && npx ts-node main.ts'];

		default:
			throw new Error('Lenguaje no soportado');
	}
}

export async function runOnContainer(
	language: Language,
	container: Docker.Container,
	ws: WebSocket,
	code: string,
	onReady: (stream: NodeJS.WritableStream) => void
): Promise<void> {
	const cmd = getCommand(language);
	const codeB64 = Buffer.from(code, 'utf-8').toString('base64');

	const exec = await container.exec({
		Cmd: cmd,
		Env: [`CODE_B64=${codeB64}`],
		AttachStdin: true,
		AttachStdout: true,
		AttachStderr: true,
		Tty: false,
	});

	const stream = await exec.start({
		hijack: true,
		stdin: true,
	});

	onReady(stream);

	const stdoutStream = new PassThrough();
	const stderrStream = new PassThrough();

	container.modem.demuxStream(stream, stdoutStream, stderrStream);

	stdoutStream.on('data', (chunk: Buffer) => {
		ws.send(JSON.stringify({
			type: 'output',
			data: chunk.toString()
		}));
	});

	stderrStream.on('data', (chunk: Buffer) => {
		ws.send(JSON.stringify({
			type: 'output',
			data: chunk.toString()
		}));
	});

	ws.send(JSON.stringify({
		type: 'started'
	}));

	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			ws.send(JSON.stringify({
				type: 'timeout',
				data: 'La ejecución superó el tiempo máximo permitido.'
			}));

			resolve();
		}, 60000);

		const interval = setInterval(async () => {
			try {
				const info = await exec.inspect();

				if (!info.Running) {
					clearInterval(interval);
					clearTimeout(timeout);

					ws.send(JSON.stringify({
						type: 'finished',
						exitCode: info.ExitCode ?? 0
					}));

					resolve();
				}
			} catch (err) {
				clearInterval(interval);
				clearTimeout(timeout);

				reject();
			}
		}, 300);
	});
}