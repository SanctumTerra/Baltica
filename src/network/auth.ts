import { createPublicKey } from "node:crypto";
import { Logger } from "@sanctumterra/raknet";
import type { LoginTokens } from "@serenityjs/protocol";
import * as jose from "jose";
import { Authflow, Titles } from "prismarine-auth";
import { v3 } from "uuid-1345";
import type { Client } from "../client/client";
import { Bedrock } from "./beta/auth";

export interface Profile {
	name: string;
	uuid: string;
	xuid: number;
}
export const UUID_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
const PUBLIC_KEY =
	"MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAECRXueJeTDqNRRgJi/vlRufByu/2G0i2Ebt6YMar5QX/R0DIIyrJMcUpruK4QveTfJSTp3Shlq4Gk34cD/4GUWwkv0DVuzeuB+tXija7HBxii03NHDbPAD0AKnLr2wdAp";

async function createOfflineSession(client: Client): Promise<void> {
	try {
		if (!client.options.username) {
			throw new Error("Must specify a valid username for offline session");
		}
		Logger.info("Creating offline session...");
		const profile: Profile = {
			name: client.options.username,
			uuid: generateUUID(client.options.username),
			xuid: 0,
		};

		await setupClientProfile(client, profile, []);
		await setupClientChains(client, true);
		client.emit("session");
		Logger.info("Offline session created");
	} catch (error) {
		Logger.error(
			`Error while creating offline session: ${error instanceof Error ? error.message : String(error)}`,
		);
		throw error;
	}
}

async function authenticate(client: Client): Promise<void> {
	const startTime = Date.now();
	try {
		if (client.options.betaAuth) {
			if (!process.argv.includes("betaAuth"))
				throw new Error("Beta authentication is in beta, please do not use.");
			Logger.info("Using Bedrock Auth");
			const bedrock = new Bedrock(
				client.options.version,
				true,
				client.data.loginData.clientX509,
			);
			try {
				const success = await bedrock.auth();
				if (!success) {
					throw new Error("Beta authentication failed");
				}
			} catch (error) {
				Logger.error(
					`Beta authentication failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				throw error;
			}
			const chains = bedrock.getChainData();
			if (!chains || chains.length < 2) {
				throw new Error("Invalid chain data received");
			}
			Logger.debug("Chain data received:", chains);
			const endTime = Date.now();
			Logger.info(
				`Authentication with Xbox took ${(endTime - startTime) / 1000}s.`,
			);

			const profile = extractProfile(chains[1]);

			await setupClientProfile(client, profile, chains);
			await setupClientChains(client);
			client.emit("session");
			return;
		}
		// Logger.info("Using PrismarineJS Auth");
		const authflow = createAuthflow(client);
		const chains = await getMinecraftBedrockToken(authflow, client);
		const profile = extractProfile(chains[1]);
		const endTime = Date.now();
		Logger.info(
			`Authentication with Xbox took ${(endTime - startTime) / 1000}s.`,
		);

		await setupClientProfile(client, profile, chains);
		await setupClientChains(client);

		client.emit("session");
	} catch (error) {
		Logger.error(
			`Authentication failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		throw error;
	}
}

function extractProfile(jwt: string): Profile {
	if (!jwt) {
		Logger.error("JWT is undefined or empty");
		return {
			name: "Player",
			uuid: "adfcf5ca-206c-404a-aec4-f59fff264c9b",
			xuid: 0,
		};
	}

	try {
		const [, payload] = jwt.split(".");
		if (!payload) {
			Logger.error("Invalid JWT format - no payload section found");
			throw new Error("Invalid JWT format");
		}

		const xboxProfile = JSON.parse(Buffer.from(payload, "base64").toString());

		return {
			name: xboxProfile?.extraData?.displayName || "Player",
			uuid:
				xboxProfile?.extraData?.identity ||
				"adfcf5ca-206c-404a-aec4-f59fff264c9b",
			xuid: xboxProfile?.extraData?.XUID || 0,
		};
	} catch (error) {
		Logger.error(
			`Error extracting profile: ${error instanceof Error ? error.message : String(error)}`,
		);
		return {
			name: "Player",
			uuid: "adfcf5ca-206c-404a-aec4-f59fff264c9b",
			xuid: 0,
		};
	}
}

function createAuthflow(client: Client): Authflow {
	return new Authflow(
		client.options.username,
		client.options.tokensFolder,
		{
			authTitle: Titles.MinecraftNintendoSwitch,
			flow: "live",
			deviceType: "Nintendo",
		},
		(res: { message: string }) => {
			Logger.info(res.message);
		},
	);
}

async function getMinecraftBedrockToken(
	authflow: Authflow,
	client: Client,
): Promise<string[]> {
	try {
		// @ts-expect-error Wrong param type in Authflow definition
		return await authflow.getMinecraftBedrockToken(
			// @ts-expect-error Wrong param type in Authflow definition
			client.data.loginData.clientX509,
		);
	} catch (error) {
		Logger.error(
			`Error while getting Chains: ${error instanceof Error ? error.message : String(error)}`,
		);
		throw error;
	}
}

function setupClientProfile(
	client: Client,
	profile: Profile,
	accessToken: string[],
): void {
	client.profile = profile;
	client.data.accessToken = accessToken;
	client.username = profile.name;
}

async function setupClientChains(
	client: Client,
	offline = false,
): Promise<void> {
	const [clientIdentityChain, clientUserChain] = await Promise.all([
		client.data.createClientChain(null, offline),
		client.data.createClientUserChain(
			client.data.loginData.ecdhKeyPair.privateKey,
		),
	]);

	client.data.loginData.clientIdentityChain = clientIdentityChain;
	client.data.loginData.clientUserChain = clientUserChain;
}

function getX5U(token: string) {
	const [header] = token.split(".");
	const hdec = Buffer.from(header, "base64").toString("utf-8");
	const hjson = JSON.parse(hdec);
	return hjson.x5u;
}

const getDER = (b64: string) => {
	const key = createPublicKey({
		key: Buffer.from(b64, "base64"),
		format: "der",
		type: "spki",
	});
	return key.export({ format: "pem", type: "spki" }) as string;
};

const readAuth = async (chain: string[]) => {
	let authData = {};
	let pubKey = getDER(getX5U(chain[0]));
	let key: string | null = null;
	let verified = false;

	for (const token of chain) {
		const publicKey = await jose.importSPKI(pubKey, "ES384");
		const { payload } = await jose.jwtVerify(token, publicKey, {
			algorithms: ["ES384"],
		});
		const x5u = getX5U(token);

		if (x5u === PUBLIC_KEY) {
			verified = true;
		}

		const identityPublicKey =
			typeof payload.identityPublicKey === "string"
				? payload.identityPublicKey
				: null;

		if (identityPublicKey) {
			pubKey = getDER(identityPublicKey);
			key = identityPublicKey;
		} else {
			pubKey = getDER(x5u);
			key = x5u;
		}

		authData = { ...authData, ...payload };
	}

	if (!key) {
		throw new Error("No identity public key found in chain");
	}

	return { key, data: authData };
};

const readSkin = async (publicKey: string, token: string) => {
	const pubKey = getDER(publicKey);
	const key = await jose.importSPKI(pubKey, "ES384");
	const { payload } = await jose.jwtVerify(token, key, {
		algorithms: ["ES384"],
	});
	return payload;
};

const decodeLoginJWT = async (tokens: LoginTokens) => {
	const identity = tokens.identity;
	const client = tokens.client;
	const payload = JSON.parse(identity);
	const ClientUserChain = payload.chain;

	const auth = await readAuth(ClientUserChain);
	const skin = await readSkin(auth.key, tokens.client);
	return { key: auth.key, data: auth.data, skin };
};

function generateUUID(username: string): string {
	return v3({ namespace: UUID_NAMESPACE, name: username });
}

export {
	createOfflineSession,
	setupClientProfile,
	generateUUID,
	authenticate,
	decodeLoginJWT,
};
