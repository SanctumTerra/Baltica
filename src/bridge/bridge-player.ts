import {
	type ClientToServerHandshakePacket,
	DataPacket,
	getPacketId,
	Packets,
	PlayStatus,
} from "@serenityjs/protocol";
import { Client } from "../client";
import type { Player } from "../server";
import type { Bridge } from "./bridge";
import type { BridgePlayerEvents } from "./types";
import { Emitter } from "../shared";

export class BridgePlayer extends Emitter<BridgePlayerEvents> {
	public bridge: Bridge;
	public player: Player;
	public client!: Client;

	constructor(player: Player, bridge: Bridge) {
		super();
		this.player = player;
		this.bridge = bridge;
		this.player.once(
			"ClientToServerHandshakePacket",
			this.onHandshake.bind(this),
		);
	}

	private onHandshake(packet: ClientToServerHandshakePacket) {
		this.client = new Client({
			address: this.bridge.options.destination.address,
			port: this.bridge.options.destination.port,
			offline: this.bridge.options.offline,
		});
		this.client.cancelPastLogin = true;

		this.client.once("PlayStatusPacket", (packet) => {
			if (packet.status !== PlayStatus.LoginSuccess)
				throw new Error("Login failed");
			this.client.processPacket = (buffer: Buffer) => {
				this.handlePacket(buffer, true);
			};
			this.player.processPacket = (buffer: Buffer) => {
				this.handlePacket(buffer, false);
			};
		});
		this.client.on("DisconnectPacket", (packet) =>
			this.bridge.disconnect(this),
		);
		this.player.on("DisconnectPacket", (packet) =>
			this.bridge.disconnect(this),
		);
		this.on("clientBound-DisconnectPacket", (signal) =>
			this.bridge.disconnect(this),
		);
		this.on("serverBound-DisconnectPacket", (signal) =>
			this.bridge.disconnect(this),
		);
		this.bridge.on("disconnect", () => this.bridge.disconnect(this));
		this.client.connect();
	}

	public handlePacket(rawBuffer: Buffer, clientBound: boolean) {
		let buffer: Buffer = rawBuffer;
		const id = getPacketId(rawBuffer);
		const PacketClass = Packets[id as keyof typeof Packets];
		const event = PacketClass
			? `${clientBound ? "client" : "server"}Bound-${PacketClass.name}`
			: "Unknown";
		if (
			this.hasListeners(event as keyof BridgePlayerEvents) &&
			event !== "Unknown"
		) {
			const ctx = {
				packet: new PacketClass(buffer).deserialize(),
				cancelled: false,
				modified: false,
			};

			this.emit(event as keyof BridgePlayerEvents, ctx);

			if (ctx.cancelled) return;
			if (ctx.modified) buffer = ctx.packet.serialize();
		}

		if (clientBound) this.player.send(buffer);
		else this.client.send(buffer);
	}
}
