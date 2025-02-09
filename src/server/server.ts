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
			if (this.connections.has(connectionKey)) return;

			const player = new Player(this, connection);
			this.connections.set(connectionKey, player);
			this.emit("playerConnect", player);
			const { address, port } = connection.getAddress();
			Logger.info("Player connected from: ", `${address}:${port}`);
		});

		this.raknet.start();
	}

	public onDisconnect(player: Player) {
		const displayName =
			player.profile.name ?? this.getConnectionKey(player.connection);
		Logger.info("Player disconnected: ", displayName);
		this.emit("disconnect", displayName, player);
		this.connections.delete(this.getConnectionKey(player.connection));
	}
}
