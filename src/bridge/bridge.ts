import { Connection, Logger, Priority } from "@sanctumterra/raknet";
import {
	type DataPacket,
	type Packet,
	Packets,
	PlayStatus,
	getPacketId,
} from "@serenityjs/protocol";
import type * as Protocol from "@serenityjs/protocol";
import { Client, type PacketNames } from "../client";
import type { ForceArray } from "../libs";
import { ClientCacheStatusPacket } from "../network/client-cache-status";
import { LevelChunkPacket } from "../network/level-chunk-packet";
import { type Player, Server, type ServerEvents } from "../server";
import {
	type BridgeOptions,
	type BridgePlayerEvents,
	defaultBridgeOptions,
} from "./bridge-options";
import { BridgePlayer } from "./bridge-player";

type ProtocolPacket = DataPacket;

interface PacketConstructor<T extends ProtocolPacket = ProtocolPacket> {
	new (
		buffer: Buffer,
	): T & {
		deserialize(): T;
		serialize(): Buffer;
	};
}

type BridgeSpecificEvents = {
	connect: [BridgePlayer];
};

type BridgeEvents = ServerEvents & BridgeSpecificEvents;

export class Bridge extends Server {
	public options: BridgeOptions;
	private clients: Map<string, BridgePlayer> = new Map();
	private packetClassCache: Map<number, PacketConstructor> = new Map();
	private readonly debugLog = false;

	constructor(options: Partial<BridgeOptions> = {}) {
		super(options);
		this.options = { ...defaultBridgeOptions, ...options };
		this.prepare();
		this.initializePacketCache();
	}

	private initializePacketCache() {
		const CLIENT_CACHE_STATUS_ID = 129;
		this.packetClassCache.set(
			CLIENT_CACHE_STATUS_ID,
			ClientCacheStatusPacket as unknown as PacketConstructor,
		);

		if ("id" in LevelChunkPacket) {
			const levelChunkId = (LevelChunkPacket as unknown as { id: number }).id;
			this.packetClassCache.set(
				levelChunkId,
				LevelChunkPacket as unknown as PacketConstructor,
			);
		}
	}

	private getPacketClass(
		id: number,
		PacketClass: (typeof Packets)[keyof typeof Packets] | undefined,
	): PacketConstructor | undefined {
		const CLIENT_CACHE_STATUS_ID = 129;
		let CachedPacketClass = this.packetClassCache.get(id);
		if (!CachedPacketClass) {
			if (id === CLIENT_CACHE_STATUS_ID) {
				CachedPacketClass =
					ClientCacheStatusPacket as unknown as PacketConstructor;
			} else if (PacketClass && typeof PacketClass === "function") {
				CachedPacketClass = PacketClass as unknown as PacketConstructor;
			}
			if (CachedPacketClass) {
				this.packetClassCache.set(id, CachedPacketClass);
			}
		}
		return CachedPacketClass;
	}

	private processPacketCommon(
		buffer: Buffer,
		player: BridgePlayer,
		isClientbound: boolean,
		sender: { send: (data: Buffer) => void },
	): void {
		const CLIENT_CACHE_STATUS_ID = 129;
		const id = getPacketId(buffer);
		const PacketClass = Packets[id as keyof typeof Packets];

		// @ts-ignore
		if (!PacketClass && id !== CLIENT_CACHE_STATUS_ID) {
			sender.send(buffer);
			return;
		}

		const packetName = PacketClass?.name ?? "ClientCacheStatusPacket";
		const eventName =
			`${isClientbound ? "clientbound" : "serverbound"}-${packetName}` as keyof BridgePlayerEvents &
				string;

		/** Some devices can not handle LevelChunkPacket before StartGamePacket cuz Mojang is Mojang. */
		if (packetName === "LevelChunkPacket" && !player.postStartGame) {
			player.levelChunkQueue.push(
				new LevelChunkPacket(buffer).deserialize() as LevelChunkPacket,
			);
			return;
		}

		if (
			!player.hasListeners(eventName) &&
			packetName !== "ClientCacheStatusPacket"
		) {
			sender.send(buffer);
			return;
		}

		try {
			const CachedPacketClass = this.getPacketClass(id, PacketClass);
			if (!CachedPacketClass) {
				sender.send(buffer);
				return;
			}

			if (this.debugLog) {
				Logger.info(
					`${isClientbound ? "Client -> BridgePlayer" : "BridgePlayer -> Client"} : ${packetName}`,
				);
			}

			const packet = new CachedPacketClass(
				buffer,
			).deserialize() as ProtocolPacket;

			if (packet instanceof ClientCacheStatusPacket) {
				packet.supported = false;
				Logger.warn("Ignoring ClientCacheStatusPacket");
				return;
			}

			player.emit(eventName, packet);

			if ("binary" in packet) {
				packet.binary = [];
			}

			const newBuffer = packet.serialize();
			sender.send(newBuffer);
			// sender.send(buffer.equals(newBuffer) ? buffer : newBuffer);
		} catch (e) {
			console.error(`Failed to process ${packetName}`, e);
			sender.send(buffer);
		}
	}

	public prepare() {
		this.on("playerConnect", this.onConnect.bind(this));
		this.raknet.options.maxPacketsPerSecond = 20000;
	}

	public onConnect(player: Player) {
		if (!(player.connection instanceof Connection)) return;
		const bridgePlayer = new BridgePlayer(this, player);
		this.clients.set(
			`${player.connection.getAddress().address}:${player.connection.getAddress().port}`,
			bridgePlayer,
		);
		this.emit("connect", bridgePlayer);

		bridgePlayer.player.once("ClientCacheStatusPacket", (packet) => {
			bridgePlayer.cacheStatus = packet.supported;
		});

		bridgePlayer.player.on("ClientToServerHandshakePacket", (packet) => {
			console.log("ClientToServerHandshakePacket");
			this.onLogin(bridgePlayer);
			return;
		});
	}

	public onLogin(player: BridgePlayer) {
		const client = new Client({
			host: this.options.destination.host,
			port: this.options.destination.port,
			version: "1.21.50",
			offline: false,
			tokensFolder: "tokens",
			viewDistance: 2,
			worker: true,
		});

		player.client = client;
		client.cancelPastLogin = true;
		client.removeAllListeners("ResourcePackStackPacket");
		client.removeAllListeners("ResourcePacksInfoPacket");
		client.removeAllListeners("PlayStatusPacket");

		client.once("ResourcePacksInfoPacket", (packet) => {
			client.send(ClientCacheStatusPacket.create(false));
		});

		player.once("serverbound-ResourcePackClientResponsePacket", (packet) => {
			player.player.send(ClientCacheStatusPacket.create(false));
		});

		client.once("PlayStatusPacket", (packet) => {
			if (packet.status !== PlayStatus.LoginSuccess)
				throw new Error("Login failed");

			client.processPacket = (buffer) => {
				this.processPacketCommon(buffer, player, true, player.player);
			};

			player.player.processPacket = (buffer) => {
				this.processPacketCommon(buffer, player, false, client);
			};
		});

		client.connect();
	}

	declare emit: <K extends keyof BridgeEvents>(
		name: K,
		...args: ForceArray<BridgeEvents[K]>
	) => void;
	declare on: <K extends keyof BridgeEvents>(
		name: K,
		callback: (...args: ForceArray<BridgeEvents[K]>) => void,
	) => void;
	declare once: <K extends keyof BridgeEvents>(
		name: K,
		callback: (...args: ForceArray<BridgeEvents[K]>) => void,
	) => void;
}
