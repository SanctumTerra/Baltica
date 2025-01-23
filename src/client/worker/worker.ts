import { Client, Logger, type ClientOptions } from "@sanctumterra/raknet";
import { Worker, isMainThread, parentPort } from "node:worker_threads";

function connect(options: ClientOptions) {
	if (isMainThread) {
		const worker = new Worker(__filename);

		// Add error handler for the worker itself
		worker.on("error", (error) => {
			Logger.error(`Worker error: ${error.message}`);
		});

		return worker;
	}
}

let client: Client | undefined;

function cleanup() {
	if (client) {
		try {
			client.removeAll();
			// Add any additional cleanup needed
		} catch (error) {
			Logger.error(`Cleanup error: ${error}`);
		}
	}
}

function main() {
	if (!parentPort) {
		Logger.error("Parent port is null");
		return;
	}

	// Handle worker thread termination
	process.on("exit", cleanup);
	process.on("SIGINT", () => {
		cleanup();
		process.exit(0);
	});

	parentPort.on("message", async (evt) => {
		try {
			if (evt.type === "connect") {
				// Cleanup any existing client
				cleanup();

				client = new Client(evt.options);

				// Set up error handling
				client.on("error", (error) => {
					if (!parentPort) return;
					parentPort.postMessage({
						type: "error",
						error: error instanceof Error ? error.message : String(error),
					});
				});

				// Wrap event handlers in try-catch blocks
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
				client.sendFrame(evt.frame, evt.priority);
			}
			if (evt.type === "frameAndSend") {
				if (!client) return;
				client.frameAndSend(evt.payload, evt.priority);
			}
			if (evt.type === "send") {
				if (!client) return;
				client.send(evt.packet);
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
