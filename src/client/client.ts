import { createHash } from "node:crypto";
import { createPublicKey } from "node:crypto";
import {
	type Advertisement,
	Frame,
	Logger,
	Priority,
	Client as RaknetClient,
	Status,
} from "@sanctumterra/raknet";

import {
	ClientCacheStatusPacket,
	ClientToServerHandshakePacket,
	DataPacket,
	Packet,
	Packets,
	PlayStatus,
	type PlayStatusPacket,
	RequestChunkRadiusPacket,
	RequestNetworkSettingsPacket,
	ResourcePackClientResponsePacket,
	ResourcePackResponse,
	type ResourcePackStackPacket,
	ResourcePacksInfoPacket,
	ServerboundLoadingScreenPacketPacket,
	ServerboundLoadingScreenType,
	SetLocalPlayerAsInitializedPacket,
	type StartGamePacket,
	TextPacket,
	TextPacketType,
	getPacketId,
} from "@serenityjs/protocol";
import { Emitter } from "../libs/emitter";
import {
	PacketCompressor,
	type Profile,
	authenticate,
	createOfflineSession,
} from "../network";
import { PacketEncryptor } from "../network/packet-encryptor";
import { ClientData } from "./client-data";
import {
	type ClientEvents,
	type ClientOptions,
	type PacketNames,
	ProtocolList,
	defaultClientOptions,
} from "./client-options";
import { WorkerClient } from "./worker";

const RETRY_INTERVAL_MS = 50;
const CONNECTION_CHECK_INTERVAL_MS = 50;
const NETWORK_SETTINGS_RETRY_INTERVAL_MS = 50;

class Client extends Emitter<ClientEvents> {
	public raknet: RaknetClient | WorkerClient;
	public options: ClientOptions;
	private startGamePacket?: StartGamePacket;
	private status: Status;
	public _encryptionEnabled: boolean;
	public _compressionEnabled: boolean;
	private packetCompressor!: PacketCompressor;
	public protocol: ProtocolList;
	public profile!: Profile;
	public data: ClientData;
	public username!: string;
	public sessionReady: boolean;
	public secretKeyBytes!: Buffer;
	public iv!: Buffer;
	public packetEncryptor!: PacketEncryptor;
	public runtimeEntityId!: bigint;
	public cancelPastLogin: boolean;

	constructor(options: Partial<ClientOptions>) {
		super();
		this.options = { ...defaultClientOptions, ...options };
		this.status = Status.Disconnected;
		this.protocol = ProtocolList[this.options.version];

		this.raknet = this.options.worker
			? new WorkerClient({
					address: this.options.host,
					port: this.options.port,
				})
			: new RaknetClient({
					address: this.options.host,
					port: this.options.port,
				});

		this.sessionReady = false;
		this._encryptionEnabled = false;
		this._compressionEnabled = false;
		this.cancelPastLogin = false;

		this.data = new ClientData(this);
		this.once("session", () => {
			this.sessionReady = true;
		});
		this.initializeSession();
	}

	private initializeSession(): void {
		this.options.offline ? createOfflineSession(this) : authenticate(this);
	}

	public async connect(): Promise<[Advertisement, StartGamePacket]> {
		await this.waitForSessionReady();

		this.status = Status.Connecting;
		this.packetCompressor = new PacketCompressor(this);
		this.setupEventListeners();

		const advertisement = await this.raknet.connect();
		this.raknet.on("encapsulated", this.handleEncapsulated.bind(this));

		return this.waitForConnection(advertisement);
	}

	private async waitForSessionReady(): Promise<void> {
		while (!this.sessionReady) {
			await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
		}
	}

	private async waitForConnection(
		advertisement: Advertisement,
	): Promise<[Advertisement, StartGamePacket]> {
		return new Promise((resolve, reject) => {
			this.once("StartGamePacket", this.handleStartGamePacket.bind(this));
			this.once("SetLocalPlayerAsInitializedPacket", () => {
				this.status = Status.Connected;
			});

			const interval = setInterval(() => {
				if (
					this.status === Status.Connected &&
					this.startGamePacket &&
					this.sessionReady
				) {
					clearInterval(interval);
					this.emit("connect", advertisement);
					resolve([advertisement, this.startGamePacket]);
				}
			}, CONNECTION_CHECK_INTERVAL_MS);
		});
	}

	private handleStartGamePacket(packet: StartGamePacket): void {
		this.startGamePacket = packet;
		this.runtimeEntityId = packet.runtimeEntityId;
		if (this.cancelPastLogin) return;

		this.requestChunkRadius();
	}

	private requestChunkRadius(): void {
		const radius = new RequestChunkRadiusPacket();
		radius.radius = this.options.viewDistance;
		radius.maxRadius = this.options.viewDistance;
		this.send(radius);
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

	private sendPacket(
		packet: DataPacket | Buffer,
		priority: Priority = Priority.Normal,
	): void {
		try {
			if (this.status === Status.Disconnected) return;

			const serialized =
				packet instanceof DataPacket ? packet.serialize() : packet;
			const compressed = this.packetCompressor.compress(
				serialized,
				this.options.compressionMethod,
			);

			const frame = new Frame();
			frame.orderChannel = 0;
			frame.payload = compressed;
			this.raknet.sendFrame(frame, priority);
		} catch (error) {
			Logger.error(
				`Failed to send packet ${packet instanceof DataPacket ? packet.constructor.name : "Buffer"}`,
				error,
			);
		}
	}

	public send(packet: DataPacket | Buffer): void {
		this.sendPacket(packet, Priority.Immediate);
	}

	public queue(packet: DataPacket | Buffer): void {
		Logger.debug(
			`Queueing packet ${packet instanceof DataPacket ? packet.constructor.name : "Buffer"}`,
		);
		this.sendPacket(packet, Priority.Normal);
	}

	/** Already decompressed packets */
	public processPacket(buffer: Buffer): void {
		const id = getPacketId(buffer);
		const PacketClass = Packets[id];

		try {
			if (!PacketClass || !PacketClass.name) {
				Logger.warn(`Unknown Game packet ${id}`);
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

	private setupEventListeners(): void {
		this.setupConnectionListeners();
		this.setupPacketListeners();
	}

	private setupConnectionListeners(): void {
		this.raknet.once("connect", this.handleRaknetConnect.bind(this));
		this.raknet.on("close", () => this.disconnect());
	}

	private handleRaknetConnect(): void {
		const timer = setInterval(() => {
			if (!this.sessionReady) return;

			const request = new RequestNetworkSettingsPacket();
			request.protocol = this.protocol;
			this.send(request);
			clearInterval(timer);
		}, NETWORK_SETTINGS_RETRY_INTERVAL_MS);
	}

	private setupPacketListeners(): void {
		this.once(
			"NetworkSettingsPacket",
			this.handleNetworkSettingsPacket.bind(this),
		);
		this.once(
			"ServerToClientHandshakePacket",
			this.handleServerHandshake.bind(this),
		);
		this.once(
			"ResourcePacksInfoPacket",
			this.handleResourcePacksInfoPacket.bind(this),
		);
		this.on("PlayStatusPacket", this.handlePlayStatusPacket.bind(this));
	}

	private handleNetworkSettingsPacket(packet: {
		compressionMethod: number;
		compressionThreshold: number;
	}): void {
		this._compressionEnabled = true;
		this.options.compressionMethod = this.packetCompressor.getMethod(
			packet.compressionMethod,
		);
		this.options.compressionThreshold = packet.compressionThreshold;

		const loginPacket = this.data.createLoginPacket();
		this.send(loginPacket);
	}

	private handleServerHandshake(packet: { token: string }): void {
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

		this.data.sharedSecret = this.data.createSharedSecret(
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
	}

	private handlePlayStatusPacket(packet: PlayStatusPacket): void {
		if (packet.status === PlayStatus.LoginSuccess) {
		}

		if (packet.status === PlayStatus.PlayerSpawn && !this.cancelPastLogin) {
			this.completePlayerSpawn();
		}
	}

	private completePlayerSpawn(): void {
		const init = new SetLocalPlayerAsInitializedPacket();
		init.runtimeEntityId = this.runtimeEntityId;

		const serverBoundLoadingScreen = new ServerboundLoadingScreenPacketPacket();
		serverBoundLoadingScreen.type =
			ServerboundLoadingScreenType.EndLoadingScreen;
		serverBoundLoadingScreen.hasScreenId = false;

		this.send(init);
		this.send(serverBoundLoadingScreen);
		this.emit("SetLocalPlayerAsInitializedPacket", init);
	}

	private handleResourcePacksInfoPacket(
		packet: ResourcePacksInfoPacket | ResourcePackStackPacket,
	): void {
		if (this.cancelPastLogin) return;

		const response = new ResourcePackClientResponsePacket();
		response.packs = [];
		response.response = ResourcePackResponse.Completed;
		this.send(response);

		if (packet instanceof ResourcePacksInfoPacket) {
			const packet = new ClientCacheStatusPacket();
			packet.enabled = false;
			this.send(packet);
		}
	}

	public startEncryption(iv: Buffer): void {
		this.packetEncryptor = new PacketEncryptor(this, iv);
		this._encryptionEnabled = true;
	}

	public disconnect(): void {
		if (this.status === Status.Disconnected) return;

		this.status = Status.Disconnected;
		try {
			this.cleanup();
		} catch (error) {
			Logger.error("Error during disconnect:", error);
		}
	}

	private cleanup(): void {
		this.removeAllListeners();
		this.destroy();

		if (this.raknet) {
			this.raknet.disconnect();
		}

		if (this.packetEncryptor) {
			this.packetEncryptor.destroy();
			this._encryptionEnabled = false;
		}

		Logger.cleanup();
	}

	public sendMessage(text: string): void {
		const textPacket = new TextPacket();
		textPacket.filtered = "";
		textPacket.message = text.replace(/^\s+/, "");
		textPacket.needsTranslation = false;
		textPacket.parameters = [];
		textPacket.platformChatId = "";
		textPacket.source = this.profile.name;
		textPacket.type = TextPacketType.Chat;
		textPacket.xuid = "";
		this.sendPacket(textPacket, Priority.Normal);
	}
}

export { Client };
