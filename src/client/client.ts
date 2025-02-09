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
import { ClientCacheStatusPacket } from "../network/client-cache-status";
import { LevelChunkPacket } from "../network/level-chunk-packet";
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
import { AddPaintingPacket } from "../network/packets";
import DisconnectionNotification from "@sanctumterra/raknet/dist/proto/packets/disconnect";

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
		this.once("session", this.handleSession.bind(this));
		this.options.offline ? createOfflineSession(this) : authenticate(this);
	}

	public async connect(): Promise<[Advertisement, StartGamePacket]> {
		while (!this.sessionReady) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		this.status = Status.Connecting;
		this.packetCompressor = new PacketCompressor(this);
		this.listen();
		const advertisement = await this.raknet.connect();
		this.raknet.on("encapsulated", this.handleEncapsulated.bind(this));

		return new Promise((resolve, reject) => {
			this.once("StartGamePacket", this.handleStartGamePacket.bind(this));
			this.once(
				"SetLocalPlayerAsInitializedPacket",
				this.handleSetLocalPlayerAsInitializedPacket.bind(this),
			);
			this.once("AvailableCommandsPacket", () => {});
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
			}, 50);
		});
	}

	private handleStartGamePacket(packet: StartGamePacket): void {
		this.startGamePacket = packet;
		this.runtimeEntityId = packet.runtimeEntityId;
		if (this.cancelPastLogin) return;
		const radius = new RequestChunkRadiusPacket();
		radius.radius = this.options.viewDistance;
		radius.maxRadius = this.options.viewDistance;
		this.send(radius);
	}

	private handleSetLocalPlayerAsInitializedPacket(
		packet: SetLocalPlayerAsInitializedPacket,
	): void {
		this.status = Status.Connected;
	}

	private handleEncapsulated(buffer: Buffer) {
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
	) {
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
			Logger.error(`Failed to send packet ${packet.constructor.name}`, error);
		}
	}

	public send(packet: DataPacket | Buffer) {
		this.sendPacket(packet, Priority.Immediate);
	}

	public queue(packet: DataPacket | Buffer) {
		Logger.debug(`Queueing packet ${packet.constructor.name}`);
		this.sendPacket(packet, Priority.Normal);
	}

	/** Already decompressed packets */
	public processPacket(buffer: Buffer) {
		const id = getPacketId(buffer);
		let PacketClass = Packets[id];
		try {
			if (id === Packet.LevelChunk) {
				PacketClass = LevelChunkPacket;
			}
			if ((id as number) === 22) {
				PacketClass = AddPaintingPacket;
			}
			if (!Packets && !Packets[id])
				return Logger.warn(`Unknown Game packet ${id}`);

			// console.log('X - ', PacketClass.name, readPacket(this.options.version, buffer));

			let deserializedPacket: DataPacket | undefined;
			const hasSpecificListener = this.hasListeners(
				PacketClass.name as PacketNames,
			);
			const hasGenericListener = this.hasListeners("packet");

			if (hasSpecificListener || hasGenericListener) {
				deserializedPacket = new PacketClass(buffer).deserialize();

				if (hasSpecificListener) {
					this.emit(PacketClass.name as PacketNames, deserializedPacket);
				}

				if (hasGenericListener) {
					this.emit("packet", deserializedPacket);
				}
			}
		} catch (error) {
			Logger.error(`Failed to process packet ${PacketClass.name}`, error);
		}
	}

	private handleSession(): void {
		this.sessionReady = true;
	}

	public listen() {
		this.raknet.once("connect", () => {
			const timer = setInterval(() => {
				if (this.sessionReady) {
					const request = new RequestNetworkSettingsPacket();
					request.protocol = this.protocol;
					this.send(request);
					clearInterval(timer);
				}
			}, 50);
		});

		this.once("NetworkSettingsPacket", (packet) => {
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
				.map((k: unknown) => Buffer.from(k as string, "base64"));
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
		});

		this.once(
			"ResourcePacksInfoPacket",
			this.handleResourcePacksInfoPacket.bind(this),
		);
		// this.once("ResourcePackStackPacket", this.handleResourcePacksInfoPacket.bind(this));
		this.on("PlayStatusPacket", this.handlePlayStatusPacket.bind(this));
	}

	private handlePlayStatusPacket(packet: PlayStatusPacket) {
		if (packet.status === PlayStatus.LoginSuccess) {
		}
		if (packet.status === PlayStatus.PlayerSpawn) {
			if (this.cancelPastLogin) return;
			const init = new SetLocalPlayerAsInitializedPacket();
			init.runtimeEntityId = this.runtimeEntityId;

			const ServerBoundLoadingScreen =
				new ServerboundLoadingScreenPacketPacket();
			ServerBoundLoadingScreen.type =
				ServerboundLoadingScreenType.EndLoadingScreen;
			ServerBoundLoadingScreen.hasScreenId = false;
			this.send(init);
			this.emit("SetLocalPlayerAsInitializedPacket", init);
		}
	}

	private handleResourcePacksInfoPacket(
		packet: ResourcePacksInfoPacket | ResourcePackStackPacket,
	) {
		if (this.cancelPastLogin) return;
		const response = new ResourcePackClientResponsePacket();
		response.packs = [];
		response.response = ResourcePackResponse.Completed;
		this.send(response);

		if (packet instanceof ResourcePacksInfoPacket) {
			this.send(ClientCacheStatusPacket.create(false));
		}
	}

	public startEncryption(iv: Buffer) {
		this.packetEncryptor = new PacketEncryptor(this, iv);
		this._encryptionEnabled = true;
	}

	public disconnect() {
		const rakDisconnect = new DisconnectionNotification();
		const frame = new Frame();
		frame.orderChannel = 0;
		frame.payload = rakDisconnect.serialize();
		this.raknet.sendFrame(frame, Priority.Immediate);
		this.status = Status.Disconnected;

		this.removeAllListeners();
		this.raknet.cleanup();
		if (this.raknet instanceof RaknetClient) {
			this.raknet.removeAll();
			this.raknet.removeAllAfter();
			this.raknet.removeAllBefore();
		} else {
			this.raknet.dispose();
		}
		return;
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
