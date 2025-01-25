import { Emitter } from "../libs/emitter";
import { Frame, Logger, Priority, Client as RaknetClient, Status } from "@sanctumterra/raknet";
import { defaultClientOptions, type PacketNames, ProtocolList, type ClientOptions, type ClientEvents } from "./client-options";
import { Packets, getPacketId, RequestNetworkSettingsPacket,ServerboundLoadingScreenPacketPacket,  PlayStatus, ServerboundLoadingScreenType, SetLocalPlayerAsInitializedPacket, RequestChunkRadiusPacket,  ClientToServerHandshakePacket, DataPacket, ResourcePackResponse, ResourcePackClientResponsePacket, TextPacket, TextPacketType, type StartGamePacket, type ResourcePackStackPacket, type PlayStatusPacket, type ResourcePacksInfoPacket } from "@serenityjs/protocol";
import { authenticate, createOfflineSession, PacketCompressor, type Profile } from "../network";
import { ClientData } from "./client-data";
import { createHash } from "node:crypto";
import { createPublicKey } from "node:crypto";
import { PacketEncryptor } from "../network/packet-encryptor";
import { WorkerClient } from "./worker";

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

        this.raknet = this.options.worker ? new WorkerClient({
            address: this.options.host,
            port: this.options.port,
        }) : new RaknetClient({
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

    public async connect() {
        this.packetCompressor = new PacketCompressor(this);
        this.listen();
        const advertisement = await this.raknet.connect();
        this.raknet.on("encapsulated", this.handleEncapsulated.bind(this));

        return new Promise((resolve, reject) => {
            this.once("StartGamePacket", this.handleStartGamePacket.bind(this));
            this.once("SetLocalPlayerAsInitializedPacket", this.handleSetLocalPlayerAsInitializedPacket.bind(this));

            const interval = setInterval(() => {
                if (this.status === Status.Connected && this.startGamePacket && this.sessionReady) {       
                    clearInterval(interval);
                    resolve([advertisement, this.startGamePacket]);
                }
            }, 50)
        });
    }

    private handleStartGamePacket(packet: StartGamePacket): void {
        this.startGamePacket = packet;
        this.runtimeEntityId = packet.runtimeEntityId;
        if(this.cancelPastLogin) return;

        const radius = new RequestChunkRadiusPacket();
		radius.radius = this.options.viewDistance;
		radius.maxRadius = this.options.viewDistance;
        this.send(radius);
    }

    private handleSetLocalPlayerAsInitializedPacket(packet: SetLocalPlayerAsInitializedPacket): void {
        this.status = Status.Connected;
    }

    private handleEncapsulated(buffer: Buffer) {
        try {
            const packets = this.packetCompressor.decompress(buffer);
            for(const packet of packets) {
                this.processPacket(packet);
            }
        } catch (error) {
            Logger.error('Failed to handle encapsulated packet', error);
        }
    }

    private sendPacket(packet: DataPacket | Buffer, priority: Priority = Priority.Normal) { 
        try {
            const serialized = packet instanceof DataPacket ? packet.serialize() : packet;
            const compressed = this.packetCompressor.compress(serialized, this.options.compressionMethod);
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
        this.sendPacket(packet, Priority.Normal);
    }

    /** Already decompressed packets */
    public processPacket(buffer: Buffer) {
        const id = getPacketId(buffer);
        if(!Packets[id]) return;
        const PacketClass = Packets[id];
        const packet = new PacketClass(buffer).deserialize();
        this.emit(PacketClass.name as PacketNames, packet);
    }

    private handleSession(): void {
        this.sessionReady = true;
    }

    public listen() {
        this.raknet.once("connect", () => {
            const timer = setInterval(() => {
                if(this.sessionReady) {
                    const request = new RequestNetworkSettingsPacket();
                    request.protocol = this.protocol;
                    this.send(request);
                    clearInterval(timer);
                }
            }, 50);
        });

        this.once("NetworkSettingsPacket", (packet) => {
            this._compressionEnabled = true;
            this.options.compressionMethod = this.packetCompressor.getMethod(packet.compressionMethod);
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

        this.once("ResourcePacksInfoPacket", this.handleResourcePacksInfoPacket.bind(this));
        this.once("ResourcePackStackPacket", this.handleResourcePacksInfoPacket.bind(this));
        this.on("PlayStatusPacket", this.handlePlayStatusPacket.bind(this));
    }

    private handlePlayStatusPacket(packet: PlayStatusPacket) {
		if (packet.status === PlayStatus.PlayerSpawn) {
            if(this.cancelPastLogin) return;
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

    private handleResourcePacksInfoPacket(packet: ResourcePacksInfoPacket | ResourcePackStackPacket) {
        if(this.cancelPastLogin) return;
        const response = new ResourcePackClientResponsePacket;
        response.packs = [];
        response.response = ResourcePackResponse.HaveAllPacks;
        this.send(response);
        response.response = ResourcePackResponse.Completed;
        this.send(response);
    }

    public startEncryption(iv: Buffer) {
        this.packetEncryptor = new PacketEncryptor(this, iv);
        this._encryptionEnabled = true;
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
