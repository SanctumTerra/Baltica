import { createHash, createPublicKey, diffieHellman } from "node:crypto";
import {
	Frame,
	Logger,
	Priority,
	Connection as RakConnection,
} from "@sanctumterra/raknet";
import {
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
import { sign } from "jsonwebtoken";
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
import { ClientCacheStatusPacket } from "../network/client-cache-status";
import { PacketEncryptor } from "../network/packet-encryptor";
import type { Server } from "./server";
import type { PlayerEvents } from "./server-options";

const SALT = "🧂";
const SALT_BUFFER = Buffer.from(SALT);
const PLAY_STATUS_LOGIN_SUCCESS = new PlayStatusPacket();
PLAY_STATUS_LOGIN_SUCCESS.status = PlayStatus.LoginSuccess;
const PLAY_STATUS_LOGIN_SUCCESS_BUFFER = PLAY_STATUS_LOGIN_SUCCESS.serialize();

class Player extends Emitter<PlayerEvents> {
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
		const settings = new NetworkSettingsPacket();
		const options = this.server.options;
		settings.compressionThreshold = options.compressionThreshold;
		settings.compressionMethod = options.compressionMethod;
		settings.clientScalar = 0;
		settings.clientThrottle = false;
		settings.clientThreshold = 0;
		this.preSerializedPackets.set(NetworkSettingsPacket, settings.serialize());
	}

	private prepare() {
		if (!(this.connection instanceof RakConnection))
			throw new Error("Connection is not instance of RakConnection");

		this.connection.on("encapsulated", this.handle.bind(this));
		this.connection.on("disconnect", () => this.server.onDisconnect(this));

		this.once("RequestNetworkSettingsPacket", () => {
			const preSerialized = this.preSerializedPackets.get(
				NetworkSettingsPacket,
			);
			if (preSerialized) {
				this.send(preSerialized);
			} else {
				const settings = new NetworkSettingsPacket();
				settings.compressionThreshold =
					this.server.options.compressionThreshold;
				settings.compressionMethod = this.server.options.compressionMethod;
				settings.clientScalar = 0;
				settings.clientThrottle = false;
				settings.clientThreshold = 0;
				this.send(settings);
			}

			this._compressionEnabled = true;
			this.options.compressionMethod = this.server.options.compressionMethod;
			this.options.compressionLevel = this.server.options.compressionLevel;
			this.options.compressionThreshold =
				this.server.options.compressionThreshold;
		});

		this.once("LoginPacket", (packet) => {
			const { key, data, skin } = decodeLoginJWT(packet.tokens);
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

			// @ts-ignore
			const token = sign(
				{
					salt: SALT_BUFFER.toString("base64"),
					signedToken: this.data.loginData.clientX509,
				},
				this.data.loginData.ecdhKeyPair.privateKey,
				{
					algorithm: "ES384",
					header: { x5u: this.data.loginData.clientX509 },
				},
			);

			const handshake = new ServerToClientHandshakePacket();
			handshake.token = token;
			this.send(handshake);

			const iv = this.secretKeyBytes.slice(0, 16);
			this.iv = iv;
			this.startEncryption(iv);

			this.emit("login");
			Logger.debug(`Enabling Encryption for ${this.profile.name}`);
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

	public sendPacket(
		packet: DataPacket | Buffer,
		priority: Priority = Priority.Normal,
	) {
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
		if (id === 0x81) {
			// 0x81 is hex for 129
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
		this.emit(PacketClass.name as PacketNames, instance);

		if (this.hasListeners("packet")) {
			this.emit("packet", instance);
		}
	}

	public handle(packet: Buffer) {
		const packets = this.packetCompressor.decompress(packet);
		let i = 0;
		while (i < packets.length) {
			this.processPacket(packets[i]);
			i++;
		}
	}
}

export { Player };
