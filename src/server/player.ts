import {
    CompressionMethod,
    type DataPacket,
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
import { Logger, Priority, Connection as RakConnection } from "@sanctumterra/raknet";
import { createHash, createPublicKey, diffieHellman } from "node:crypto";
import { sign } from "jsonwebtoken";
import { decodeLoginJWT, PacketCompressor, type Profile } from "../network";
import type { Server } from "./server";
import { Emitter } from "../libs";
import { type ClientOptions, defaultClientOptions, type PacketNames, ProtocolList } from "../client";
import type { PlayerEvents } from "./server-options";
import type { Payload } from "../client/types";
import { PacketEncryptor } from "../network/packet-encryptor";

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
		// handle encapsulated packets - This will be converted to Minecraft packets.
		this.connection.on("encapsulated", (packet: Buffer) => {
			this.handle(packet);
		});
		
		this.connection.on("disconnect", () => {
            this.server.onDisconnect(this);
        });

		// Handle RequestNetworkSettingsPacket - Once to prevent anything from breaking.
		this.once("RequestNetworkSettingsPacket", (packet) => {
			const settings = new NetworkSettingsPacket();

			settings.compressionThreshold = this.server.options.compressionThreshold;
			settings.compressionMethod = this.server.options.compressionMethod;
			settings.clientScalar = 0;
			settings.clientThrottle = false;
			settings.clientThreshold = 0;
			this.send(settings);

			this._compressionEnabled = true;
			this.options.compressionMethod = this.server.options.compressionMethod;
			this.options.compressionLevel = this.server.options.compressionLevel;
			this.options.compressionThreshold =
			this.server.options.compressionThreshold;
		});

		// Handle Login Packet - Once to prevent anything from breaking.
		this.once("LoginPacket", (packet) => {
			const tokens = packet.tokens;
			const { key, data, skin } = decodeLoginJWT(tokens);

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

			const SALT = "🧂";
			const secretHash = createHash("sha256");
			secretHash.update(SALT);
			secretHash.update(this.data.sharedSecret);
			this.secretKeyBytes = secretHash.digest();

			// @ts-expect-error This wants a Uint8Array but we have a Buffer
			const token = sign(
				{
					salt: toBase64(SALT),
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

		// Handle ClientToServerHandshakePacket - Once to prevent anything from breaking.
		this.once("ClientToServerHandshakePacket", (packet) => {
            const playStatus = new PlayStatusPacket();
            playStatus.status = PlayStatus.LoginSuccess;
            this.send(playStatus);
        });
	}

    public startEncryption(iv: Buffer) {
        if(this.packetEncryptor) throw new Error("Packet Encryptor already exists");
        this.packetEncryptor = new PacketEncryptor(this, iv);
        this._encryptionEnabled = true;
    }

    private sendPacket(packet: DataPacket, priority: Priority = Priority.Normal) { 
        const serialized = packet.serialize();
        const compressed = this.packetCompressor.compress(
            serialized, 
            this.options.compressionMethod
        );

        this.connection.frameAndSend(compressed, priority);
    }

    public send(packet: DataPacket) {
        this.sendPacket(packet, Priority.Immediate);
    }

    public queue(packet: DataPacket) {
        this.sendPacket(packet, Priority.Normal);
    }

	public processPacket(packets: Buffer[]) {
        for(const packet of packets) {
            const id = getPacketId(packet);
            if (!Packets[id]) {
                console.log("Received Unknown Packet", id);
                return;
            }
            const Class = Packets[id];
            const instance = new Class(packet);
			instance.deserialize();
            Logger.info(Class.name as PacketNames)
            this.emit(Class.name as PacketNames, instance);

            if (this.hasListeners("packet")) {
                this.emit("packet", instance);
            }
        }
	}

    public handle(packet: Buffer) {
        const packets = this.packetCompressor.decompress(packet);
        this.processPacket(packets);
    }
}

export { Player };

function toBase64(string: string): string {
	return Buffer.from(string).toString("base64");
}
