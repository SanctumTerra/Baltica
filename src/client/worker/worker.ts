import {
	Client,
	type ClientOptions,
	Frame,
	Logger,
} from "@sanctumterra/raknet";
import { Worker, isMainThread, parentPort } from "node:worker_threads";

function connect(options: ClientOptions) {
	if (isMainThread) {
		const worker = new Worker(__filename);

		worker.on("error", (error) => {
			Logger.error(`Worker error: ${error.message}`);
		});

		return worker;
	}
}

let client: Client | undefined;

function main() {
	if (!parentPort) {
		Logger.error("Parent port is null");
		return;
	}

	process.on("SIGINT", () => {
		process.exit(0);
	});

	parentPort.on("message", async (evt) => {
		try {
			if (evt.type === "connect") {
				client = new Client(evt.options);

				client.on("error", (error) => {
					if (!parentPort) return;
					parentPort.postMessage({
						type: "error",
						error: error instanceof Error ? error.message : String(error),
					});
				});

				client.on("encapsulated", (...args) => {
					try {
						if (!parentPort) return;
						parentPort.postMessage({ type: "encapsulated", args });
					} catch (error) {
						Logger.error(`Encapsulated event error: ${error}`);
					}
				});

				client.on("connect", (...args) => {
					try {
						if (!parentPort) return;
						parentPort.postMessage({ type: "connect", args });
					} catch (error) {
						Logger.error(`Connect event error: ${error}`);
					}
				});

				try {
					await client.connect();
				} catch (error) {
					if (!parentPort) return;
					parentPort.postMessage({
						type: "error",
						error: error instanceof Error ? error.message : "Connection failed",
					});
				}
			}
			if (evt.type === "sendFrame") {
				if (!client) return;
				// evt.name is Frame but as Object not Frame.
				const frame = new Frame();
				frame.orderChannel = evt.frame.orderChannel;
				frame.payload = evt.frame.payload;
				frame.reliability = evt.frame.reliability;
				frame.reliableFrameIndex = evt.frame.reliableFrameIndex;
				frame.sequenceFrameIndex = evt.frame.sequenceFrameIndex;
				frame.splitSize = evt.frame.splitSize;
				frame.splitFrameIndex = evt.frame.splitFrameIndex;
				frame.splitId = evt.frame.splitId;
				client.sendFrame(frame, evt.priority);
			}

			if (evt.type === "frameAndSend") {
				if (!client) return;
				client.frameAndSend(evt.payload, evt.priority);
			}
			if (evt.type === "send") {
				if (!client) return;
				client.send(evt.packet);
			}
			if (evt.type === "disconnect") {
				client?.disconnect();
			}
		} catch (error) {
			if (!parentPort) return;
			parentPort.postMessage({
				type: "error",
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});
}

if (!isMainThread) {
	try {
		main();
	} catch (error) {
		Logger.error(`Worker thread error: ${error}`);
		process.exit(1);
	}
}

export { connect };
