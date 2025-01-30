import {
	DisconnectMessage,
	DisconnectPacket,
	DisconnectReason,
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

	constructor(bridge: Bridge, player: Player) {
		super();
		this.bridge = bridge;
		this.player = player;
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
