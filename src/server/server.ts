import { Emitter } from "../libs";
import { Server as RaknetServer, Connection, Logger } from "@sanctumterra/raknet";
import { defaultServerOptions, type ServerOptions } from "./server-options";
import { Player } from "./player";

interface ServerEvents {
    "connection": [Connection];
    "playerConnect": [Player];
    "disconnect": [string];
}

export class Server extends Emitter<ServerEvents> {
    private raknet: RaknetServer;
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
			tickRate: 20 
        });
    }

    public start() {
        this.raknet.on("connect", (connection) => {
            if(!(connection instanceof Connection)) throw new Error("Connection is not instance of Connection");
            const player = new Player(this, connection);
            if(this.connections.has(`${connection.getAddress().address}:${connection.getAddress().port}`)) return;
            this.connections.set(`${connection.getAddress().address}:${connection.getAddress().port}`, player);
			this.emit("playerConnect", player);
			Logger.info("Player connected: ", connection.getAddress());
		});

		this.raknet.start();
    }

    
    public onDisconnect(player: Player) {
        Logger.info("Player disconnected: ", player.profile.name ?? `${player.connection.getAddress().address}:${player.connection.getAddress().port}`);
        this.emit("disconnect", player.profile.name ?? `${player.connection.getAddress().address}:${player.connection.getAddress().port}`);
    }
}