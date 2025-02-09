import { Connection, Frame, Logger, Priority } from "@sanctumterra/raknet";
import {
	type DataPacket,
	type Packet,
	Packets,
	PlayStatus,
	getPacketId,
} from "@serenityjs/protocol";
import * as Protocol from "@serenityjs/protocol";
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
import DisconnectionNotification from "@sanctumterra/raknet/dist/proto/packets/disconnect";

type ProtocolPacket = DataPacket;

type PacketConstructor<T extends ProtocolPacket = ProtocolPacket> = new (
	buffer: Buffer,
) => T & {
	deserialize(): T;
	serialize(): Buffer;
};

type BridgeSpecificEvents = {
	connect: [BridgePlayer];
};

type BridgeEvents = ServerEvents & BridgeSpecificEvents;

export class Bridge extends Server {
	public options: BridgeOptions;
	private clients = new Map<string, BridgePlayer>();
	private packetClassCache = new Map<number, PacketConstructor>();
	private packetSerializationCache = new Map<string, Buffer>();
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

		const levelChunkId = (LevelChunkPacket as unknown as { id: number }).id;
		if (levelChunkId !== undefined) {
			this.packetClassCache.set(
				levelChunkId,
				LevelChunkPacket as unknown as PacketConstructor,
			);
		}
	}

	private getPacketClass(
		id: number,
		PacketClass?: (typeof Packets)[keyof typeof Packets],
	): PacketConstructor | undefined {
		if (
			!this.packetClassCache.has(id) &&
			PacketClass &&
			typeof PacketClass === "function"
		) {
			this.packetClassCache.set(
				id,
				PacketClass as unknown as PacketConstructor,
			);
		}
		return this.packetClassCache.get(id);
	}

	private processPacketCommon(
		buffer: Buffer,
		player: BridgePlayer,
		isClientbound: boolean,
		sender: { send: (data: Buffer) => void },
	): void {
		const id = getPacketId(buffer);
		const PacketClass = Packets[id as keyof typeof Packets];
		const packetName = PacketClass?.name ?? "ClientCacheStatusPacket";
		const eventName =
			`${isClientbound ? "clientbound" : "serverbound"}-${packetName}` as keyof BridgePlayerEvents &
				string;

		if (!PacketClass && (id as number) !== 129) {
			sender.send(buffer);
			return;
		}

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

			const cacheKey = `${id}-${buffer.toString("hex")}`;
			let newBuffer = this.packetSerializationCache.get(cacheKey);

			if (!newBuffer) {
				const packet = new CachedPacketClass(
					buffer,
				).deserialize() as ProtocolPacket;

				if (packet instanceof ClientCacheStatusPacket) {
					packet.supported = false;
					Logger.warn("Ignoring ClientCacheStatusPacket");
					return;
				}

				const cancelled = false;
				player.emit(eventName, packet, cancelled);
				if (cancelled) return;

				if ("binary" in packet) {
					packet.binary = [];
				}

				newBuffer = packet.serialize();
				this.packetSerializationCache.set(cacheKey, newBuffer);
			}

			sender.send(newBuffer);
		} catch (e) {
			Logger.error(`Failed to process ${packetName}`, e);
			sender.send(buffer);
		}
	}

	public prepare() {
		this.on("playerConnect", this.onConnect.bind(this));
		this.raknet.options.maxPacketsPerSecond = 20000;

		this.on("disconnect", (data, _player) => {
			const disconnect = new Protocol.DisconnectPacket();
			disconnect.hideDisconnectScreen = true;
			disconnect.message = new Protocol.DisconnectMessage("Disconnected");
			disconnect.reason = Protocol.DisconnectReason.Disconnected;

			const address = _player.connection.getAddress();
			const playerKey = `${address.address}:${address.port}`;
			const player = this.clients.get(playerKey);

			if (player) {
				const rakDisconnect = new DisconnectionNotification();
				const frame = new Frame();
				frame.orderChannel = 0;
				frame.payload = rakDisconnect.serialize();
				player.client.raknet.sendFrame(frame, Priority.Immediate);
				player.client.send(disconnect);
			}
		});
	}

	public onConnect(player: Player) {
		if (!(player.connection instanceof Connection)) return;

		const bridgePlayer = new BridgePlayer(this, player);
		const address = player.connection.getAddress();
		const playerKey = `${address.address}:${address.port}`;

		this.clients.set(playerKey, bridgePlayer);
		this.emit("connect", bridgePlayer);

		bridgePlayer.player.once("ClientCacheStatusPacket", (packet) => {
			bridgePlayer.cacheStatus = packet.supported;
		});

		bridgePlayer.player.on("ClientToServerHandshakePacket", () => {
			this.onLogin(bridgePlayer);
		});
	}

	public onLogin(player: BridgePlayer) {
		const client = new Client({
			host: this.options.destination.host,
			port: this.options.destination.port,
			version: "1.21.50",
			tokensFolder: "tokens",
			viewDistance: 2,
			worker: true,
			offline: this.options.offline,
		});

		player.client = client;
		client.cancelPastLogin = true;
		client.removeAllListeners("ResourcePackStackPacket");
		client.removeAllListeners("ResourcePacksInfoPacket");
		client.removeAllListeners("PlayStatusPacket");

		client.once("ResourcePacksInfoPacket", () => {
			client.send(ClientCacheStatusPacket.create(false));
		});

		player.once("serverbound-ResourcePackClientResponsePacket", () => {
			player.player.send(ClientCacheStatusPacket.create(false));
		});

		client.once("PlayStatusPacket", (packet) => {
			if (packet.status !== PlayStatus.LoginSuccess) {
				throw new Error("Login failed");
			}

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
