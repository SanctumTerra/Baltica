import {
	DisconnectMessage,
	DisconnectPacket,
	DisconnectReason,
} from "@serenityjs/protocol";
import type { LevelChunkPacket } from "../network/level-chunk-packet";
import type { Client, PacketNames } from "../client";
import { Emitter } from "../libs";
import type { Player } from "../server";
import type { Bridge } from "./bridge";
import type { BridgePlayerEvents } from "./bridge-options";

export class BridgePlayer extends Emitter<BridgePlayerEvents> {
	public player!: Player;
	public bridge!: Bridge;
	public client!: Client;
	public cacheStatus!: boolean;
	public postStartGame: boolean;
	public levelChunkQueue: LevelChunkPacket[];

	constructor(bridge: Bridge, player: Player) {
		super();
		this.bridge = bridge;
		this.player = player;
		this.postStartGame = false;
		this.levelChunkQueue = [];
		this.once("clientbound-StartGamePacket", (packet) => {
			this.postStartGame = true;
			for (const chunk of this.levelChunkQueue) {
				const eventName =
					"clientbound-LevelChunkPacket" as keyof BridgePlayerEvents & string;
				this.emit(eventName, chunk);
				if ("binary" in packet) {
					packet.binary = [];
				}
				const newBuffer = chunk.serialize();
				this.player.send(newBuffer);
			}
		});
	}

	public prepare(): void {
		this.player.connection.on("disconnect", () => {
			const disconnect = new DisconnectPacket();
			disconnect.hideDisconnectScreen = false;
			disconnect.message = new DisconnectMessage("");
			disconnect.reason =
				DisconnectReason.UnspecifiedClientInstanceDisconnection;
			this.client.send(disconnect);
		});
	}

	public getClient(): Client {
		return this.client;
	}
}
