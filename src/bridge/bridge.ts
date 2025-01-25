import { type Player, Server, type ServerEvents } from "../server";
import type { ForceArray } from "../libs";
import { type BridgeOptions, defaultBridgeOptions } from "./bridge-options";
import { Connection, Logger, Priority } from "@sanctumterra/raknet";
import { BridgePlayer } from "./bridge-player";
import { Packets, getPacketId, PlayStatus } from "@serenityjs/protocol";
import { Client, type PacketNames } from "../client";
import { ClientCacheStatusPacket } from "../network/client-cache-status";
import { LevelChunkPacket } from "../network/level-chunk-packet";

type BridgeSpecificEvents = {
    "connect": [BridgePlayer];
}

type BridgeEvents = ServerEvents & BridgeSpecificEvents;

export class Bridge extends Server {
    public options: BridgeOptions;
    private clients: Map<string, BridgePlayer> = new Map();


    constructor(options: Partial<BridgeOptions> = {}) {
        super(options);
        this.options = { ...defaultBridgeOptions, ...options };
        this.prepare();
    }

    public prepare(){
        this.on("playerConnect", this.onConnect.bind(this));
        this.raknet.options.maxPacketsPerSecond = 120000;
    }

    public onConnect(player: Player) {
        if(!(player.connection instanceof Connection)) return;
        const bridgePlayer = new BridgePlayer(this, player);
        this.clients.set(`${player.connection.getAddress().address}:${player.connection.getAddress().port}`, bridgePlayer);
        this.emit("connect", bridgePlayer);

        bridgePlayer.player.once("ClientCacheStatusPacket", (packet) => {
            bridgePlayer.cacheStatus = packet.supported;
        })

        bridgePlayer.player.on("ClientToServerHandshakePacket", (packet) => {
            console.log("ClientToServerHandshakePacket");
            this.onLogin(bridgePlayer);
            return;
        })
    }


    public onLogin(player: BridgePlayer){
        const client = new Client({
            host: this.options.destination.host,
            port: this.options.destination.port,
            version: "1.21.50",
            offline: false,
            tokensFolder: "tokens",
            viewDistance: 2,
            worker: true
        });

        player.client = client;
        client.cancelPastLogin = true;
        client.removeAllListeners("ResourcePackStackPacket");
        client.removeAllListeners("ResourcePacksInfoPacket");
        client.removeAllListeners("PlayStatusPacket");

        client.once("PlayStatusPacket", (packet) => {
            if(packet.status !== PlayStatus.LoginSuccess) throw new Error("Login failed");
            console.log("Login success");
            const status = new ClientCacheStatusPacket();
            status.supported = player.cacheStatus ?? false;
            client.send(status);

            const debugLog = false;
            // Does not yet allow modification of packets.
            client.processPacket = (buffer) => {
                const id = getPacketId(buffer);
                let PacketClass = Packets[id];
                if(!Packets[id]) {
                        if((id as number) !== 129) return;
                };
                if((id as number) === 129) {
                    PacketClass = ClientCacheStatusPacket;
                }
                if(PacketClass.name === "LevelChunkPacket") PacketClass = LevelChunkPacket;

                if(debugLog) {
                    Logger.info(`Client -> BridgePlayer : ${PacketClass.name}`)
                }
                try {
                    const packet = new PacketClass(buffer).deserialize();
                    player.emit(`clientbound-${PacketClass.name as PacketNames}`, packet);
                } catch(e) {
                    console.error(e);
                }
                player.player.send(buffer);
            };

            // Does not yet allow modification of packets.
            player.player.processPacket = (buffer) => {
                const id = getPacketId(buffer);
                if(!Packets[id]) {
                     if((id as number) !== 129) return;
                };
                let PacketClass = Packets[id];
                if((id as number) === 129) {
                    PacketClass = ClientCacheStatusPacket;
                }
                if(debugLog) {
                    Logger.info(`BridgePlayer -> Client : ${PacketClass.name}`)
                }
                
                try {
                    const packet = new PacketClass(buffer).deserialize();
                    player.emit(`serverbound-${PacketClass.name as PacketNames}`, packet);
                } catch(e) {
                    console.error(e);
                }
                client.send(buffer);
            };
        });

        client.connect();
    }

    declare emit: <K extends keyof BridgeEvents>(name: K, ...args: ForceArray<BridgeEvents[K]>) => void;
    declare on: <K extends keyof BridgeEvents>(name: K, callback: (...args: ForceArray<BridgeEvents[K]>) => void) => void;
    declare once: <K extends keyof BridgeEvents>(name: K, callback: (...args: ForceArray<BridgeEvents[K]>) => void) => void;
}