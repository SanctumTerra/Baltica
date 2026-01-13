import {
	authenticate as xboxAuthenticate,
	live,
	xnet,
} from "@xboxreplay/xboxlive-auth";
import type { AuthenticateResponse, Email } from "@xboxreplay/xboxlive-auth";
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
}

const MINECRAFT_BEDROCK_RELYING_PARTY = "https://multiplayer.minecraft.net/";

/**
 * Authenticates with Xbox Live using email/password and obtains Minecraft Bedrock tokens
 * NOTE: Only works if 2FA is DISABLED on the Microsoft account
 */
export async function authenticateWithCredentials(
	options: AuthOptions,
): Promise<BedrockTokens> {
	const { email, password, clientPublicKey } = options;

	Logger.info("Authenticating with Xbox Live...");

	try {
		const liveToken = await live.authenticateWithCredentials({
			email: email as Email,
			password,
		});

		// Exchange for Xbox user token
		const userTokenResp = await xnet.exchangeRpsTicketForUserToken(
			liveToken.access_token,
			"t",
		);
		const userHash = userTokenResp.DisplayClaims.xui[0].uhs;

		// Get XSTS token for Minecraft Bedrock
		const xstsResp = await xnet.exchangeTokenForXSTSToken(userTokenResp.Token, {
			XSTSRelyingParty: MINECRAFT_BEDROCK_RELYING_PARTY,
			sandboxId: "RETAIL",
		});

		const xuid = xstsResp.DisplayClaims.xui[0].xid || "";

		// Get Minecraft Bedrock chains using the client's public key
		const chains = await getMinecraftBedrockChains(
			xstsResp.Token,
			userHash,
			clientPublicKey,
		);
		const gamertag = extractGamertagFromChains(chains);

		Logger.info(`Authenticated as: ${gamertag} (${xuid})`);
		return { chains, xuid, gamertag, userHash };
	} catch (error: unknown) {
		const err = error as Error & {
			attributes?: { code?: string };
			data?: {
				attributes?: {
					extra?: { statusCode?: number; body?: { XErr?: number } };
				};
			};
		};

		if (err.attributes?.code === "INVALID_CREDENTIALS_OR_2FA_ENABLED") {
			throw new Error(
				"Authentication failed: Invalid credentials or 2FA is enabled.\n" +
					"Direct email/password login only works with 2FA DISABLED.",
			);
		}

		// Check for Xbox Live specific errors
		const xErr = err.data?.attributes?.extra?.body?.XErr;
		if (xErr) {
			const xboxErrors: Record<number, string> = {
				2148916233:
					"No Xbox profile exists for this account. Create one at https://xbox.com/live",
				2148916227: "Account banned by Xbox for violating Community Standards.",
				2148916229:
					"Account restricted - guardian permission required. Visit https://account.microsoft.com/family/",
				2148916234:
					"Must accept Xbox Terms of Service. Login at https://xbox.com",
				2148916235: "Account region not authorized by Xbox.",
				2148916236:
					"Account requires age verification. Login at https://login.live.com",
				2148916238: "Account under 18 must be added to a family by an adult.",
			};
			if (xboxErrors[xErr]) {
				throw new Error(`Xbox Live error: ${xboxErrors[xErr]}`);
			}
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

export { xboxAuthenticate as authenticate, live, xnet };
export type { AuthenticateResponse, Email };
