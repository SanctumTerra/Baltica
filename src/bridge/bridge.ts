import { Connection, Frame, Logger, Priority } from "@sanctumterra/raknet";
import {
	ClientCacheStatusPacket,
	type DataPacket,
	type Packet,
	Packets,
	PlayStatus,
	getPacketId,
} from "@serenityjs/protocol";
import * as Protocol from "@serenityjs/protocol";
import { Client, DeviceOS, SkinData, type PacketNames } from "../client";
import type { ForceArray } from "../libs";
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

		const levelChunkId = (
			Protocol.LevelChunkPacket as unknown as { id: number }
		).id;
		if (levelChunkId !== undefined) {
			this.packetClassCache.set(
				levelChunkId,
				Protocol.LevelChunkPacket as unknown as PacketConstructor,
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
		console.log(packetName);

		const eventName =
			`${isClientbound ? "clientbound" : "serverbound"}-${packetName}` as keyof BridgePlayerEvents &
				string;

		if (!PacketClass && (id as number) !== 129) {
			if (this.debugLog) {
				Logger.info(`Passing through unknown packet ID: ${id}`);
			}
			sender.send(buffer);
			return;
		}

		if (packetName === "LevelChunkPacket" && !player.postStartGame) {
			try {
				player.levelChunkQueue.push(
					new Protocol.LevelChunkPacket(
						buffer,
					).deserialize() as Protocol.LevelChunkPacket,
				);
			} catch (e) {
				Logger.error("Failed to deserialize LevelChunkPacket for queueing", e);
				sender.send(buffer);
			}
			return;
		}

		if (packetName === "ItemStackRequestPacket") {
			if (this.debugLog) {
				Logger.info(
					`Passing through ItemStackRequestPacket (ID: ${id}) without processing.`,
				);
			}
			sender.send(buffer);
			return;
		}

		const hasListeners = player.hasListeners(eventName);
		const isClientCachePacket = packetName === "ClientCacheStatusPacket";
		const needsProcessing = hasListeners || isClientCachePacket;

		if (!needsProcessing) {
			if (this.debugLog) {
				Logger.info(
					`${isClientbound ? "Client -> BridgePlayer" : "BridgePlayer -> Client"} : ${packetName} (ID: ${id}) (No listeners/special handling, sending original)`,
				);
			}
			sender.send(buffer);
			return;
		}

		const cacheKey = `${id}-${buffer.toString("hex")}`;
		const cachedSerializedBuffer = this.packetSerializationCache.get(cacheKey);
		if (cachedSerializedBuffer) {
			if (this.debugLog) {
				Logger.info(
					`${isClientbound ? "Client -> BridgePlayer" : "BridgePlayer -> Client"} : ${packetName} (ID: ${id}) (Sending cached serialized)`,
				);
			}
			sender.send(cachedSerializedBuffer);
			return;
		}

		const CachedPacketClass = this.getPacketClass(id, PacketClass);
		if (!CachedPacketClass) {
			Logger.warn(
				`Could not get packet class for ${packetName} (ID: ${id}) despite needing processing. Sending original.`,
			);
			sender.send(buffer);
			return;
		}

		let packet: ProtocolPacket;
		try {
			packet = new CachedPacketClass(buffer).deserialize();
		} catch (e) {
			Logger.error(
				`Failed to deserialize ${packetName} (ID: ${id}). Sending original buffer.`,
				e,
			);
			sender.send(buffer);
			return;
		}

		if (packet instanceof ClientCacheStatusPacket) {
			packet.enabled = false;
			Logger.warn(`Modified and dropping ClientCacheStatusPacket (ID: ${id})`);
			return;
		}

		const eventStatus = { cancelled: false, modified: false };
		if (hasListeners) {
			if (this.debugLog) {
				Logger.info(
					`${isClientbound ? "Client -> BridgePlayer" : "BridgePlayer -> Client"} : ${packetName} (ID: ${id}) (Emitting event)`,
				);
			}
			player.emit(eventName, packet, eventStatus);

			if (eventStatus.cancelled) {
				if (this.debugLog) {
					Logger.info(
						`${isClientbound ? "Client -> BridgePlayer" : "BridgePlayer -> Client"} : ${packetName} (ID: ${id}) (Cancelled by listener)`,
					);
				}
				return;
			}
		}

		let bridgeMadeModifications = false;
		if ("binary" in packet && packet.binary !== undefined) {
			if (!Array.isArray(packet.binary) || packet.binary.length > 0) {
				(packet as ProtocolPacket & { binary: unknown[] }).binary = [];
				bridgeMadeModifications = true;
			}
		}

		const requiresSerialization =
			eventStatus.modified || bridgeMadeModifications;
		if (requiresSerialization) {
			if (this.debugLog) {
				Logger.info(
					`${isClientbound ? "Client -> BridgePlayer" : "BridgePlayer -> Client"} : ${packetName} (ID: ${id}) (Re-serializing after modification)`,
				);
			}
			try {
				const newSerializedBuffer = packet.serialize();
				this.packetSerializationCache.set(cacheKey, newSerializedBuffer);
				sender.send(newSerializedBuffer);
			} catch (e) {
				Logger.error(
					`Failed to serialize modified ${packetName} (ID: ${id}). Sending original buffer.`,
					e,
				);
				sender.send(buffer);
			}
		} else {
			if (this.debugLog) {
				Logger.info(
					`${isClientbound ? "Client -> BridgePlayer" : "BridgePlayer -> Client"} : ${packetName} (ID: ${id}) (Processed, not modified, sending original)`,
				);
			}
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
				player.client?.raknet?.sendFrame(frame, Priority.Immediate);
				player.client?.send(disconnect);
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
		bridgePlayer.player.once(
			"ClientCacheStatusPacket",
			(packet: ClientCacheStatusPacket) => {
				bridgePlayer.cacheStatus = packet.enabled;
			},
		);

		bridgePlayer.player.on("ClientToServerHandshakePacket", () => {
			this.onLogin(bridgePlayer);
		});
	}

	public onLogin(player: BridgePlayer) {
		console.log("Creating Client");

		const payload = player.player.data.payload;
		console.log(this.options)
		const client = new Client({
			host: this.options.destination.host,
			port: this.options.destination.port,
			version: this.options.version,
			tokensFolder: "tokens",
			viewDistance: payload.MaxViewDistance,
			worker: true,
			offline: this.options.offline,
			deviceOS: payload.DeviceOS,
			skinData: {
				AnimatedImageData: payload.AnimatedImageData,
				ArmSize: payload.ArmSize,
				SkinData: payload.SkinData,
				TrustedSkin: payload.TrustedSkin,
				CapeData: payload.CapeData,
				CapeId: payload.CapeId,
				CapeImageHeight: payload.CapeImageHeight,
				CapeImageWidth: payload.CapeImageWidth,
				CapeOnClassicSkin: payload.CapeOnClassicSkin,
				PersonaPieces: payload.PersonaPieces,
				PieceTintColors: payload.PieceTintColors,
				PersonaSkin: payload.PersonaSkin,
				PremiumSkin: payload.PremiumSkin,
				SkinAnimationData: payload.SkinAnimationData,
				SkinColor: payload.SkinColor,
				SkinGeometryData: payload.SkinGeometryData,
				SkinGeometryDataEngineVersion: payload.SkinGeometryDataEngineVersion,
				SkinId: payload.SkinId,
				SkinImageHeight: payload.SkinImageHeight,
				SkinImageWidth: payload.SkinImageWidth,
				SkinResourcePatch: payload.SkinResourcePatch,
			},
			loginOptions: {
				CurrentInputMode: payload.CurrentInputMode,
				DefaultInputMode: payload.DefaultInputMode,
				DeviceModel: payload.DeviceModel,
			},
			platformType: payload.PlatformType,
			memoryTier: payload.MemoryTier,
			uiProfile: payload.UIProfile,
			graphicsMode: payload.GraphicsMode,
		});

		console.log(this.options);

		player.client = client;
		client.cancelPastLogin = true;
		client.removeAllListeners("ResourcePackStackPacket");
		client.removeAllListeners("ResourcePacksInfoPacket");
		client.removeAllListeners("PlayStatusPacket");

		client.once("ResourcePacksInfoPacket", () => {
			const packet = new ClientCacheStatusPacket();
			packet.enabled = false;
			client.send(packet.serialize());
		});

		player.once(
			"serverbound-ResourcePackClientResponsePacket",
			(packet, eventStatus) => {
				const responsePacket = new ClientCacheStatusPacket();
				responsePacket.enabled = false;
				player.player.send(responsePacket.serialize());
			},
		);

		client.once("PlayStatusPacket", (packet) => {
			if (packet.status !== PlayStatus.LoginSuccess) {
				console.log(packet);
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
