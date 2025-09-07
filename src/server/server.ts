import {
	type Connection,
	Logger,
	Server as RaknetServer,
} from "@sanctumterra/raknet";
import {
	DisconnectMessage,
	DisconnectPacket,
	DisconnectReason,
} from "@serenityjs/protocol";
import { Player } from "./player";
import {
	defaultServerOptions,
	type ServerEvents,
	type ServerOptions,
} from "./types";
import { Emitter } from "../shared";

export class Server extends Emitter<ServerEvents> {
	options: ServerOptions;
	raknet: RaknetServer;
	players: Map<string, Player> = new Map();

	constructor(options: Partial<ServerOptions>) {
		super();
		this.options = { ...defaultServerOptions, ...options };
		this.raknet = new RaknetServer({
			address: this.options.address,
			port: this.options.port,
			motd: this.options.motd,
			tickRate: this.options.tickRate,
		});
	}

	public getConKey(connection: Connection) {
		const addr = connection.getAddress();
		return `${addr.address}:${addr.port}`;
	}

	public start() {
		this.raknet.on("connect", (connection) => {
			const key = this.getConKey(connection);
			const existingPlayer = this.players.get(key);

			if (existingPlayer) {
				try {
					const disconnectPacket = new DisconnectPacket();
					disconnectPacket.message = new DisconnectMessage(
						"New connection has been created with the same Address..",
					);
					disconnectPacket.reason = DisconnectReason.Kicked;
					disconnectPacket.hideDisconnectScreen = false;
					existingPlayer.send(disconnectPacket);
				} catch (error) {
					Logger.error(error as Error);
				}
			}

			const player = new Player(this, connection);
			this.players.set(key, player);
			this.emit("playerConnect", player);
			const { address, port } = connection.getAddress();
			Logger.info(`Session received from: ${address}:${port}`);
		});
		this.raknet.listen();
	}

	public onDisconnect(player: Player) {
		const key = this.getConKey(player.connection);
		const displayName = player.username ?? key; // Just cause
		Logger.info("Player disconnected: ", displayName);
		this.emit("disconnect", displayName, player);
		this.players.delete(key);
	}
}
