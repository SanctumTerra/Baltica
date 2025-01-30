import { createPublicKey } from "node:crypto";
import { Logger } from "@sanctumterra/raknet";
import type { LoginTokens } from "@serenityjs/protocol";
import { verify } from "jsonwebtoken";
import { Authflow, Titles } from "prismarine-auth";
import { v3 } from "uuid-1345";
import type { Client } from "../client/client";

export interface Profile {
	name: string;
	uuid: string;
	xuid: number;
}
const UUID_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
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
	const [, payload] = jwt.split(".");
	const xboxProfile = JSON.parse(Buffer.from(payload, "base64").toString());

	return {
		name: xboxProfile?.extraData?.displayName || "Player",
		uuid:
			xboxProfile?.extraData?.identity ||
			"adfcf5ca-206c-404a-aec4-f59fff264c9b",
		xuid: xboxProfile?.extraData?.XUID || 0,
	};
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

const getDER = (b64: string) =>
	createPublicKey({
		key: Buffer.from(b64, "base64"),
		format: "der",
		type: "spki",
	});

const readAuth = (chain: string[]) => {
	let authData = {};
	let pubKey = getDER(getX5U(chain[0]));
	let key = null;
	let verified = false;

	for (const token of chain) {
		const decoded = verify(token, pubKey, { algorithms: ["ES384"] });
		const x5u = getX5U(token);

		if (x5u === PUBLIC_KEY) {
			verified = true;
		}

		// @ts-expect-error Wrong type in Authflow definition
		pubKey = decoded.identityPublicKey
			? // @ts-expect-error Wrong type in Authflow definition
				getDER(decoded.identityPublicKey)
			: x5u;
		// @ts-expect-error Wrong type in Authflow definition
		key = decoded.identityPublicKey || key;
		// @ts-expect-error Wrong type in Authflow definition
		authData = { ...authData, ...decoded };
	}

	return { key, data: authData };
};

const readSkin = (publicKey: string, token: string) => {
	const pubKey = getDER(publicKey);
	const decoded = verify(token, pubKey, { algorithms: ["ES384"] });
	return decoded;
};

const decodeLoginJWT = (tokens: LoginTokens) => {
	const identity = tokens.identity;
	const client = tokens.client;
	const payload = JSON.parse(identity);
	const ClientUserChain = payload.chain;

	const auth = readAuth(ClientUserChain);
	const skin = readSkin(auth.key, tokens.client);
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
