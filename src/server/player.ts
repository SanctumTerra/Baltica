import {
    CompressionMethod,
    DataPacket,
	DisconnectMessage,
	DisconnectPacket,
	DisconnectReason,
	getPacketId,
	NetworkSettingsPacket,
	Packets,
	PlayStatus,
	PlayStatusPacket,
	ResourcePacksInfoPacket,
	ResourcePackStackPacket,
	ServerToClientHandshakePacket,
} from "@serenityjs/protocol";
import { ClientData } from "../client/client-data";
import { Frame, Logger, Priority, Connection as RakConnection } from "@sanctumterra/raknet";
import { createHash, createPublicKey, diffieHellman } from "node:crypto";
import { sign } from "jsonwebtoken";
import { decodeLoginJWT, PacketCompressor, type Profile } from "../network";
import type { Server } from "./server";
import { Emitter } from "../libs";
import { type ClientOptions, defaultClientOptions, type PacketNames, ProtocolList } from "../client";
import type { PlayerEvents } from "./server-options";
import type { Payload } from "../client/types";
import { PacketEncryptor } from "../network/packet-encryptor";
import { ClientCacheStatusPacket } from "../network/client-cache-status";

const SALT = "🧂";
const SALT_BUFFER = Buffer.from(SALT);

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


	constructor(server: Server, connection: RakConnection) {
		super();
        this.options = defaultClientOptions;
		this.server = server;
		this.data = new ClientData(this);
		this.connection = connection;
        this.packetCompressor = new PacketCompressor(this);
        this.protocol = ProtocolList[this.server.options.version as "1.21.50"];
        this.prepare();
	}

	private prepare() {
		if (!(this.connection instanceof RakConnection))
			throw new Error("Connection is not instance of RakConnection");

		this.connection.on("encapsulated", this.handle.bind(this));
		this.connection.on("disconnect", () => this.server.onDisconnect(this));

		this.once("RequestNetworkSettingsPacket", (packet) => {
			const settings = new NetworkSettingsPacket();
			const options = this.server.options;

			settings.compressionThreshold = options.compressionThreshold;
			settings.compressionMethod = options.compressionMethod;
			settings.clientScalar = 0;
			settings.clientThrottle = false;
			settings.clientThreshold = 0;
			
			this.send(settings);

			this._compressionEnabled = true;
			this.options.compressionMethod = options.compressionMethod;
			this.options.compressionLevel = options.compressionLevel;
			this.options.compressionThreshold = options.compressionThreshold;
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
			const playStatus = new PlayStatusPacket();
			playStatus.status = PlayStatus.LoginSuccess;
			this.send(playStatus);
		});
	}

    public startEncryption(iv: Buffer) {
        if (!this.packetEncryptor) {
            this.packetEncryptor = new PacketEncryptor(this, iv);
            this._encryptionEnabled = true;
        }
    }

    public sendPacket(packet: DataPacket | Buffer, priority: Priority = Priority.Normal) {
        const serialized = packet instanceof DataPacket ? packet.serialize() : packet;
        const compressed = this.packetCompressor.compress(
            serialized,
            this.options.compressionMethod
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
        const id = getPacketId(packet);
        if ((id as number) === 129) {
            const instance = new ClientCacheStatusPacket(packet);
            instance.deserialize();
            this.emit("ClientCacheStatusPacket", instance);
            return;
        }

        const PacketClass = Packets[id];
        if (!PacketClass) {
            Logger.debug(`Received Unknown Packet: ${id}`);
            return;
        }

        const instance = new PacketClass(packet);
        instance.deserialize();

        const packetName = PacketClass.name as PacketNames;
        this.emit(packetName, instance);

        if (this.hasListeners("packet")) {
            this.emit("packet", instance);
        }
    }

    public handle(packet: Buffer) {
        const packets = this.packetCompressor.decompress(packet);
        for (const packet of packets) {
            this.processPacket(packet);
        }
    }
}

export { Player };

function toBase64(string: string): string {
	return Buffer.from(string).toString("base64");
}
