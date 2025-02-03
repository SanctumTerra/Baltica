import * as crypto from "node:crypto";
import { ec as EC } from "elliptic";
import { v4 as uuidv4 } from "uuid-1345";
import * as fs from "node:fs";
import * as path from "node:path";
import * as dns from "node:dns";
import * as http2 from "node:http2";

dns.setDefaultResultOrder("ipv4first");

const connectionPool = new Map<string, http2.ClientHttp2Session>();

const responseCache = new Map<string, { data: unknown; expires: number }>();

const fetchDefaults = {
	headers: {
		"Accept-Encoding": "gzip, deflate, br",
		Connection: "keep-alive",
		"Keep-Alive": "timeout=5, max=1000",
	},
};

interface RequestOptions extends RequestInit {
	headers?: Record<string, string>;
}

interface Http2Response {
	status: number;
	headers: http2.IncomingHttpHeaders;
	data: unknown;
}

async function getOrCreateSession(
	hostname: string,
): Promise<http2.ClientHttp2Session> {
	const existingSession = connectionPool.get(hostname);
	if (existingSession?.destroyed === false) {
		return existingSession;
	}

	const session = http2.connect(`https://${hostname}`, {
		settings: {
			enablePush: false,
			initialWindowSize: 1024 * 1024,
			maxConcurrentStreams: 1000,
		},
	});

	session.on("error", () => {
		connectionPool.delete(hostname);
	});

	session.on("goaway", () => {
		connectionPool.delete(hostname);
	});

	connectionPool.set(hostname, session);
	return session;
}

async function http2Request(
	url: string,
	method: string,
	headers: Record<string, string>,
	body?: string | URLSearchParams,
): Promise<Http2Response> {
	if (method === "GET") {
		const cached = responseCache.get(url);
		if (cached && cached.expires > Date.now()) {
			return {
				status: 200,
				headers: {},
				data: cached.data,
			};
		}
	}

	const parsedUrl = new URL(url);
	const session = await getOrCreateSession(parsedUrl.hostname);

	return new Promise((resolve, reject) => {
		const stream = session.request({
			":method": method,
			":path": `${parsedUrl.pathname}${parsedUrl.search}`,
			...headers,
		});

		let data = Buffer.alloc(0);
		let responseStatus = 500;
		let responseHeaders: http2.IncomingHttpHeaders = {};

		stream.on("response", (headers) => {
			responseStatus = Number(headers[":status"]) || 500;
			responseHeaders = headers;
		});

		stream.on("data", (chunk) => {
			data = Buffer.concat([data, chunk]);
		});

		stream.on("end", () => {
			try {
				const parsedData = JSON.parse(data.toString());
				const result: Http2Response = {
					status: responseStatus,
					headers: responseHeaders,
					data: parsedData,
				};

				if (method === "GET" && result.status === 200) {
					const cacheControl = result.headers["cache-control"];
					if (cacheControl && typeof cacheControl === "string") {
						const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
						const maxAge = maxAgeMatch
							? Number.parseInt(maxAgeMatch[1], 10)
							: 0;
						if (maxAge > 0) {
							responseCache.set(url, {
								data: parsedData,
								expires: Date.now() + maxAge * 1000,
							});
						}
					}
				}

				resolve(result);
			} catch (error) {
				reject(error);
			}
		});

		stream.on("error", (error) => {
			reject(error);
		});

		if (body) {
			stream.end(body instanceof URLSearchParams ? body.toString() : body);
		} else {
			stream.end();
		}
	});
}

async function fetchWithRetry(
	url: string,
	options: RequestOptions = {},
	maxRetries = 2,
	timeout = 5000,
): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	const finalOptions = {
		...fetchDefaults,
		...options,
		signal: controller.signal,
	};

	for (let i = 0; i < maxRetries; i++) {
		try {
			try {
				const result = await http2Request(
					url,
					options.method ?? "GET",
					{ ...fetchDefaults.headers, ...options.headers },
					typeof options.body === "string" ? options.body : undefined,
				);

				clearTimeout(timeoutId);

				return new Response(JSON.stringify(result.data), {
					status: result.status,
					headers: new Headers(result.headers as HeadersInit),
				});
			} catch (http2Error) {
				const response = await fetch(url, finalOptions);
				clearTimeout(timeoutId);

				if (response.status >= 500 || response.status === 429) {
					if (i < maxRetries - 1) {
						await new Promise((resolve) => setTimeout(resolve, 2 ** i * 1000));
						continue;
					}
				}

				return response;
			}
		} catch (error: unknown) {
			clearTimeout(timeoutId);
			if (i === maxRetries - 1) {
				if (error instanceof Error) {
					throw error;
				}
				throw new Error("Unknown error occurred during request");
			}
			if (error instanceof Error && error.name === "AbortError") {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, 2 ** i * 1000));
		}
	}
	throw new Error("Max retries reached");
}

process.on("beforeExit", () => {
	for (const session of connectionPool.values()) {
		session.destroy();
	}
	connectionPool.clear();
	responseCache.clear();
});

function pemToDer(pem: string): Buffer {
	const lines = pem.split("\n").filter((line) => !line.startsWith("-----"));
	const base64Str = lines.join("");
	return Buffer.from(base64Str, "base64");
}

function sign(endpoint: string, body: string, key: EC.KeyPair): string {
	const unixTime = Math.floor(Date.now() / 1000);
	const currentTime = BigInt(unixTime + 11644473600) * BigInt(10000000);
	const currentTimeBuf = Buffer.alloc(8);
	currentTimeBuf.writeBigUInt64BE(currentTime, 0);

	const msg = Buffer.concat([
		Buffer.from([0, 0, 0, 1, 0]),
		currentTimeBuf,
		Buffer.from([0]),
		Buffer.from("POST", "utf8"),
		Buffer.from([0]),
		Buffer.from(endpoint, "utf8"),
		Buffer.from([0, 0]),
		Buffer.from(body, "utf8"),
		Buffer.from([0]),
	]);

	const msgHash = crypto.createHash("sha256").update(msg).digest();
	const signature = key.sign(msgHash);
	const r = signature.r.toArrayLike(Buffer, "be", 32);
	const s = signature.s.toArrayLike(Buffer, "be", 32);

	return Buffer.concat([
		Buffer.from([0, 0, 0, 1]),
		currentTimeBuf,
		r,
		s,
	]).toString("base64");
}

interface ErrorResponse {
	error: string;
	error_description: string;
}

interface OAuth20Connect {
	device_code: string;
	expires_in: number;
	interval: number;
	user_code: string;
	verification_uri: string;
}

interface OAuth20Token {
	token_type: string;
	expires_in: number;
	scope: string;
	access_token: string;
	refresh_token: string;
	user_id: string;
}

interface Claims {
	IssueInstant: string;
	NotAfter: string;
	Token: string;
	DisplayClaims: {
		xui?: Array<{ uhs: string }>;
		[key: string]: unknown;
	};
}

interface TokenData {
	DeviceToken: string;
	TitleToken: Claims;
	UserToken: Claims;
	AuthorizationToken: {
		DisplayClaims: {
			xui: Array<{ uhs: string }>;
		};
		IssueInstant: string;
		NotAfter: string;
		Token: string;
	};
	WebPage: string;
	Sandbox: string;
	UseModernGamertag: boolean;
	Flow: string;
}

interface ChainData {
	chain: string[];
}

interface StoredTokens {
	device_token: string;
	access_token: string;
	authorization_token: string;
	xbox_user_id: string;
	expires_at: number;
	clientX509: string;
	chainData: string[];
}

const CLIENT_IDS = {
	MinecraftNintendoSwitch: "00000000441cc96b",
	MinecraftPlaystation: "000000004827c78e",
	MinecraftAndroid: "0000000048183522",
	MinecraftJava: "00000000402b5328",
	MinecraftIOS: "000000004c17c01a",
	XboxAppIOS: "000000004c12ae6f",
	XboxGamepassIOS: "000000004c20a908",
} as const;

export class Bedrock {
	private readonly clientId = CLIENT_IDS.MinecraftAndroid;
	private readonly clientVersion: string;
	private readonly debug: boolean;
	private readonly clientX509: string | null;
	private chainData: string[] = ["", ""];
	private keyPair: EC.KeyPair | null = null;
	private minecraftKeyPair: {
		privateKey: crypto.KeyObject;
		publicKey: crypto.KeyObject;
	} | null = null;
	private readonly tokensPath: string;
	private tokens: StoredTokens | null = null;

	constructor(clientVersion: string, debug = false, clientX509?: string) {
		this.clientVersion = clientVersion;
		this.debug = debug;
		this.clientX509 = clientX509 || null;
		this.tokensPath = path.join(process.cwd(), "tokens", "tokens.json");
	}

	private shouldLog(): boolean {
		return this.debug && process.argv.includes("logAuth");
	}

	private generateKeyPair(
		curve = "p256",
	):
		| EC.KeyPair
		| { privateKey: crypto.KeyObject; publicKey: crypto.KeyObject } {
		if (curve === "secp384r1" && this.clientX509) {
			try {
				const publicKey = crypto.createPublicKey({
					key: pemToDer(this.clientX509),
					format: "der",
					type: "spki",
				});
				return {
					publicKey,
					privateKey: null as unknown as crypto.KeyObject,
				};
			} catch (error) {
				if (this.shouldLog()) {
					console.warn("Failed to use provided X509 certificate:", error);
				}
			}
		}

		if (curve === "p256") {
			const ec = new EC("p256");
			return ec.genKeyPair();
		}

		const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
			namedCurve: curve,
			publicKeyEncoding: { type: "spki", format: "der" },
			privateKeyEncoding: { type: "pkcs8", format: "der" },
		});

		return {
			privateKey: crypto.createPrivateKey({
				key: privateKey,
				format: "der",
				type: "pkcs8",
			}),
			publicKey: crypto.createPublicKey({
				key: publicKey,
				format: "der",
				type: "spki",
			}),
		};
	}

	private getPublicKeyCoordinates(keyPair: EC.KeyPair): {
		x: string;
		y: string;
	} {
		const pubPoint = keyPair.getPublic();
		const x = Buffer.from(pubPoint.getX().toArray("be", 32)).toString("base64");
		const y = Buffer.from(pubPoint.getY().toArray("be", 32)).toString("base64");
		return { x, y };
	}

	private sign(endpoint: string, body: string, key: EC.KeyPair): string {
		const unixTime = Math.floor(Date.now() / 1000);
		const currentTime = BigInt(unixTime + 11644473600) * BigInt(10000000);
		const currentTimeBuf = Buffer.alloc(8);
		currentTimeBuf.writeBigUInt64BE(currentTime);

		const msg = Buffer.concat([
			Buffer.from([0, 0, 0, 1, 0]),
			currentTimeBuf,
			Buffer.from([0]),
			Buffer.from("POST"),
			Buffer.from([0]),
			Buffer.from(endpoint),
			Buffer.from([0, 0]),
			Buffer.from(body),
			Buffer.from([0]),
		]);

		const msgHash = crypto.createHash("sha256").update(msg).digest();
		const signature = key.sign(msgHash);
		const r = signature.r.toArrayLike(Buffer, "be", 32);
		const s = signature.s.toArrayLike(Buffer, "be", 32);

		return Buffer.concat([
			Buffer.from([0, 0, 0, 1]),
			currentTimeBuf,
			r,
			s,
		]).toString("base64");
	}

	async requestDeviceCode(): Promise<OAuth20Connect> {
		const params = new URLSearchParams({
			client_id: this.clientId,
			scope: "service::user.auth.xboxlive.com::MBI_SSL",
			response_type: "device_code",
		});

		const response = await fetch("https://login.live.com/oauth20_connect.srf", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				"Accept-Language": "en-US",
			},
			body: params,
		});

		if (!response.ok) {
			throw new Error(`Failed to get device code: ${response.status}`);
		}

		const data = (await response.json()) as OAuth20Connect;
		if (this.shouldLog()) {
			console.log("Device Code:", data);
		}
		return data;
	}

	async pollForToken(deviceCode: string): Promise<OAuth20Token> {
		const params = new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			client_id: this.clientId,
			device_code: deviceCode,
		});

		while (true) {
			const response = await fetch("https://login.live.com/oauth20_token.srf", {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: params,
			});

			const data = await response.json();

			if (response.ok) {
				if (this.shouldLog()) {
					console.log("Token Data:", data);
				}
				return data as OAuth20Token;
			}

			if (data.error === "authorization_pending") {
				await new Promise((resolve) => setTimeout(resolve, 5000));
				continue;
			}

			throw new Error(`Failed to get token: ${data.error}`);
		}
	}

	async authenticateDevice(): Promise<string> {
		this.keyPair = this.generateKeyPair("p256") as EC.KeyPair;
		const { x, y } = this.getPublicKeyCoordinates(this.keyPair);

		const body = {
			Properties: {
				AuthMethod: "ProofOfPossession",
				DeviceType: "Android",
				Id: uuidv4(),
				ProofKey: {
					crv: "P-256",
					alg: "ES256",
					use: "sig",
					kty: "EC",
					x,
					y,
				},
				Version: "10",
			},
			RelyingParty: "http://auth.xboxlive.com",
			TokenType: "JWT",
		};

		const bodyStr = JSON.stringify(body);
		const signature = this.sign("/device/authenticate", bodyStr, this.keyPair);

		const response = await fetch(
			"https://device.auth.xboxlive.com/device/authenticate",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-xbl-contract-version": "1",
					Signature: signature,
				},
				body: bodyStr,
			},
		);

		if (!response.ok) {
			throw new Error(`Device authentication failed: ${response.status}`);
		}

		const data = (await response.json()) as Claims;
		if (this.shouldLog()) {
			console.log("Device Auth:", data);
		}
		return data.Token;
	}

	async sisuAuthorize(
		accessToken: string,
		deviceToken: string,
	): Promise<{ userId: string; authToken: string }> {
		if (!this.keyPair) throw new Error("Key pair not initialized");

		const maxRetries = 5;
		const baseDelay = 1000;

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			try {
				const { x, y } = this.getPublicKeyCoordinates(this.keyPair);

				const body = {
					AccessToken: `t=${accessToken}`,
					AppId: this.clientId,
					deviceToken,
					Sandbox: "RETAIL",
					UseModernGamertag: true,
					SiteName: "user.auth.xboxlive.com",
					RelyingParty: "https://multiplayer.minecraft.net/",
					ProofKey: {
						crv: "P-256",
						alg: "ES256",
						use: "sig",
						kty: "EC",
						x,
						y,
					},
				};

				const bodyStr = JSON.stringify(body);
				const signature = this.sign("/authorize", bodyStr, this.keyPair);

				const response = await fetch("https://sisu.xboxlive.com/authorize", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-xbl-contract-version": "1",
						Signature: signature,
					},
					body: bodyStr,
				});

				if (response.status === 503) {
					const delay = baseDelay * 2 ** attempt;
					if (this.shouldLog()) {
						console.log(
							`SISU authorization attempt ${attempt + 1} failed with 503, retrying in ${delay}ms...`,
						);
					}
					await new Promise((resolve) => setTimeout(resolve, delay));
					continue;
				}

				if (!response.ok) {
					throw new Error(`SISU authorization failed: ${response.status}`);
				}

				const data = (await response.json()) as TokenData;
				if (this.shouldLog()) {
					console.log("SISU Auth:", data);
				}

				const xui = data.AuthorizationToken.DisplayClaims.xui[0];
				if (!xui?.uhs) {
					throw new Error("Failed to get user hash string from SISU response");
				}

				return {
					userId: xui.uhs,
					authToken: data.AuthorizationToken.Token,
				};
			} catch (error) {
				if (attempt === maxRetries - 1) {
					throw error;
				}

				const delay = baseDelay * 2 ** attempt;
				if (this.shouldLog()) {
					console.log(
						`SISU authorization attempt ${attempt + 1} failed, retrying in ${delay}ms...`,
						error,
					);
				}
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}

		throw new Error("SISU authorization failed after all retries");
	}

	async authenticateWithMinecraft(
		userId: string,
		authToken: string,
	): Promise<string[]> {
		const keyPair = this.generateKeyPair("secp384r1");
		if (!("privateKey" in keyPair)) {
			throw new Error("Failed to generate Minecraft key pair");
		}
		this.minecraftKeyPair = keyPair;

		const publicKeyDer = this.minecraftKeyPair.publicKey.export({
			type: "spki",
			format: "der",
		});

		const response = await fetch(
			"https://multiplayer.minecraft.net/authentication",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"User-Agent": "MCPE/Android",
					"Client-Version": this.clientVersion,
					Authorization: `XBL3.0 x=${userId};${authToken}`,
				},
				body: JSON.stringify({
					identityPublicKey: publicKeyDer.toString("base64"),
				}),
			},
		);

		if (!response.ok) {
			throw new Error(`Minecraft authentication failed: ${response.status}`);
		}

		const data = (await response.json()) as ChainData;
		if (this.shouldLog()) {
			console.log("Minecraft Auth:", data);
		}

		this.chainData = data.chain;
		return this.chainData;
	}

	async auth(): Promise<boolean> {
		try {
			if ((await this.loadTokens()) && this.tokens) {
				try {
					await this.authenticateWithMinecraft(
						this.tokens.xbox_user_id,
						this.tokens.authorization_token,
					);
					return true;
				} catch (error) {
					if (this.shouldLog()) {
						console.log(
							"Stored tokens are invalid, starting fresh authentication",
						);
					}
				}
			}

			const deviceCodeData = await this.requestDeviceCode();
			console.log(
				`Please enter code ${deviceCodeData.user_code} at ${deviceCodeData.verification_uri}`,
			);

			const tokenData = await this.pollForToken(deviceCodeData.device_code);

			const deviceToken = await this.authenticateDevice();

			const { userId, authToken } = await this.sisuAuthorize(
				tokenData.access_token,
				deviceToken,
			);

			const chainData = await this.authenticateWithMinecraft(userId, authToken);

			await this.saveTokens(
				deviceToken,
				tokenData.access_token,
				authToken,
				userId,
				chainData,
			);

			return true;
		} catch (error) {
			console.error("Authentication failed:", error);
			return false;
		}
	}

	getChainData(): string[] {
		return [...this.chainData];
	}

	getMinecraftKeyPair(): {
		privateKey: crypto.KeyObject;
		publicKey: crypto.KeyObject;
	} | null {
		return this.minecraftKeyPair;
	}

	private async loadTokens(): Promise<boolean> {
		try {
			await fs.promises.mkdir(path.dirname(this.tokensPath), {
				recursive: true,
			});

			try {
				const data = await fs.promises.readFile(this.tokensPath, "utf8");
				const tokens = JSON.parse(data) as StoredTokens;

				const now = Math.floor(Date.now() / 1000);
				if (tokens.expires_at > now + 300) {
					this.tokens = tokens;
					this.chainData = tokens.chainData;
					if (this.shouldLog()) {
						console.log("Loaded valid tokens from file");
					}
					return true;
				}
			} catch (error) {
				await fs.promises.writeFile(this.tokensPath, "{}");
			}
		} catch (error) {
			if (this.shouldLog()) {
				console.warn("Failed to load tokens:", error);
			}
		}
		return false;
	}

	private async saveTokens(
		deviceToken: string,
		accessToken: string,
		authToken: string,
		userId: string,
		chainData: string[],
	): Promise<void> {
		try {
			const tokens: StoredTokens = {
				device_token: deviceToken,
				access_token: accessToken,
				authorization_token: authToken,
				xbox_user_id: userId,
				expires_at: Math.floor(Date.now() / 1000) + 86400,
				clientX509: this.clientX509 || "",
				chainData,
			};

			await fs.promises.mkdir(path.dirname(this.tokensPath), {
				recursive: true,
			});
			await fs.promises.writeFile(
				this.tokensPath,
				JSON.stringify(tokens, null, 2),
			);

			if (this.shouldLog()) {
				console.log("Saved tokens to file");
			}
		} catch (error) {
			if (this.shouldLog()) {
				console.warn("Failed to save tokens:", error);
			}
		}
	}
}
