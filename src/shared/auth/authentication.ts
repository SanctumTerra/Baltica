/**
 * Xbox Live Authentication Module
 *
 * Based on the authentication flow from @xboxreplay/xboxlive-auth
 * https://github.com/XboxReplay/xboxlive-auth
 *
 * Modified to support SOCKS5 proxies for all HTTP requests and Minecraft Authentication
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Logger } from "@sanctumterra/raknet";
import { socksDispatcher } from "fetch-socks";
import {
	fetch as undiciFetch,
	type RequestInit as UndiciRequestInit,
} from "undici";

import type { CacheFactory } from "prismarine-auth";
import { FileCache } from "../cache/Filecache";

export interface BedrockTokens {
	chains: string[];
	xuid: string;
	gamertag: string;
	userHash: string;
	xstsToken: string;
	playfabXstsToken: string;
	playfabUserHash: string;
}

export interface ProxyOptions {
	host: string;
	port: number;
	userId?: string;
	password?: string;
}

export interface AuthOptions {
	email: string;
	password: string;
	clientPublicKey: string;
	cacheDir: string | CacheFactory;
	proxy?: ProxyOptions;
	authLogs?: boolean;
}

interface CachedAuth {
	userToken: string;
	userHash: string;
	notAfter: string;
	obtainedOn: number;
}

interface XboxTokenResponse {
	Token: string;
	NotAfter: string;
	DisplayClaims: {
		xui: Array<{ uhs: string; xid?: string; gtg?: string }>;
	};
}

const MINECRAFT_BEDROCK_RELYING_PARTY = "https://multiplayer.minecraft.net/";
const PLAYFAB_RELYING_PARTY = "https://b980a380.minecraft.playfabapi.com/";
const XBOX_AUTH_CLIENT_ID = "00000000441cc96b";

type ProxiedFetch = (
	input: string | URL,
	init?: RequestInit,
) => Promise<Response>;

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

function createProxiedFetch(proxy?: ProxyOptions): ProxiedFetch {
	if (!proxy) {
		return fetch;
	}

	const dispatcher = socksDispatcher({
		type: 5,
		host: proxy.host,
		port: proxy.port,
		userId: proxy.userId,
		password: proxy.password,
	});

	return async (input: string | URL, init?: RequestInit): Promise<Response> => {
		const url = typeof input === "string" ? input : input.toString();
		const response = await undiciFetch(url, {
			...init,
			dispatcher,
		} as unknown as UndiciRequestInit);
		return response as unknown as Response;
	};
}

/**
 * Authenticates with Xbox Live using email/password and obtains Minecraft Bedrock tokens
 * Supports SOCKS5 proxy for all authentication requests
 */
export async function authenticateWithCredentials(
	options: AuthOptions,
): Promise<BedrockTokens> {
	const {
		email,
		password,
		clientPublicKey,
		cacheDir,
		proxy,
		authLogs = true,
	} = options;
	const proxiedFetch = createProxiedFetch(proxy);

	// Verify proxy is working by checking our IP
	if (proxy) {
		try {
			const ipResp = await proxiedFetch("https://api.ipify.org?format=json");
			const ipData = (await ipResp.json()) as { ip: string };
			if (authLogs) Logger.info(`Proxy IP verified: ${ipData.ip}`);
		} catch (e) {
			Logger.warn(
				`Could not verify proxy IP: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}

	let userToken: string;
	let userHash: string;

	const xblUserCache =
		typeof cacheDir === "string"
			? new FileCache(
					path.join(cacheDir, `${hashString(email)}_xbl-user-cache.json`),
				)
			: cacheDir({ username: email, cacheName: "_xbl-user-cache" });
	const cached = (await xblUserCache.getCached()) as CachedAuth | undefined;

	if (
		cached?.userToken &&
		cached?.notAfter &&
		new Date(cached.notAfter) > new Date()
	) {
		if (authLogs) Logger.info("Using cached Xbox user token...");
		userToken = cached.userToken;
		userHash = cached.userHash;
	} else {
		Logger.info(
			`Authenticating with Xbox Live...${proxy ? ` (via proxy ${proxy.host}:${proxy.port})` : ""}`,
		);

		const accessToken = await getMicrosoftAccessToken(
			email,
			password,
			proxiedFetch,
		);

		const userTokenResp = await exchangeRpsTicketForUserToken(
			accessToken,
			proxiedFetch,
		);
		userToken = userTokenResp.Token;
		userHash = userTokenResp.DisplayClaims.xui[0].uhs;

		// Cache the user token for future use
		await xblUserCache.setCached({
			userToken,
			userHash,
			notAfter: userTokenResp.NotAfter,
			obtainedOn: Date.now(),
		} as CachedAuth);
	}

	// Get XSTS token for Minecraft Bedrock
	const xstsResp = await exchangeTokenForXSTSToken(
		userToken,
		MINECRAFT_BEDROCK_RELYING_PARTY,
		proxiedFetch,
	);

	const xuid = xstsResp.DisplayClaims.xui[0].xid || "";

	// Get XSTS token for Playfab (needed for session token)
	const playfabXstsResp = await exchangeTokenForXSTSToken(
		userToken,
		PLAYFAB_RELYING_PARTY,
		proxiedFetch,
	);

	const chains = await getMinecraftBedrockChains(
		xstsResp.Token,
		userHash,
		clientPublicKey,
		proxiedFetch,
	);
	const gamertag = extractGamertagFromChains(chains);

	if (authLogs) Logger.info(`Authenticated as: ${gamertag} (${xuid})`);
	return {
		chains,
		xuid,
		gamertag,
		userHash,
		xstsToken: xstsResp.Token,
		playfabXstsToken: playfabXstsResp.Token,
		playfabUserHash: playfabXstsResp.DisplayClaims.xui[0].uhs,
	};
}

/**
 * Get Microsoft access token using email/password via OAuth flow
 * This implements the full browser-like login flow
 */
async function getMicrosoftAccessToken(
	email: string,
	password: string,
	proxiedFetch: ProxiedFetch,
): Promise<string> {
	const authUrl = "https://login.live.com/oauth20_authorize.srf";
	const params = new URLSearchParams({
		client_id: XBOX_AUTH_CLIENT_ID,
		redirect_uri: "https://login.live.com/oauth20_desktop.srf",
		response_type: "token",
		scope: "service::user.auth.xboxlive.com::MBI_SSL",
		display: "touch",
		locale: "en",
	});

	const preAuthResp = await proxiedFetch(`${authUrl}?${params}`, {
		headers: {
			"User-Agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			Accept:
				"text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
			"Accept-Language": "en-US,en;q=0.5",
		},
	});

	if (!preAuthResp.ok) {
		throw new Error(`Pre-auth request failed: ${preAuthResp.status}`);
	}

	const preAuthHtml = await preAuthResp.text();
	const cookies = extractCookies(preAuthResp.headers);

	const { ppft, urlPost } = extractLoginParams(preAuthHtml);

	const loginBody = new URLSearchParams({
		login: email,
		loginfmt: email,
		passwd: password,
		PPFT: ppft,
		PPSX: "Passpor",
		NewUser: "1",
		FoundMSAs: "",
		fspost: "0",
		i21: "0",
		CookieDisclosure: "0",
		IsFidoSupported: "1",
		isSignupPost: "0",
		isRecoveryAttemptPost: "0",
		i13: "0",
		i19: Math.floor(Math.random() * 100000).toString(),
	});

	const loginResp = await proxiedFetch(urlPost, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			"User-Agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			Cookie: cookies,
			Referer: `${authUrl}?${params}`,
			Origin: "https://login.live.com",
		},
		body: loginBody.toString(),
		redirect: "manual",
	});

	// Check for access token in redirect
	let location = loginResp.headers.get("location") || "";
	const allCookies = `${cookies}; ${extractCookies(loginResp.headers)}`;

	// Follow redirects manually to find the access token
	let attempts = 0;
	while (attempts < 10 && !location.includes("access_token=")) {
		if (!location) {
			// Check if we got an error page
			const responseText = await loginResp.text();
			if (
				responseText.includes("sErrTxt") ||
				responseText.includes("Your account or password is incorrect")
			) {
				throw new Error("Invalid credentials");
			}
			if (
				responseText.includes("Sign in a different way") ||
				responseText.includes("idA_PWD_SwitchToCredPicker")
			) {
				throw new Error(
					"2FA is enabled on this account. Direct login requires 2FA to be disabled.",
				);
			}
			if (responseText.includes("identity/confirm")) {
				throw new Error(
					"Microsoft requires identity confirmation. Please log in via browser first.",
				);
			}
			if (
				responseText.includes("recover?") ||
				responseText.includes("account.live.com/recover")
			) {
				throw new Error(
					"Microsoft requires account recovery. Please verify your account via browser.",
				);
			}

			// Try to extract access token from response body (some flows embed it)
			const tokenMatch = responseText.match(/access_token=([^&"']+)/);
			if (tokenMatch) {
				return decodeURIComponent(tokenMatch[1]);
			}

			// Check for urlPost redirect in response (sometimes login returns another form)
			const urlPostMatch = responseText.match(/urlPost:\s*'([^']+)'/);
			if (urlPostMatch) {
				location = urlPostMatch[1];
				attempts++;
				continue;
			}

			throw new Error(
				"Failed to get redirect URL from login response. " +
					"This can happen due to rate limiting, CAPTCHA, or security challenges. " +
					"Try again in a few minutes or log in via browser first.",
			);
		}

		if (location.includes("access_token=")) {
			break;
		}

		const redirectResp = await proxiedFetch(location, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
				Cookie: allCookies,
			},
			redirect: "manual",
		});

		// Check response body for token if no redirect
		const newLocation = redirectResp.headers.get("location") || "";
		if (!newLocation && !newLocation.includes("access_token=")) {
			const body = await redirectResp.text();
			const tokenMatch = body.match(/access_token=([^&"']+)/);
			if (tokenMatch) {
				return decodeURIComponent(tokenMatch[1]);
			}
		}

		location = newLocation;
		attempts++;
	}

	// Extract access token from URL fragment
	const tokenMatch = location.match(/access_token=([^&]+)/);
	if (tokenMatch) {
		return decodeURIComponent(tokenMatch[1]);
	}

	throw new Error("Failed to obtain access token from Microsoft");
}

function extractCookies(headers: Headers): string {
	const setCookies = headers.get("set-cookie");
	if (!setCookies) return "";

	// Parse and combine cookies
	const cookies: string[] = [];
	const cookieStrings = setCookies.split(/,(?=[^;]*=)/);
	for (const cookieStr of cookieStrings) {
		const match = cookieStr.match(/^([^=]+)=([^;]*)/);
		if (match) {
			cookies.push(`${match[1].trim()}=${match[2]}`);
		}
	}
	return cookies.join("; ");
}

function extractLoginParams(html: string): { ppft: string; urlPost: string } {
	let ppft: string | null = null;

	// Pattern for sFTTag with escaped quotes (JSON format)
	const sFTTagMatch = html.match(/sFTTag":"<input[^>]*value=\\"([^"\\]+)\\"/);
	if (sFTTagMatch) {
		ppft = sFTTagMatch[1];
	}

	// Fallback patterns
	if (!ppft) {
		const ppftPatterns = [
			/sFTTag:'[^']*value="([^"]+)"/,
			/name="PPFT"[^>]*value="([^"]+)"/,
			/value="([^"]+)"[^>]*name="PPFT"/,
			/<input[^>]*name="PPFT"[^>]*value="([^"]+)"/,
			/"sFT"\s*:\s*"([^"]+)"/,
			/sFT:'([^']+)'/,
			/"sFT":"([^"]+)"/,
		];

		for (const pattern of ppftPatterns) {
			const match = html.match(pattern);
			if (match) {
				ppft = match[1];
				break;
			}
		}
	}

	if (!ppft) {
		throw new Error("Failed to extract PPFT token from login page");
	}

	// Extract urlPost
	const urlPostPatterns = [
		/urlPost:\s*'([^']+)'/,
		/urlPost:\s*"([^"]+)"/,
		/"urlPost"\s*:\s*"([^"]+)"/,
	];

	let urlPost = "https://login.live.com/ppsecure/post.srf";
	for (const pattern of urlPostPatterns) {
		const match = html.match(pattern);
		if (match) {
			urlPost = match[1];
			break;
		}
	}

	return { ppft, urlPost };
}

/**
 * Exchange Microsoft access token for Xbox User Token
 */
async function exchangeRpsTicketForUserToken(
	accessToken: string,
	proxiedFetch: ProxiedFetch,
): Promise<XboxTokenResponse> {
	const response = await proxiedFetch(
		"https://user.auth.xboxlive.com/user/authenticate",
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				"x-xbl-contract-version": "1",
			},
			body: JSON.stringify({
				RelyingParty: "http://auth.xboxlive.com",
				TokenType: "JWT",
				Properties: {
					AuthMethod: "RPS",
					SiteName: "user.auth.xboxlive.com",
					RpsTicket: `t=${accessToken}`,
				},
			}),
		},
	);

	if (!response.ok) {
		const text = await response.text();
		throw new Error(
			`Xbox user token exchange failed: ${response.status} - ${text}`,
		);
	}

	return response.json() as Promise<XboxTokenResponse>;
}

/**
 * Exchange Xbox User Token for XSTS Token
 */
async function exchangeTokenForXSTSToken(
	userToken: string,
	relyingParty: string,
	proxiedFetch: ProxiedFetch,
): Promise<XboxTokenResponse> {
	const response = await proxiedFetch(
		"https://xsts.auth.xboxlive.com/xsts/authorize",
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				"x-xbl-contract-version": "1",
			},
			body: JSON.stringify({
				RelyingParty: relyingParty,
				TokenType: "JWT",
				Properties: {
					SandboxId: "RETAIL",
					UserTokens: [userToken],
				},
			}),
		},
	);

	if (!response.ok) {
		const text = await response.text();
		throw new Error(
			`Xbox XSTS token exchange failed: ${response.status} - ${text}`,
		);
	}

	return response.json() as Promise<XboxTokenResponse>;
}

/**
 * Get Minecraft Bedrock authentication chains
 */
async function getMinecraftBedrockChains(
	xstsToken: string,
	userHash: string,
	clientPublicKey: string,
	proxiedFetch: ProxiedFetch,
): Promise<string[]> {
	const response = await proxiedFetch(
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
				"Minecraft Bedrock authentication failed (401).\n" +
					"The account may not have an Xbox profile or Minecraft Bedrock Edition.",
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

// Re-export types for compatibility
export type Email = string;
export interface AuthenticateResponse {
	access_token: string;
	token_type: string;
	expires_in: number;
	scope: string;
	user_id: string;
}
