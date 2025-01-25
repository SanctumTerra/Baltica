import { Emitter } from "../libs";
import type { Player } from "../server";
import type { Bridge } from "./bridge";
import type { Client, PacketNames } from "../client";
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


    public getClient(): Client {
        return this.client;
    }
}