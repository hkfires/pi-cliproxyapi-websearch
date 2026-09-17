export interface SseEvent {
	event: string;
	data: unknown;
}

export interface SseParser {
	push(chunk: string): void;
	end(): void;
}

export function createSseParser(onEvent: (event: SseEvent) => void): SseParser {
	let buffer = "";
	let eventName = "";
	let dataLines: string[] = [];

	const dispatch = () => {
		if (dataLines.length === 0) {
			eventName = "";
			return;
		}

		const text = dataLines.join("\n");
		let data: unknown = text;
		if (text !== "[DONE]") {
			try {
				data = JSON.parse(text);
			} catch {
				data = text;
			}
		}

		onEvent({ event: eventName || "message", data });
		eventName = "";
		dataLines = [];
	};

	const processLine = (line: string) => {
		if (line === "") {
			dispatch();
			return;
		}
		if (line.startsWith(":")) return;

		const separator = line.indexOf(":");
		const field = separator === -1 ? line : line.slice(0, separator);
		let value = separator === -1 ? "" : line.slice(separator + 1);
		if (value.startsWith(" ")) value = value.slice(1);

		if (field === "event") eventName = value;
		if (field === "data") dataLines.push(value);
	};

	return {
		push(chunk: string) {
			buffer += chunk;
			let newline: number;
			while ((newline = buffer.indexOf("\n")) !== -1) {
				let line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				if (line.endsWith("\r")) line = line.slice(0, -1);
				processLine(line);
			}
		},
		end() {
			if (buffer.length > 0) {
				let line = buffer;
				buffer = "";
				if (line.endsWith("\r")) line = line.slice(0, -1);
				processLine(line);
			}
			dispatch();
		},
	};
}

export async function consumeSseStream(
	stream: ReadableStream<Uint8Array>,
	onEvent: (event: SseEvent) => void,
	signal?: AbortSignal,
): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	const parser = createSseParser(onEvent);

	try {
		while (true) {
			if (signal?.aborted) {
				await reader.cancel();
				throw new Error("Web search request aborted");
			}
			const { done, value } = await reader.read();
			if (done) {
				parser.end();
				break;
			}
			if (value) {
				parser.push(decoder.decode(value, { stream: true }));
			}
		}
	} finally {
		reader.releaseLock();
	}
}
