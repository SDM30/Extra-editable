export type Language = 'cpp' | 'python' | 'typescript';

export interface RunMessage {
	type: 'run';
	language: Language;
	code: string;
}

export interface InputMessage {
	type: 'input';
	data: string;
}

export interface StopMessage {
	type: 'stop';
}

export type ClientMessage = RunMessage | InputMessage | StopMessage;