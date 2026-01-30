import { createHash, createPublicKey } from "node:crypto";

import {
	Client as RaknetClient,
	ConnectionStatus,
	Logger,
	Priority,
} from "@sanctumterra/raknet";
import {
	ClientCacheStatusPacket,
	ClientToServerHandshakePacket,
	DataPacket,
	getPacketId,
	Packets,
	PlayStatus,
	RequestChunkRadiusPacket,
	RequestNetworkSettingsPacket,
	RequestedResourcePack,
	ResourcePackClientResponsePacket,
	ResourcePackResponse,
	ResourcePacksInfoPacket,
	ServerboundLoadingScreenPacketPacket,
	ServerboundLoadingScreenType,
	SetLocalPlayerAsInitializedPacket,
	type StartGamePacket,
} from "@serenityjs/protocol";

import {
	authenticate,
	createOfflineSession,
	Emitter,
	PacketCompressor,
	PacketEncryptor,
	type Profile,
} from "../shared";
import {
	CurrentVersionConst,
	type PacketNames,
	ProtocolList,
} from "../shared/types";
import {
	ClientData,
	type ClientEvents,
	type ClientOptions,
	defaultClientOptions,
} from "./types";
import { WorkerClient } from "./worker";

/**
 * Client class represents a Minecraft Bedrock Edition client.
 * It handles connection, authentication, packet processing, encryption, and communication with the server.
 * It supports both online and offline modes, as well as worker threads for networking.
 * It emits various events for packet handling and connection status changes.
 * It does not handle game logic; that is left to the user of the class.
 * It is designed to be extensible and customizable through options and event listeners.
 * Thanks for reading my yap session. :)
 */
export class Client extends Emitter<ClientEvents> {
	/** Client Options that change decisions duh. */
	options: ClientOptions;
	/** Raknet Connection (Normal or Worker) */
	raknet: RaknetClient | WorkerClient;
	/** Whether session is ready and we are set to go and connect. */
	sessionReady: boolean;
	/** Authentication profile */
	profile!: Profile;
	/** Whether encryption is enabled or not */
	_encryptionEnabled: boolean;
	/** Whether compression is enabled or not */
	_compressionEnabled: boolean;
	/** Client username (This will be set automatically based on authentication and offline mode) */
	username: string;
	/** Client Data for auth and login. */
	data!: ClientData;
	/** Client status in this attempted connection */
	status: ConnectionStatus;
	/** Packet Compression (class for simplicfication) */
	packetCompressor!: PacketCompressor;
	/** Packet Encryptor (class for simplification) */
	packetEncryptor!: PacketEncryptor;
	/** Secret Key bytes */
	secretKeyBytes!: Buffer;
	/** IV bytes for Encryption */
	iv!: Buffer;
	/** StartGameData that includes a lot of importand data */
	startGameData!: StartGamePacket;
	/** Whether we should continue after sending Login (Proxy use) */
	cancelPastLogin: boolean;
	private disconnectReason?: string;

	constructor(options: Partial<ClientOptions>) {
		super();
		this.options = { ...defaultClientOptions, ...options };
		/** this is unecessary since auth will set it anyway but i am adding just incase. */
		this.username = this.options.username;
		/** Bool values */
		this.sessionReady = false;
		this.cancelPastLogin = false;
		this._compressionEnabled = false;
		this._encryptionEnabled = false;
		/** Client status */
		this.status = ConnectionStatus.Disconnected;
		/** worker or not. */
		this.raknet = this.options.worker
			? new WorkerClient({
					address: this.options.address,
					port: this.options.port,
					proxy: this.options.proxy,
				})
			: new RaknetClient({
					address: this.options.address,
					port: this.options.port,
					proxy: this.options.proxy,
				});
		/** Create ClientData to store and handle auth data */
		this.data = new ClientData(this);

		this.raknet.on("disconnect", () => this.cleanup());
	}

	/** Connect to the server and start sending/receiving packets. */
	async connect(): Promise<[StartGamePacket]> {
		// Authenticate first before connecting to raknet
		try {
			if (this.options.offline) {
				await createOfflineSession(this);
			} else {
				await authenticate(this);
			}
		} catch (error) {
			// Clean up raknet on auth failure to prevent hanging process
			this.destroy();
			throw error;
		}
		this.sessionReady = true;

		await this.raknet.connect();

		this.status = ConnectionStatus.Connecting;
		this.packetCompressor = new PacketCompressor(this);
		this.handleGamePackets();

		this.raknet.on("encapsulated", this.handleEncapsulated.bind(this));

		const request = new RequestNetworkSettingsPacket();
		request.protocol = ProtocolList[CurrentVersionConst];
		this.send(request);

		return new Promise((resolve, rejevt) => {
			this.once("SetLocalPlayerAsInitializedPacket", (packet) => {
				this.emit("connect");
				resolve([this.startGameData]);
			});
		});
	}

	private handleEncapsulated(buffer: Buffer): void {
		try {
			const packets = this.packetCompressor.decompress(buffer);
			for (const packet of packets) {
				this.processPacket(packet);
			}
		} catch (error) {
			Logger.error("Failed to handle encapsulated packet", error);
		}
	}
	/**
	 * Packets must be decompressed and decrypted already
	 */
	public processPacket(buffer: Buffer): void {
		const id = getPacketId(buffer);
		const PacketClass = Packets[id];
		try {
			if (!PacketClass || !PacketClass.name) {
				if (this.options.emitUnknownPackets) {
					this.emit(`${id}` as `${number}`, buffer);
				} else {
					Logger.warn(`Unknown Game packet ${id}`);
				}
				return;
			}

			const hasSpecificListener = this.hasListeners(
				PacketClass.name as PacketNames,
			);
			const hasGenericListener = this.hasListeners("packet");

			if (hasSpecificListener || hasGenericListener) {
				const deserializedPacket = new PacketClass(buffer).deserialize();

				if (hasSpecificListener) {
					this.emit(PacketClass.name as PacketNames, deserializedPacket);
				}

				if (hasGenericListener) {
					this.emit("packet", deserializedPacket);
				}
			}
		} catch (error) {
			Logger.error(
				`Failed to process packet ${PacketClass?.name || id}`,
				error,
			);
		}
	}
	/** Do not call this, leaving it public incase someone needs to override this for some reason. */
	public handleGamePackets() {
		this.once("NetworkSettingsPacket", async (packet) => {
			this._compressionEnabled = true;
			this.options.compressionMethod = this.packetCompressor.getMethod(
				packet.compressionMethod,
			);
			this.options.compressionThreshold = packet.compressionThreshold;
			const loginPacket = this.data.createLoginPacket();
			this.send(loginPacket);
		});

		this.once("ServerToClientHandshakePacket", (packet) => {
			const [header, payload] = packet.token
				.split(".")
				.map((k: string) => Buffer.from(k, "base64"));
			const { x5u } = JSON.parse(header.toString());
			const { salt } = JSON.parse(payload.toString());

			const pubKeyDer = createPublicKey({
				key: Buffer.from(x5u, "base64"),
				type: "spki",
				format: "der",
			});

			this.data.sharedSecret = ClientData.createSharedSecret(
				this.data.loginData.ecdhKeyPair.privateKey,
				pubKeyDer,
			);

			const secretHash = createHash("sha256")
				.update(new Uint8Array(Buffer.from(salt, "base64")))
				.update(new Uint8Array(this.data.sharedSecret))
				.digest();

			this.secretKeyBytes = secretHash;
			this.iv = secretHash.slice(0, 16);
			this.startEncryption(this.iv);

			const handshake = new ClientToServerHandshakePacket();
			this.send(handshake);
		});

		this.once("ResourcePacksInfoPacket", (packet) => {
			if (this.cancelPastLogin) return;
			const response = new ResourcePackClientResponsePacket();

			response.packs = packet.packs.map(
				(p) => new RequestedResourcePack(p.uuid, p.version),
			);
			response.response = ResourcePackResponse.HaveAllPacks;
			this.send(response);

			if (packet instanceof ResourcePacksInfoPacket) {
				const packet = new ClientCacheStatusPacket();
				packet.enabled = false;
				this.send(packet);
			}
		});

		this.once("ResourcePackStackPacket", (packet) => {
			const response = new ResourcePackClientResponsePacket();
			response.packs = packet.texturePacks.map(
				(p) => new RequestedResourcePack(p.uuid, p.version),
			);
			response.response = ResourcePackResponse.Completed;
			this.send(response);
		});

		this.once("StartGamePacket", (packet) => {
			this.startGameData = packet;
			const radius = new RequestChunkRadiusPacket();
			radius.radius = this.options.viewDistance;
			radius.maxRadius = this.options.viewDistance;
			this.send(radius);
		});

		this.on("PlayStatusPacket", (packet) => {
			if (packet.status === PlayStatus.PlayerSpawn) {
				const init = new SetLocalPlayerAsInitializedPacket();
				init.runtimeEntityId = this.startGameData.runtimeEntityId;

				const serverBoundLoadingScreen =
					new ServerboundLoadingScreenPacketPacket();
				serverBoundLoadingScreen.type =
					ServerboundLoadingScreenType.EndLoadingScreen;
				serverBoundLoadingScreen.hasScreenId = false;

				this.send(serverBoundLoadingScreen);
				this.send(init);
				this.emit("SetLocalPlayerAsInitializedPacket", init);
			}
		});
		this.on("DisconnectPacket", (packet) => {
			this.disconnect(packet.message.message ?? undefined);
		});
	}

	public disconnect(reason?: string): void {
		if (this.status === ConnectionStatus.Disconnected) return;
		this.disconnectReason = reason;
		this.raknet.disconnect();
	}

	private cleanup(): void {
		this.status = ConnectionStatus.Disconnected;
		this._encryptionEnabled = false;
		this._compressionEnabled = false;
		this.sessionReady = false;
		this.emit("disconnect", this.disconnectReason);
		this.disconnectReason = undefined;
	}

	public startEncryption(iv: Buffer): void {
		this.packetEncryptor = new PacketEncryptor(this, iv);
		this._encryptionEnabled = true;
	}

	/**
	 * Sends Packets to the server.
	 *
	 * Please use send for important packets and queue for less important packets.
	 */
	private sendPacket(
		packet: DataPacket | Buffer,
		priority: Priority = Priority.High,
	): void {
		try {
			if (this.status === ConnectionStatus.Disconnected) return;

			const serialized =
				packet instanceof DataPacket ? packet.serialize() : packet;
			const compressed = this.packetCompressor.compress(
				serialized,
				this.options.compressionMethod,
			);

			this.raknet.frameAndSend(compressed, priority);
		} catch (error) {
			Logger.error(
				`Failed to send packet ${packet instanceof DataPacket ? packet.constructor.name : "Buffer"}`,
				error,
			);
		}
	}

	public send(packet: DataPacket | Buffer): void {
		this.sendPacket(packet, Priority.High);
	}

	public queue(packet: DataPacket | Buffer): void {
		Logger.debug(
			`Queueing packet ${packet instanceof DataPacket ? packet.constructor.name : "Buffer"}`,
		);
		this.sendPacket(packet, Priority.High);
	}

	/** Fully destroy the client and clean up all resources */
	public destroy(): void {
		this.cleanup();
		if (this.raknet instanceof WorkerClient) {
			this.raknet.dispose();
		} else {
			// RaknetClient - call disconnect which should clean up internal timers
			try {
				this.raknet.disconnect();
			} catch {
				// Ignore errors during cleanup
			}
		}
		super.destroy();
	}
}
