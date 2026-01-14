import { live, xnet } from "@xboxreplay/xboxlive-auth";
import type { AuthenticateResponse, Email } from "@xboxreplay/xboxlive-auth";
import * as fs from "node:fs";
import * as path from "node:path";
import { Logger } from "@sanctumterra/raknet";

export interface BedrockTokens {
	chains: string[];
	xuid: string;
	gamertag: string;
	userHash: string;
}

export interface AuthOptions {
	email: string;
	password: string;
	clientPublicKey: string;
	cacheDir?: string;
}

interface CachedAuth {
	userToken: string;
	userHash: string;
	notAfter: string;
	obtainedOn: number;
}

const MINECRAFT_BEDROCK_RELYING_PARTY = "https://multiplayer.minecraft.net/";

function hashString(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash;
	}
	return Math.abs(hash).toString(16).slice(0, 6);
}

function ensureDir(dir: string): void {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function getCacheFile(cacheDir: string, email: string): string {
	return path.join(cacheDir, `${hashString(email)}_xbl-user-cache.json`);
}

function loadCache(cacheFile: string): CachedAuth | null {
	try {
		if (fs.existsSync(cacheFile)) {
			const cached = JSON.parse(
				fs.readFileSync(cacheFile, "utf-8"),
			) as CachedAuth;
			// Check if token is still valid (with 1 hour buffer)
			const expiresAt = new Date(cached.notAfter).getTime();
			if (Date.now() < expiresAt - 3600000) {
				return cached;
			}
			Logger.info("Cached user token expired");
		}
	} catch {
		/* ignore */
	}
	return null;
}

function saveCache(
	cacheFile: string,
	userToken: string,
	userHash: string,
	notAfter: string,
): void {
	try {
		ensureDir(path.dirname(cacheFile));
		const data: CachedAuth = {
			userToken,
			userHash,
			notAfter,
			obtainedOn: Date.now(),
		};
		fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
	} catch {
		/* ignore */
	}
}

/**
 * Authenticates with Xbox Live using email/password and obtains Minecraft Bedrock tokens
 * Caches Xbox user token (~14 days valid) to minimize login requests
 */
export async function authenticateWithCredentials(
	options: AuthOptions,
): Promise<BedrockTokens> {
	const { email, password, clientPublicKey, cacheDir } = options;
	const cacheFile = cacheDir ? getCacheFile(cacheDir, email) : null;

	let userToken: string;
	let userHash: string;

	// Try to use cached user token first
	const cached = cacheFile ? loadCache(cacheFile) : null;
	if (cached) {
		Logger.info("Using cached Xbox user token...");
		userToken = cached.userToken;
		userHash = cached.userHash;
	} else {
		// Fresh login required
		Logger.info("Authenticating with Xbox Live...");

		const accessToken = await freshLogin(email, password);

		// Exchange for Xbox user token (valid ~14 days)
		const userTokenResp = await xnet.exchangeRpsTicketForUserToken(
			accessToken,
			"t",
		);
		userToken = userTokenResp.Token;
		userHash = userTokenResp.DisplayClaims.xui[0].uhs;

		// Cache the user token
		if (cacheFile) {
			saveCache(cacheFile, userToken, userHash, userTokenResp.NotAfter);
		}
	}

	// Get XSTS token for Minecraft Bedrock (short-lived, always fetch fresh)
	const xstsResp = await xnet.exchangeTokenForXSTSToken(userToken, {
		XSTSRelyingParty: MINECRAFT_BEDROCK_RELYING_PARTY,
		sandboxId: "RETAIL",
	});

	const xuid = xstsResp.DisplayClaims.xui[0].xid || "";

	// Get Minecraft Bedrock chains
	const chains = await getMinecraftBedrockChains(
		xstsResp.Token,
		userHash,
		clientPublicKey,
	);
	const gamertag = extractGamertagFromChains(chains);

	Logger.info(`Authenticated as: ${gamertag} (${xuid})`);
	return { chains, xuid, gamertag, userHash };
}

async function freshLogin(email: string, password: string): Promise<string> {
	try {
		const liveToken = await live.authenticateWithCredentials({
			email: email as Email,
			password,
		});
		return liveToken.access_token;
	} catch (error: unknown) {
		const err = error as Error & { attributes?: { code?: string } };

		if (err.attributes?.code === "INVALID_CREDENTIALS_OR_2FA_ENABLED") {
			throw new Error(
				"Authentication failed: Invalid credentials or 2FA is enabled.\n" +
					"Direct email/password login only works with 2FA DISABLED.",
			);
		}

		throw error;
	}
}

async function getMinecraftBedrockChains(
	xstsToken: string,
	userHash: string,
	clientPublicKey: string,
): Promise<string[]> {
	const response = await fetch(
		"https://multiplayer.minecraft.net/authentication",
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `XBL3.0 x=${userHash};${xstsToken}`,
				"Client-Version": "1.21.130",
			},
			body: JSON.stringify({ identityPublicKey: clientPublicKey }),
		},
	);

	if (!response.ok) {
		const text = await response.text();
		if (response.status === 401) {
			throw new Error(
				"Minecraft Bedrock authentication failed (401 UNAUTHORIZED).\n" +
					"This usually means:\n" +
					"  1. The account does not have an Xbox profile (create one at xbox.com)\n" +
					"  2. The account does not own Minecraft Bedrock Edition\n" +
					"  3. The account needs to accept Xbox/Minecraft terms of service",
			);
		}
		throw new Error(
			`Minecraft Bedrock auth failed: ${response.status} - ${text}`,
		);
	}

	const data = (await response.json()) as { chain: string[] };
	return data.chain || [];
}

function extractGamertagFromChains(chains: string[]): string {
	for (const chain of chains) {
		try {
			const [, payload] = chain.split(".");
			if (payload) {
				const decoded = JSON.parse(Buffer.from(payload, "base64").toString());
				if (decoded.extraData?.displayName) {
					return decoded.extraData.displayName;
				}
			}
		} catch {
			/* continue */
		}
	}
	return "";
}

export { live, xnet };
export type { AuthenticateResponse, Email };
