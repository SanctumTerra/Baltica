/**
 * WorkerClient
 *
 * Main-thread proxy that runs the entire Client inside a worker thread.
 * Exposes the same API surface as Client (connect, send, disconnect, events).
 */
import type { Worker } from "node:worker_threads";
import {
	DataPacket,
	getPacketId,
	Packets,
	type StartGamePacket,
} from "@serenityjs/protocol";
import { Logger } from "@sanctumterra/raknet";

import { Emitter } from "../../../shared";
import type { Profile } from "../../../shared/auth";
import type { ClientEvents, ClientOptions } from "../../types";
import type { PacketNames } from "../../../shared/types";
import { startClientWorker } from "./worker";

export class WorkerClient extends Emitter<ClientEvents> {
	private _worker: Worker | undefined;
	private _options: Partial<ClientOptions>;

	public profile!: Profile;
	public username = "";
	public startGameData!: StartGamePacket;

	constructor(options: Partial<ClientOptions>) {
		super();
		this._options = options;
	}

	public get worker(): Worker | undefined {
		return this._worker;
	}

	async connect(): Promise<[StartGamePacket]> {
		this._worker = startClientWorker(
			__filename.replace("worker-client", "worker"),
		);

		return new Promise((resolve, reject) => {
			if (!this._worker) {
				reject(new Error("Worker not initialized"));
				return;
			}

			this._worker.on("message", (msg) => {
				switch (msg.type) {
					case "connected": {
						const buf = Buffer.from(msg.startGame);
						const PacketClass = Packets[getPacketId(buf)];
						if (PacketClass) {
							this.startGameData = new PacketClass(
								buf,
							).deserialize() as StartGamePacket;
						}
						this.profile = msg.profile;
						this.username = msg.username;
						this.emit("connect");
						resolve([this.startGameData]);
						break;
					}

					case "event": {
						const { event, args } = msg;
						// "connect" is handled via the "connected" message, skip to avoid double-emit
						if (event === "connect") break;
						if (event === "error") {
							this.emit("error", new Error(args[0]));
						} else {
							this.emit(event as keyof ClientEvents, ...args);
						}
						break;
					}

					case "packet": {
						const buffer = Buffer.from(msg.buffer);
						const id = getPacketId(buffer);
						const PacketClass = Packets[id];
						if (PacketClass?.name) {
							try {
								const deserialized = new PacketClass(buffer).deserialize();
								this.emit(PacketClass.name as PacketNames, deserialized);
								this.emit("packet", deserialized);
							} catch (error) {
								Logger.error(
									`Failed to deserialize packet ${PacketClass.name}`,
									error,
								);
							}
						}
						break;
					}
				}
			});

			this._worker.on("error", (error) => {
				this.emit("error", error);
			});

			this._worker.postMessage({ type: "connect", options: this._options });
		});
	}

	public send(packet: DataPacket | Buffer): void {
		if (!this._worker) return;
		const buffer = packet instanceof DataPacket ? packet.serialize() : packet;
		this._worker.postMessage({ type: "send", buffer });
	}

	public queue(packet: DataPacket | Buffer): void {
		if (!this._worker) return;
		const buffer = packet instanceof DataPacket ? packet.serialize() : packet;
		this._worker.postMessage({ type: "queue", buffer });
	}

	public disconnect(reason?: string): void {
		if (!this._worker) return;
		this._worker.postMessage({ type: "disconnect", reason });
	}

	public destroy(): void {
		if (this._worker) {
			this._worker.postMessage({ type: "destroy" });
			try {
				this._worker.terminate();
			} catch {
				// Ignore
			}
			this._worker = undefined;
		}
		super.destroy();
	}
}
