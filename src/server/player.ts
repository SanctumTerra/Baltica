import {
	type Connection,
	Frame,
	Logger,
	Priority,
	ConnectionStatus,
} from "@sanctumterra/raknet";
import {
	DataPacket,
	getPacketId,
	NetworkSettingsPacket,
	Packets,
	PacketViolationWarningPacket,
	PlayStatus,
	PlayStatusPacket,
	ServerToClientHandshakePacket,
} from "@serenityjs/protocol";
import * as jose from "jose";
import { createHash, createPublicKey } from "node:crypto";
import {
	ClientData,
	type ClientOptions,
	defaultClientOptions,
	type LoginData,
	type PacketNames,
	type Payload,
	prepareLoginData,
} from "../client/types";
import { PacketCompressor, PacketEncryptor } from "../shared";
import { CurrentVersionConst } from "../shared/types";
import type { Server } from "./server";
import type { PlayerEvents } from "./types";
import { decodeLoginJWT, Emitter } from "../shared";

/**
 * Note: The salt has to be same as for the client, otherwise authentication will fail.
 * It is currently "🧂" (U+1F9C2) for both Bedrock Dedicated Server and the official client.
 */
const SALT = "🧂";
const SALT_BUFFER = Buffer.from(SALT);

/**
 * Player class represents a connected player on the server.
 * It handles packet processing, encryption, and communication with the client.
 */
export class Player extends Emitter<PlayerEvents> {
	packetCompressor!: PacketCompressor;
	packetEncryptor!: PacketEncryptor;
	_compressionEnabled: boolean;
	_encryptionEnabled: boolean;
	iv!: Buffer;
	secretKeyBytes!: Buffer;
	status: ConnectionStatus = ConnectionStatus.Disconnected;
	loginData!: LoginData;
	sharedSecret!: Buffer;

	server: Server;
	connection: Connection;
	options: ClientOptions;
	username!: string;
	xuid!: string;
	loginPayload!: Payload;

	constructor(server: Server, connection: Connection) {
		super();
		this.connection = connection;
		this.server = server;
		this.options = defaultClientOptions;
		this._compressionEnabled = false;
		this._encryptionEnabled = false;
		this.options.compressionMethod = this.server.options.compressionMethod;
		this.options.compressionThreshold =
			this.server.options.compressionThreshold;
		this.prepare();
	}

	public processPacket(buffer: Buffer) {
		if (buffer.length < 1) return;
		const id = getPacketId(buffer);
		const PacketClass = Packets[id];

		try {
			if (!PacketClass) {
				Logger.debug(`Received Unknown Packet: ${id}`);
				return;
			}

			const instance = new PacketClass(buffer);
			instance.deserialize();

			/** For debugging or etc, incase one needs a list of packets or their data. */
			if (this.hasListeners("packet")) {
				this.emit("packet", instance);
			}

			/** We emit all packets as classes from SerenityJS Protocol */
			this.emit(PacketClass.name as PacketNames, instance);
		} catch (error) {
			Logger.error(
				`Received an Error while deserializing packet ${PacketClass ?? id}`,
			);
			Logger.error(error as Error);
		}
	}

	public onEncapsulated(buffer: Buffer) {
		const decompressed = this.packetCompressor.decompress(buffer);
		for (const packet of decompressed) {
			this.processPacket(packet);
		}
	}

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

			const frame = new Frame();
			frame.orderChannel = 0;
			frame.payload = compressed;
			this.connection.sendFrame(frame, priority);
		} catch (error) {
			Logger.error(
				`Failed to send packet ${packet instanceof DataPacket ? packet.constructor.name : "Buffer"}`,
				error,
			);
		}
	}

	/**
	 * Sends a packet to the client with High priority.
	 */
	public send(packet: DataPacket | Buffer): void {
		this.sendPacket(packet, Priority.High);
	}

	/**
	 * Sends a packet to the client with Medium priority.
	 *
	 * Aka "queueing" the packet.
	 */
	public queue(packet: DataPacket | Buffer): void {
		Logger.debug(
			`Queueing packet ${packet instanceof DataPacket ? packet.constructor.name : "Buffer"}`,
		);
		this.sendPacket(packet, Priority.Medium);
	}
	/**
	 *  Starts encryption for the connection using the provided IV.
	 *  If encryption is already enabled, it will not reinitialize it.
	 *  If you do not know what you are doing, do not call this method manually.
	 */
	public startEncryption(iv: Buffer) {
		if (!this.packetEncryptor) {
			this.packetEncryptor = new PacketEncryptor(this, iv);
			this._encryptionEnabled = true;
		}
	}

	public prepare() {
		this.loginData = prepareLoginData();
		this.packetCompressor = new PacketCompressor(this);
		// this.packetEncryptor = new PacketEncryptor(this);
		this.connection.on("encapsulated", this.onEncapsulated.bind(this));
		this.on("RequestNetworkSettingsPacket", (packet) => {
			this.status = ConnectionStatus.Connecting;
			const settings = new NetworkSettingsPacket();
			settings.compressionThreshold = this.server.options.compressionThreshold;
			settings.clientScalar = 0;
			settings.clientThreshold = 0;
			settings.clientThrottle = false;
			settings.compressionMethod = this.server.options.compressionMethod;
			this.send(settings);
			this._compressionEnabled = true;
		});

		this.on("LoginPacket", async (packet) => {
			// TODO! Verify JWT.

			const { key, data, skin } = await decodeLoginJWT(
				packet.tokens,
				CurrentVersionConst,
			);
			if (data === null) {
				return;
			}

			const extraData = (data as { extraData: object }).extraData as {
				displayName: string;
				identity: string;
				XUID: number;
				titleid: string;
				sandboxId: string;
			};
			this.username = extraData.displayName;

			this.loginPayload = skin as Payload;

			const pubKeyDer = createPublicKey({
				key: Buffer.from(key, "base64"),
				format: "der",
				type: "spki",
			});
			this.sharedSecret = ClientData.createSharedSecret(
				this.loginData.ecdhKeyPair.privateKey,
				pubKeyDer,
			);

			const secretHash = createHash("sha256")
				.update(SALT_BUFFER)
				.update(this.sharedSecret);
			this.secretKeyBytes = secretHash.digest();
			this.iv = this.secretKeyBytes.slice(0, 16);

			const privateKey = await jose.importPKCS8(
				this.loginData.ecdhKeyPair.privateKey.export({
					format: "pem",
					type: "pkcs8",
				}) as string,
				"ES384",
			);

			const token = await new jose.SignJWT({
				salt: SALT_BUFFER.toString("base64"),
				signedToken: this.loginData.clientX509,
			})
				.setProtectedHeader({
					alg: "ES384",
					x5u: this.loginData.clientX509,
				})
				.sign(privateKey);

			const handshake = new ServerToClientHandshakePacket();
			handshake.token = token;
			this.send(handshake);

			this.startEncryption(this.iv);
			this.emit("login");
		});

		this.on("ClientToServerHandshakePacket", () => {
			const status = new PlayStatusPacket();
			status.status = PlayStatus.LoginSuccess;
			this.send(status);
		});
	}
}
