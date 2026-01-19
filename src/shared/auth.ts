import { Logger } from "@sanctumterra/raknet";
import type { LoginTokens } from "@serenityjs/protocol";
import * as jose from "jose";
import { createPublicKey } from "node:crypto";
import { Authflow, Titles } from "prismarine-auth";
import { v3 } from "uuid-1345";
import { type ProtocolList, versionHigherThan } from "./types";
import type { Client } from "../client/client";
import { authenticateWithCredentials as xboxAuth } from "./auth/authentication";

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

	// Check if email/password auth is requested
	if (client.options.email && client.options.password) {
		return authenticateWithEmailPassword(client);
	}

	// Default: use prismarine-auth (device code flow)
	try {
		const authflow = createAuthflow(client);
		const chains = await getMinecraftBedrockToken(authflow, client);
		const profile = extractProfile(chains[1]);
		const sessionToken = await getMultiplayerSessionToken(authflow, client);
		client.data.loginToken = sessionToken;

		await setupClientProfile(client, profile, chains);
		await setupClientChains(client);

		const endTime = Date.now();
		Logger.info(
			`Authentication with Xbox took ${(endTime - startTime) / 1000}s.`,
		);

		client.emit("session");
	} catch (error) {
		Logger.error(
			`Authentication failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		throw error;
	}
}

/**
 * Authenticate using email/password directly (requires 2FA disabled)
 */
async function authenticateWithEmailPassword(client: Client): Promise<void> {
	const startTime = Date.now();
	try {
		if (!client.options.email || !client.options.password) {
			throw new Error(
				"Email and password are required for email/password authentication",
			);
		}

		const tokens = await xboxAuth({
			email: client.options.email,
			password: client.options.password,
			clientPublicKey: client.data.loginData.clientX509,
			cacheDir: client.options.tokensFolder,
			proxy: client.options.proxy,
		});

		const profile: Profile = {
			name: tokens.gamertag,
			uuid: generateUUID(tokens.gamertag),
			xuid: Number(tokens.xuid) || 0,
		};

		// Get Playfab session ticket
		const playfabData = await getPlayfabSessionTicket(
			tokens.playfabUserHash,
			tokens.playfabXstsToken,
		);

		// Get the multiplayer session token
		// First get the MC services token (mcToken)
		const mcToken = await getMinecraftServicesTokenFromPlayfab(
			playfabData.sessionTicket,
		);

		// Then use mcToken to get the multiplayer session token
		const sessionToken = await getMultiplayerSessionTokenFromMcToken(
			mcToken,
			client.data.loginData.clientX509,
		);

		client.data.loginToken = sessionToken;

		// Extract pfcd from session token and store it
		try {
			const tokenParts = sessionToken.split(".");
			if (tokenParts.length >= 2) {
				const payload = JSON.parse(
					Buffer.from(tokenParts[1], "base64").toString(),
				);
				if (payload.pfcd) {
					client.data.payload.pfcd = payload.pfcd;
				}
				// Store session token data for client chain
				client.data.loginData.sessionTokenData = {
					ipt: payload.ipt,
					tid: payload.prop ? JSON.parse(payload.prop).tid : undefined,
					mid: payload.prop ? JSON.parse(payload.prop).mid : undefined,
					xid: payload.xid,
					cpk: payload.cpk,
				};
			}
		} catch (e) {
			Logger.warn(
				`Failed to extract pfcd from session token: ${e instanceof Error ? e.message : String(e)}`,
			);
		}

		const endTime = Date.now();
		Logger.info(
			`Authentication with Xbox (email/password) took ${(endTime - startTime) / 1000}s.`,
		);

		setupClientProfile(client, profile, tokens.chains);
		await setupClientChains(client);
		client.emit("session");
	} catch (error) {
		Logger.error(
			`Email/password authentication failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		Logger.warn("Make sure you have an xbox profile crated!");
		throw error;
	}
}

async function getMultiplayerSessionToken(
	authflow: Authflow,
	client: Client,
): Promise<string> {
	try {
		// @ts-expect-error Method exists at runtime
		const servicesToken = await authflow.getMinecraftBedrockServicesToken({});
		const mcToken = servicesToken.mcToken;

		const publicKey = client.data.loginData.clientX509;

		const response = await fetch(
			"https://authorization.franchise.minecraft-services.net/api/v1.0/multiplayer/session/start",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: mcToken,
					"Accept-Encoding": "identity",
				},
				body: JSON.stringify({
					publicKey: publicKey,
				}),
			},
		);

		if (!response.ok) {
			const text = await response.text();
			throw new Error(
				`Multiplayer session start failed: ${response.status} ${response.statusText} - ${text}`,
			);
		}

		const json = (await response.json()) as { result: { signedToken: string } };
		return json.result.signedToken;
	} catch (error) {
		Logger.error(
			`Error while getting Multiplayer Session Token: ${error instanceof Error ? error.message : String(error)}`,
		);
		throw error;
	}
}

async function getPlayfabSessionTicket(
	playfabUserHash: string,
	playfabXstsToken: string,
): Promise<{ sessionTicket: string; playFabId: string }> {
	try {
		const response = await fetch(
			"https://20ca2.playfabapi.com/Client/LoginWithXbox",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					CreateAccount: true,
					EncryptedRequest: null,
					InfoRequestParameters: {
						GetCharacterInventories: false,
						GetCharacterList: false,
						GetPlayerProfile: true,
						GetPlayerStatistics: false,
						GetTitleData: false,
						GetUserAccountInfo: true,
						GetUserData: false,
						GetUserInventory: false,
						GetUserReadOnlyData: false,
						GetUserVirtualCurrency: false,
						PlayerStatisticNames: null,
						ProfileConstraints: null,
						TitleDataKeys: null,
						UserDataKeys: null,
						UserReadOnlyDataKeys: null,
					},
					PlayerSecret: null,
					TitleId: "20CA2",
					XboxToken: `XBL3.0 x=${playfabUserHash};${playfabXstsToken}`,
				}),
			},
		);

		if (!response.ok) {
			const text = await response.text();
			throw new Error(
				`Playfab login failed: ${response.status} ${response.statusText} - ${text}`,
			);
		}

		const json = (await response.json()) as {
			data: { SessionTicket: string; PlayFabId: string };
		};
		return {
			sessionTicket: json.data.SessionTicket,
			playFabId: json.data.PlayFabId,
		};
	} catch (error) {
		Logger.error(
			`Error while getting Playfab session ticket: ${error instanceof Error ? error.message : String(error)}`,
		);
		throw error;
	}
}

async function getMinecraftServicesTokenFromPlayfab(
	sessionTicket: string,
): Promise<string> {
	try {
		const response = await fetch(
			"https://authorization.franchise.minecraft-services.net/api/v1.0/session/start",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					device: {
						applicationType: "MinecraftPE",
						gameVersion: "1.21.130",
						id: "c1681ad3-415e-30cd-abd3-3b8f51e771d1",
						memory: String(8 * (1024 * 1024 * 1024)),
						platform: "Windows10",
						playFabTitleId: "20CA2",
						storePlatform: "uwp.store",
						type: "Windows10",
					},
					user: {
						token: sessionTicket,
						tokenType: "PlayFab",
					},
				}),
			},
		);

		if (!response.ok) {
			const text = await response.text();
			throw new Error(
				`MC services token failed: ${response.status} ${response.statusText} - ${text}`,
			);
		}

		const json = (await response.json()) as {
			result: { authorizationHeader: string };
		};

		return json.result.authorizationHeader;
	} catch (error) {
		Logger.error(
			`Error while getting MC services token: ${error instanceof Error ? error.message : String(error)}`,
		);
		throw error;
	}
}

async function getMultiplayerSessionTokenFromMcToken(
	mcToken: string,
	publicKey: string,
): Promise<string> {
	try {
		const response = await fetch(
			"https://authorization.franchise.minecraft-services.net/api/v1.0/multiplayer/session/start",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: mcToken,
					"Accept-Encoding": "identity",
				},
				body: JSON.stringify({
					publicKey: publicKey,
				}),
			},
		);

		if (!response.ok) {
			const text = await response.text();
			throw new Error(
				`Multiplayer session start failed: ${response.status} ${response.statusText} - ${text}`,
			);
		}

		const json = (await response.json()) as {
			result: { signedToken: string };
		};

		return json.result.signedToken;
	} catch (error) {
		Logger.error(
			`Error while getting Multiplayer Session Token: ${error instanceof Error ? error.message : String(error)}`,
		);
		throw error;
	}
}

async function getMultiplayerSessionTokenFromXsts(
	sessionTicket: string,
	publicKey: string,
): Promise<string> {
	try {
		const response = await fetch(
			"https://authorization.franchise.minecraft-services.net/api/v1.0/session/start",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					device: {
						applicationType: "MinecraftPE",
						gameVersion: "1.21.130",
						id: "c1681ad3-415e-30cd-abd3-3b8f51e771d1",
						memory: String(8 * (1024 * 1024 * 1024)),
						platform: "Windows10",
						playFabTitleId: "20CA2",
						storePlatform: "uwp.store",
						type: "Windows10",
					},
					user: {
						token: sessionTicket,
						tokenType: "PlayFab",
					},
				}),
			},
		);

		if (!response.ok) {
			const text = await response.text();
			throw new Error(
				`Multiplayer session start failed: ${response.status} ${response.statusText} - ${text}`,
			);
		}

		const json = (await response.json()) as {
			result: { authorizationHeader: string };
		};

		return json.result.authorizationHeader;
	} catch (error) {
		Logger.error(
			`Error while getting Multiplayer Session Token: ${error instanceof Error ? error.message : String(error)}`,
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
	client.data.loginData.clientIdentityChain =
		await client.data.createClientChain(null, offline);
	client.data.loginData.clientUserChain =
		await client.data.createClientUserChain(
			client.data.loginData.ecdhKeyPair.privateKey,
		);
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

const decodeLoginJWT = async (
	tokens: LoginTokens,
	version: keyof typeof ProtocolList,
) => {
	const identity = tokens.identity;
	const client = tokens.client;
	const payload = JSON.parse(identity);
	let ClientUserChain = [];

	if (versionHigherThan(version, "1.21.80")) {
		if (!payload.Certificate) {
			Logger.error(
				"No certificate found in identity, possible version mismatch!",
			);
			return { key: null, data: null, skin: null };
		}
		const parsed = JSON.parse(payload.Certificate);
		ClientUserChain = parsed.chain;
	} else {
		ClientUserChain = payload.chain;
	}
	if (!ClientUserChain) {
		throw new Error("No client user chain found, possible version mismatch!");
	}
	// const ClientUserChain = payload.chain;

	const auth = await readAuth(ClientUserChain);
	const skin = await readSkin(auth.key, tokens.client);

	return { key: auth.key, data: auth.data, skin };
};

function generateUUID(username: string): string {
	return v3({ namespace: UUID_NAMESPACE, name: username });
}

export {
	authenticate,
	createOfflineSession,
	decodeLoginJWT,
	generateUUID,
	setupClientProfile,
};
