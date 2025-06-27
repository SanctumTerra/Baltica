import { createHash, createPublicKey, diffieHellman } from "node:crypto";
import {
	Frame,
	Logger,
	Priority,
	Connection as RakConnection,
	Status,
} from "@sanctumterra/raknet";
import {
	ClientCacheStatusPacket,
	CompressionMethod,
	DataPacket,
	DisconnectMessage,
	DisconnectPacket,
	DisconnectReason,
	NetworkSettingsPacket,
	Packets,
	PlayStatus,
	PlayStatusPacket,
	ResourcePackStackPacket,
	ResourcePacksInfoPacket,
	ServerToClientHandshakePacket,
	getPacketId,
} from "@serenityjs/protocol";
import {
	type ClientOptions,
	type PacketNames,
	ProtocolList,
	defaultClientOptions,
} from "../client";
import { ClientData } from "../client/client-data";
import type { Payload } from "../client/types";
import { Emitter } from "../libs";
import { PacketCompressor, type Profile, decodeLoginJWT } from "../network";
import { PacketEncryptor } from "../network/packet-encryptor";
import type { Server } from "./server";
import type { PlayerEvents } from "./server-options";
import * as jose from "jose";

const SALT = "🧂";
const SALT_BUFFER = Buffer.from(SALT);
const PLAY_STATUS_LOGIN_SUCCESS = new PlayStatusPacket();
PLAY_STATUS_LOGIN_SUCCESS.status = PlayStatus.LoginSuccess;
const PLAY_STATUS_LOGIN_SUCCESS_BUFFER = PLAY_STATUS_LOGIN_SUCCESS.serialize();

class Player extends Emitter<PlayerEvents> {
	private static readonly PACKET_CACHE_STATUS_ID = 0x81;
	private static readonly DEFAULT_NETWORK_SETTINGS = (() => {
		const settings = new NetworkSettingsPacket();
		settings.clientScalar = 0;
		settings.clientThrottle = false;
		settings.clientThreshold = 0;
		return settings;
	})();

	public server: Server;
	public data: ClientData;
	public profile!: Profile;
	public options: ClientOptions;
	public connection: RakConnection;
	public iv!: Buffer;
	public secretKeyBytes!: Buffer;
	public packetCompressor: PacketCompressor;
	public packetEncryptor!: PacketEncryptor;
	public protocol: number;
	public _encryptionEnabled = false;
	public _compressionEnabled = false;
	private preSerializedPackets = new Map<unknown, Buffer>();
	public status: Status = Status.Disconnected;

	constructor(server: Server, connection: RakConnection) {
		super();
		this.options = defaultClientOptions;
		this.server = server;
		this.data = new ClientData(this);
		this.connection = connection;
		this.packetCompressor = new PacketCompressor(this);
		this.protocol = ProtocolList[this.server.options.version as "1.21.50"];
		this.prepare();
		this.initializeStaticPackets();
	}

	private initializeStaticPackets() {
		const settings = Player.DEFAULT_NETWORK_SETTINGS;
		settings.compressionThreshold = this.server.options.compressionThreshold;
		settings.compressionMethod = this.server.options.compressionMethod;
		this.preSerializedPackets.set(NetworkSettingsPacket, settings.serialize());
	}

	private prepare() {
		if (!(this.connection instanceof RakConnection))
			throw new Error("Connection is not instance of RakConnection");

		this.connection.on("encapsulated", this.handle.bind(this));
		this.connection.on("disconnect", () => this.server.onDisconnect(this));
		this.once("SetLocalPlayerAsInitializedPacket", () => {
			this.status = Status.Connected;
		});
		this.once("RequestNetworkSettingsPacket", () => {
			this.status = Status.Connecting;
			const preSerialized = this.preSerializedPackets.get(
				NetworkSettingsPacket,
			);
			if (preSerialized) {
				this.send(preSerialized);
			} else {
				const settings = Player.DEFAULT_NETWORK_SETTINGS;
				settings.compressionThreshold =
					this.server.options.compressionThreshold;
				settings.compressionMethod = this.server.options.compressionMethod;
				this.send(settings);
			}

			this._compressionEnabled = true;
			this.options.compressionMethod = this.server.options.compressionMethod;
			this.options.compressionLevel = this.server.options.compressionLevel;
			this.options.compressionThreshold =
				this.server.options.compressionThreshold;
		});

		this.once("LoginPacket", async (packet) => {
			try {
			const { key, data, skin } = await decodeLoginJWT(
				packet.tokens,
				this.server.options.version,
			);
			const extraData = (data as { extraData: object }).extraData as {
				displayName: string;
				identity: string;
				XUID: number;
				titleid: string;
				sandboxId: string;
			};

			this.profile = {
				name: extraData.displayName,
				uuid: extraData.identity,
				xuid: extraData.XUID,
			};

			this.data.payload = skin as Payload;

			const pubKeyDer = createPublicKey({
				key: Buffer.from(key, "base64"),
				format: "der",
				type: "spki",
			});

			this.data.sharedSecret = this.data.createSharedSecret(
				this.data.loginData.ecdhKeyPair.privateKey,
				pubKeyDer,
			);

			const secretHash = createHash("sha256")
				.update(SALT_BUFFER)
				.update(this.data.sharedSecret);
			this.secretKeyBytes = secretHash.digest();
			this.iv = this.secretKeyBytes.slice(0, 16);

			const privateKey = await jose.importPKCS8(
				this.data.loginData.ecdhKeyPair.privateKey.export({
					format: "pem",
					type: "pkcs8",
				}) as string,
				"ES384",
			);

			const token = await new jose.SignJWT({
				salt: SALT_BUFFER.toString("base64"),
				signedToken: this.data.loginData.clientX509,
			})
				.setProtectedHeader({
					alg: "ES384",
					x5u: this.data.loginData.clientX509,
				})
				.sign(privateKey);

			const handshake = new ServerToClientHandshakePacket();
			handshake.token = token;
			this.send(handshake);

			this.startEncryption(this.iv);

			this.emit("login");
			Logger.debug(`Enabling Encryption for ${this.profile.name}`);
			} catch (error) {
				Logger.error(`Error decoding login JWT: ${error}`);
				this.sendDisconnectMessage("Version mismatch, please update your client!");
			}
		});

		this.once("ClientToServerHandshakePacket", () => {
			this.send(PLAY_STATUS_LOGIN_SUCCESS_BUFFER);
		});
	}

	public startEncryption(iv: Buffer) {
		if (!this.packetEncryptor) {
			this.packetEncryptor = new PacketEncryptor(this, iv);
			this._encryptionEnabled = true;
		}
	}

	public sendDisconnectMessage(message: string){
		const disconnect = new DisconnectPacket();
		disconnect.hideDisconnectScreen = false;
		disconnect.message = new DisconnectMessage(message, message);
		disconnect.reason = DisconnectReason.VersionMismatch;
		this.sendPacket(disconnect, Priority.Immediate);
	}

	public sendPacket(
		packet: DataPacket | Buffer,
		priority: Priority = Priority.Normal,
	) {
		if (this.status === Status.Disconnected) return;
		let serialized: Buffer;
		if (packet instanceof DataPacket) {
			const preSerialized = this.preSerializedPackets.get(packet.constructor);
			serialized = preSerialized || packet.serialize();
		} else {
			serialized = packet;
		}

		const compressed = this.packetCompressor.compress(
			serialized,
			this.options.compressionMethod,
		);

		const frame = new Frame();
		frame.orderChannel = 0;
		frame.payload = compressed;
		this.connection.sendFrame(frame, priority);
	}

	public send(packet: DataPacket | Buffer) {
		this.sendPacket(packet, Priority.Immediate);
	}

	public queue(packet: DataPacket | Buffer) {
		this.sendPacket(packet, Priority.Normal);
	}

	public processPacket(packet: Buffer) {
		const id = packet.readUInt8(0);
		if (id === Player.PACKET_CACHE_STATUS_ID) {
			Logger.debug("Received ClientCacheStatusPacket");
			const instance = new ClientCacheStatusPacket(packet);
			instance.deserialize();
			this.emit("ClientCacheStatusPacket", instance);
			return;
		}

		// @ts-ignore
		const PacketClass = Packets[id];
		if (!PacketClass) {
			Logger.debug(`Received Unknown Packet: ${id}`);
			return;
		}

		const instance = new PacketClass(packet);
		instance.deserialize();

		if (this.hasListeners("packet")) {
			this.emit("packet", instance);
		}
		this.emit(PacketClass.name as PacketNames, instance);
	}

	public async handle(packet: Buffer) {
		const packets = await this.packetCompressor.decompress(packet);
		let i = 0;
		while (i < packets.length) {
			this.processPacket(packets[i]);
			i++;
		}
	}
}

export { Player };
