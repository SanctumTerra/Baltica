import {
	DisconnectMessage,
	DisconnectPacket,
	DisconnectReason,
	type LevelChunkPacket,
} from "@serenityjs/protocol";
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
		this.once("clientbound-StartGamePacket", (packet, eventStatus) => {
			this.postStartGame = true;
			for (const chunk of this.levelChunkQueue) {
				const eventName =
					"clientbound-LevelChunkPacket" as keyof BridgePlayerEvents & string;
				this.emit(eventName, chunk, { cancelled: false, modified: false });
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
