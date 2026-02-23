/**
 * Full Client Worker
 *
 * Runs the entire Client (auth, encryption, packet handling) inside a worker thread.
 * The main thread communicates via postMessage.
 */
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import { Logger } from "@sanctumterra/raknet";
import { Client } from "../../client";
import type { ClientOptions } from "../../types";

function startClientWorker(filename: string): Worker {
	const worker = new Worker(filename);
	worker.on("error", (error) => {
		Logger.error(`Client worker error: ${error.message}`);
	});
	return worker;
}

if (!isMainThread && parentPort) {
	const port = parentPort;
	let client: Client | undefined;

	const post = (data: unknown) => {
		port.postMessage(data);
	};

	port.on("message", async (msg) => {
		try {
			switch (msg.type) {
				case "connect": {
					const opts: Partial<ClientOptions> = {
						...msg.options,
						// Force worker off inside the worker thread to avoid nesting
						worker: false,
					};
					client = new Client(opts);

					client.on("session", () => {
						post({ type: "event", event: "session", args: [] });
					});

					client.on("msa", (message) => {
						post({ type: "event", event: "msa", args: [message] });
					});

					// Note: "connect" is emitted via the "connected" message after client.connect() resolves.
					// Do NOT forward the client's "connect" event here to avoid double-emit.

					client.on("disconnect", (reason) => {
						post({ type: "event", event: "disconnect", args: [reason] });
					});

					client.on("error", (error) => {
						post({
							type: "event",
							event: "error",
							args: [error instanceof Error ? error.message : String(error)],
						});
					});

					// Forward all deserialized packets as serialized buffers
					client.on("packet", (packet) => {
						try {
							const serialized = packet.serialize();
							post({ type: "packet", buffer: serialized });
						} catch {
							// Some packets may fail to re-serialize, skip them
						}
					});

					try {
						const [startGame] = await client.connect();
						const startGameBuffer = startGame.serialize();
						post({
							type: "connected",
							startGame: startGameBuffer,
							profile: client.profile,
							username: client.username,
						});
					} catch (error) {
						post({
							type: "event",
							event: "error",
							args: [error instanceof Error ? error.message : String(error)],
						});
					}
					break;
				}

				case "send": {
					if (!client) return;
					client.send(Buffer.from(msg.buffer));
					break;
				}

				case "queue": {
					if (!client) return;
					client.queue(Buffer.from(msg.buffer));
					break;
				}

				case "disconnect": {
					client?.disconnect(msg.reason);
					break;
				}

				case "destroy": {
					client?.destroy();
					client = undefined;
					break;
				}
			}
		} catch (error) {
			post({
				type: "event",
				event: "error",
				args: [error instanceof Error ? error.message : String(error)],
			});
		}
	});
}

export { startClientWorker };
