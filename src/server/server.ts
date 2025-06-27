import {
	Connection,
	Logger,
	Server as RaknetServer,
} from "@sanctumterra/raknet";
import { Emitter } from "../libs";
import { Player } from "./player";
import { type ServerOptions, defaultServerOptions } from "./server-options";
import { disconnect } from "node:process";
import {
	DisconnectMessage,
	DisconnectPacket,
	DisconnectReason,
} from "@serenityjs/protocol";

export interface ServerEvents {
	connection: [Connection];
	playerConnect: [Player];
	disconnect: [string, Player];
}

export class Server extends Emitter<ServerEvents> {
	public raknet: RaknetServer;
	private connections: Map<string, Player> = new Map();
	public options: ServerOptions;

	constructor(options: Partial<ServerOptions>) {
		super();
		this.options = { ...defaultServerOptions, ...options };

		this.raknet = new RaknetServer({
			version: this.options.version,
			host: this.options.host,
			port: this.options.port,
			maxConnections: this.options.maxPlayers,
			maxPacketsPerSecond: 3000,
			tickRate: 20,
			connectionTimeout: 120000,
		});
	}

	private getConnectionKey(connection: Connection): string {
		const addr = connection.getAddress();
		return `${addr.address}:${addr.port}`;
	}

	public start() {
		this.raknet.on("connect", (connection) => {
			if (!(connection instanceof Connection))
				throw new Error("Connection is not instance of Connection");

			const connectionKey = this.getConnectionKey(connection);
			const existingPlayer = this.connections.get(connectionKey);

			if (existingPlayer) {
				Logger.warn(
					`Disconnecting existing player ${existingPlayer.profile?.name ?? connectionKey} due to new connection from the same address.`,
				);
				// Send a disconnect packet to the existing player
				const disconnectPacket = new DisconnectPacket();
				disconnectPacket.message = new DisconnectMessage(
					"You were disconnected because a new connection was made from your IP address.",
				);
				disconnectPacket.reason = DisconnectReason.Kicked;
				disconnectPacket.hideDisconnectScreen = false;
				try {
					existingPlayer.send(disconnectPacket); // Assuming Player class has a send method for Protocol packets
					// Optionally, also force close RakNet connection if send isn't enough or player is unresponsive
					existingPlayer.connection.disconnect();
				} catch (error) {
					Logger.error(
						`Error sending disconnect to existing player ${connectionKey}:`,
						error,
					);
				}
				this.onDisconnect(existingPlayer); // Ensure cleanup and event emission
			}

			// Proceed to create and connect the new player
			const player = new Player(this, connection);
			this.connections.set(connectionKey, player);
			this.emit("playerConnect", player);
			const { address, port } = connection.getAddress();
			Logger.info(`Player connected from: ${address}:${port}`);
		});

		this.raknet.start();
	}

	public onDisconnect(player: Player) {
		const displayName =
			player.profile?.name ?? this.getConnectionKey(player.connection);
		Logger.info("Player disconnected: ", displayName);
		this.emit("disconnect", displayName, player);
		this.connections.delete(this.getConnectionKey(player.connection));
	}
}
