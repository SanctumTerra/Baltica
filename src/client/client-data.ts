import { LoginPacket, LoginTokens } from "@serenityjs/protocol";
import type { Client } from "./client";
import { v3 as uuidv3 } from "uuid-1345";
import { type Payload, createDefaultPayload } from "./types/payload";
import {
	sign as signCallback,
	type Secret,
	type SignOptions,
} from "jsonwebtoken";
import { promisify } from "node:util";
import { createECDH, KeyObject, type KeyExportOptions } from "node:crypto";
import { type LoginData, prepareLoginData } from "./types/login-data";
import { Logger } from "@sanctumterra/raknet";
import type { Player } from "src/server/player";

const PUBLIC_KEY =
	"MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAECRXueJeTDqNRRgJi/vlRufByu/2G0i2Ebt6YMar5QX/R0DIIyrJMcUpruK4QveTfJSTp3Shlq4Gk34cD/4GUWwkv0DVuzeuB+tXija7HBxii03NHDbPAD0AKnLr2wdAp";
const algorithm = "ES384";
const curve = "secp384r1";
const pem: KeyExportOptions<"pem"> = { format: "pem", type: "sec1" };
const der: KeyExportOptions<"der"> = { format: "der", type: "spki" };

const signAsync = promisify(signCallback) as unknown as (
	payload: string | Buffer | object,
	secretOrPrivateKey: Secret,
	options?: SignOptions | undefined,
) => Promise<string>;

class ClientData {
    public client: Client | Player;
    /** This Contains a lot of Data for the Login Packet */
    public payload: Payload;
    /** This Contains the Access Tokens from Auth */
	public accessToken!: string[];
    /** This Contains the Login Data */
    public loginData: LoginData;
    /** This Contains the Shared Secret */
    public sharedSecret!: Buffer;

    constructor(client: Client | Player) {
        this.client = client;
        this.payload = createDefaultPayload(client);
        this.loginData = prepareLoginData();
    }

    public createLoginPacket() : LoginPacket {
        const loginPacket = new LoginPacket();
		const chain = [
			this.loginData.clientIdentityChain,
			...this.accessToken,
		];
		const userChain = this.loginData.clientUserChain;
		const encodedChain = JSON.stringify({ chain });
        loginPacket.protocol = this.client.protocol;
		loginPacket.tokens = new LoginTokens(userChain, encodedChain);
        return loginPacket;
    }

    public async createClientChain(
        mojangKey: string | null,
        offline: boolean,
    ): Promise<string> {
        return this.createClientChainInternal(mojangKey, offline);
    }

    private async createClientChainInternal(
        mojangKey: string | null,
        offline: boolean,
    ): Promise<string> {
        const { clientX509, ecdhKeyPair } = this.loginData;
        let payload: Record<string, unknown>;
        let signOptions: SignOptions;
    
        if (offline) {
            payload = {
                extraData: {
                    displayName: this.client.profile.name,
                    identity: this.client.profile.uuid,
                    titleId: "89692877",
                    XUID: "0",
                },
                certificateAuthority: true,
                identityPublicKey: clientX509,
            };
            signOptions = {
                algorithm: algorithm,
                notBefore: 0,
                issuer: "self",
                expiresIn: 60 * 60,
                header: { alg: algorithm, x5u: clientX509, typ: undefined },
            };
        } else {
            payload = {
                identityPublicKey: mojangKey || PUBLIC_KEY,
                certificateAuthority: true,
            };
            signOptions = {
                algorithm: algorithm,
                header: { alg: algorithm, x5u: clientX509, typ: undefined },
            };
        }
    
        return signAsync(
            payload,
            ecdhKeyPair.privateKey.export({ format: "pem", type: "pkcs8" }) as string,
            signOptions,
        );
    }

    public async createClientUserChain(privateKey: KeyObject): Promise<string> {
        const { clientX509 } = this.loginData;
        const customPayload = this.client.options.skinData || {};
    
        const payload: Payload = {
            ...this.payload,
            ...customPayload,
            ServerAddress: `${this.client.options.host}:${this.client.options.port}`,
            ClientRandomId: Date.now(),
            DeviceId: ClientData.nextUUID(),
            PlayFabId: ClientData.nextUUID().replace(/-/g, "").slice(0, 16),
            SelfSignedId: ClientData.nextUUID(),
        };
    
        return signAsync(
            payload,
            privateKey.export({ format: "pem", type: "pkcs8" }) as string,
            {
                algorithm,
                header: { alg: algorithm, x5u: clientX509, typ: undefined },
                noTimestamp: true,
            }
        );
    }

    public createSharedSecret(
		privateKey: KeyObject,
		publicKey: KeyObject,
	): Buffer {
		this.validateKeys(privateKey, publicKey);

		const curve = privateKey.asymmetricKeyDetails?.namedCurve;
		if (!curve) {
			throw new Error("Invalid private key format. Named curve is missing.");
		}

		try {
			const ecdh = createECDH(curve);
			const privateKeyJwk = privateKey.export({ format: "jwk" }) as {
				d?: string;
			};
			const publicKeyJwk = publicKey.export({ format: "jwk" }) as {
				x?: string;
				y?: string;
			};

			if (!privateKeyJwk.d || !publicKeyJwk.x || !publicKeyJwk.y) {
				throw new Error(
					"Invalid key format. Missing 'd', 'x', or 'y' parameters.",
				);
			}

			ecdh.setPrivateKey(
				new Uint8Array(Buffer.from(privateKeyJwk.d, "base64")),
			);
			const publicKeyBuffer = Buffer.concat([
				new Uint8Array([0x04]),
				new Uint8Array(Buffer.from(publicKeyJwk.x, "base64")),
				new Uint8Array(Buffer.from(publicKeyJwk.y, "base64")),
			]);

			const computedSecret = ecdh.computeSecret(
				new Uint8Array(publicKeyBuffer),
			);
			return Buffer.from(new Uint8Array(computedSecret));
		} catch (error) {
			Logger.error("Error computing shared secret:", error as Error);
			throw new Error("Failed to create shared secret.");
		}
	}

    private validateKeys(privateKey: KeyObject, publicKey: KeyObject): void {
		if (
			!(privateKey instanceof KeyObject) ||
			!(publicKey instanceof KeyObject)
		) {
			throw new Error(
				"Both privateKey and publicKey must be crypto.KeyObject instances",
			);
		}

		if (privateKey.type !== "private" || publicKey.type !== "public") {
			throw new Error("Invalid key types. Expected private and public keys.");
		}
	}

    public static nextUUID() {
		return uuidv3({
			namespace: "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
			name: Date.now().toString(),
		});
	}
}

export { ClientData };