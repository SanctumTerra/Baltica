import type { Worker } from "node:worker_threads";
import {
	type ClientOptions,
	type ClientEvents,
	Priority,
	type Frame,
} from "@sanctumterra/raknet";
import { defaultClientOptions, type Advertisement } from "@sanctumterra/raknet";
import { connect } from "./worker";
import { Emitter } from "../../libs/emitter";

class WorkerClient extends Emitter<ClientEvents> {
	private _worker: Worker | undefined;
	private _options: ClientOptions;
	private advertisement: Advertisement | undefined;

	constructor(options: Partial<ClientOptions>) {
		super();
		this._options = { ...defaultClientOptions, ...options };
		this._worker = connect(this._options);
		this.handleEvents();
	}

	public get worker() {
		return this._worker;
	}

	private handleEvents() {
		if (!this._worker) return;

		this._worker.on("message", (evt) => {
			switch (evt.type) {
				case "encapsulated":
					this.emit("encapsulated", Buffer.from(evt.args[0]));
					break;
				case "connect":
					this.emit("connect", evt.args);
					break;
				case "error":
					this.emit("error", new Error(evt.error));
					break;
			}
		});

		this._worker.on("error", (error) => {
			this.emit("error", error);
		});
	}

	public connect(): Promise<Advertisement> {
		return new Promise((resolve, reject) => {
			if (!this._worker) {
				reject(new Error("Worker not initialized"));
				return;
			}

			const timeoutId = setTimeout(() => {
				cleanup();
				reject(new Error("Connection timeout"));
			}, this._options.timeout);

			const cleanup = () => {
				clearTimeout(timeoutId);
				this.removeAllListeners("connect");
				this.removeAllListeners("error");
			};

			const errorHandler = (error: Error) => {
				cleanup();
				reject(error);
			};

			this.once("connect", (advertisement) => {
				cleanup();
				resolve(advertisement);
			});

			this.once("error", errorHandler);

			try {
				this._worker.postMessage({ type: "connect", options: this._options });
			} catch (error) {
				cleanup();
				reject(error);
			}
		});
	}

	public dispose() {
		if (this._worker) {
			try {
				this._worker.terminate();
			} catch (error) {
				console.error("Error terminating worker:", error);
			}
			this._worker = undefined;
		}
		this.removeAllListeners();
	}


	public frameAndSend(payload: Buffer, priority: Priority = Priority.Normal) {
		if(!this._worker) return;
		this._worker.postMessage({type: "frameAndSend", payload, priority});
	}

	public sendFrame(frame: Frame, priority: Priority = Priority.Normal) {
		if (!this._worker) return;
		this._worker.postMessage({ type: "sendFrame", frame, priority });
	}

	public send(buffer: Buffer) {
		if (!this._worker) return;
		this._worker.postMessage({ type: "send", buffer });
	}
}

// Example usage
// const client = new WorkerClient({
//     address: "127.0.0.1",
//     port: 19132
// })
// client.connect().then((advertisement) => {
//     console.log(advertisement);
// }).catch((error) => {
//     console.error(error);
// });

export { WorkerClient };
