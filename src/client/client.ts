import {
	ClientCacheStatusPacket,
	ClientToServerHandshakePacket,
	ResourcePackClientResponsePacket,
	ResourcePackResponse,
	getPacketId,
	Packets,
	ResourcePacksInfoPacket,
	type StartGamePacket,
	DataPacket,
	PlayStatus,
	SetLocalPlayerAsInitializedPacket,
	ServerboundLoadingScreenPacketPacket,
	ServerboundLoadingScreenType,
	RequestNetworkSettingsPacket,
	RequestChunkRadiusPacket,
} from "@serenityjs/protocol";
import {
	type Profile,
	Emitter,
	createOfflineSession,
	authenticate,
	PacketCompressor,
	PacketEncryptor,
	ProtocolList,
	CurrentVersionConst,
} from "../";
import {
	ClientData,
	type ClientEvents,
	type ClientOptions,
	defaultClientOptions,
	type PacketNames,
	WorkerClient,
} from "./";
import {
	type Advertisement,
	Frame,
	Logger,
	Priority,
	Client as RaknetClient,
	Status,
} from "@sanctumterra/raknet";
import { createHash, createPublicKey } from "node:crypto";

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
	status: Status;
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
		this.status = Status.Disconnected;
		/** worker or not. */
		this.raknet = this.options.worker
			? new WorkerClient({
					address: this.options.address,
					port: this.options.port,
				})
			: new RaknetClient({
					address: this.options.address,
					port: this.options.port,
				});
		/** Create ClientData to store and handle auth data */
		this.data = new ClientData(this);
		const time = Date.now();

		/** Session event gets mojang (minecraft) auth session */
		/** NOTE! This takes like 30-100ms for offline mode which kinda feels slow but not really */
		this.once("session", () => {
			this.sessionReady = true;
		});
		this.options.offline ? createOfflineSession(this) : authenticate(this);
	}

	/** Connect to the server and start sending/receiving packets. */
	async connect(): Promise<[Advertisement, StartGamePacket]> {
		const advertisement = await this.raknet.connect();
		this.status = Status.Connecting;
		this.packetCompressor = new PacketCompressor(this);
		this.handleGamePackets();

		this.raknet.on("encapsulated", this.handleEncapsulated.bind(this));
		const request = new RequestNetworkSettingsPacket();
		request.protocol = ProtocolList[CurrentVersionConst];
		this.send(request);

		return new Promise((resolve, rejevt) => {
			this.once("SetLocalPlayerAsInitializedPacket", (packet) => {
				resolve([advertisement, this.startGameData]);
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
	/** Do not call this, leaving it public incase someone needs to override this for some reason. */
	public handleGamePackets() {
		this.once("NetworkSettingsPacket", async (packet) => {
			this._compressionEnabled = true;
			this.options.compressionMethod = this.packetCompressor.getMethod(
				packet.compressionMethod,
			);
			this.options.compressionThreshold = packet.compressionThreshold;
			await this.waitForSessionReady();
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
			response.packs = packet.packs.map((p) => p.uuid); // Im not sure if we send pack uuids or subpack names
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
			response.packs = packet.texturePacks.map((p) => p.name); // Im not sure if we send pack uuids or subpack names
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

				this.send(init);
				this.send(serverBoundLoadingScreen);
				this.emit("SetLocalPlayerAsInitializedPacket", init);
			}
		});
		this.on("DisconnectPacket", (packet) => {
			this.status = Status.Disconnected;
			this.raknet.disconnect();
			console.log(packet.message);
		});
	}

	public startEncryption(iv: Buffer): void {
		this.packetEncryptor = new PacketEncryptor(this, iv);
		this._encryptionEnabled = true;
	}

	private async waitForSessionReady(): Promise<void> {
		while (!this.sessionReady) {
			await new Promise((resolve) => setTimeout(resolve, 50));
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
}
