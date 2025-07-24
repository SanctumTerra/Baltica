import type { ForceArray } from "src/libs/emitter";
import { type Player, Server } from "../server";
import { BridgePlayer } from "./bridge-player";
import { type BridgeOptions, defaultBridgeOptions } from "./types";
import type { BridgeEvents } from "./types/bridge-events";
import {
	DisconnectMessage,
	DisconnectPacket,
	DisconnectReason,
} from "node_modules/@serenityjs/protocol/dist";

export class Bridge extends Server {
	public options: BridgeOptions;
	private clients = new Map<string, BridgePlayer>();

	constructor(options: Partial<BridgeOptions>) {
		super(options);
		this.options = {
			...defaultBridgeOptions,
			...options,
		};
	}

	public async start() {
		super.start();
		// @ts-ignore
		this.on("playerConnect", (player: Player) => {
			const bridgePlayer = new BridgePlayer(player, this);
			console.log(
				`Player ${player.connection.remoteInfo.address} connected to bridge`,
			);
			const key = `${player.connection.remoteInfo.address}:${player.connection.remoteInfo.port}`;
			this.clients.set(key, bridgePlayer);
			this.emit("connect", bridgePlayer);
		});
	}

	public disconnect(player: BridgePlayer) {
		console.log("Disconnecting player", player.player.username);
		const disconnect = new DisconnectPacket();
		disconnect.hideDisconnectScreen = false;
		disconnect.message = new DisconnectMessage("Client leaving", "");
		disconnect.reason = DisconnectReason.LegacyDisconnect;
		player.client.send(disconnect.serialize());
		this.emit("disconnect", player);
		const key = `${player.player.connection.remoteInfo.address}:${player.player.connection.remoteInfo.port}`;
		this.clients.delete(key);
		this.onDisconnect(player.player);
	}

	// @ts-ignore
	declare emit: <K extends keyof BridgeEvents>(
		name: K,
		...args: ForceArray<BridgeEvents[K]>
	) => void;
	// @ts-ignore
	declare on: <K extends keyof BridgeEvents>(
		name: K,
		callback: (...args: ForceArray<BridgeEvents[K]>) => void,
	) => void;
	// @ts-ignore
	declare once: <K extends keyof BridgeEvents>(
		name: K,
		callback: (...args: ForceArray<BridgeEvents[K]>) => void,
	) => void;
}
