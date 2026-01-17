import { CompressionMethod, DeviceOS, InputMode } from "@serenityjs/protocol";
import type { SkinData } from "./payload";

type LoginPacketOptions = {
	/** Device Model (Can be any string) */
	deviceModel: string;
	/** Current input mode (Usually does not matter.) */
	currentInputMode: InputMode;
	/** Default input mode (Usually does not matter) */
	defaultInputMode: InputMode;
	/** DeviceOS of the client. */
	deviceOS: DeviceOS;
	/** Memory Tier for client */
	memoryTier: number;
	/** Platform Type for the client */
	platformType: number;
	/** UIProfile type for the client */
	uiProfile: number;
	/** Graphics mode for the client */
	graphicsMode: number;
};

export type ClientOptions = {
	/** IP Address value of the server.  */
	address: string;
	/** Port value of the server */
	port: number;
	/** Wherther to use online mode of offline mode (Authentication) */
	offline: boolean;
	/** Username is Valid only when client is in offline mode. */
	username: string;
	/** Whether to use a worker(for Raknet) or not. */
	worker: boolean;
	/** Location of the tokens folder. */
	tokensFolder: string;
	/** Skin Data for custom skins (By default we parse it from json)*/
	skinData: SkinData | undefined;
	/** Path to PNG skin file (alternative to skinData) */
	skinFile: string | undefined;
	/** LoginPacket data Customization */
	loginOptions: LoginPacketOptions;
	/** The View Distance of the client.  */
	viewDistance: number;
	/** Compression Threshold (minimum bytes size for compression to do its work) */
	compressionThreshold: number;
	/** Compression Method for the compressor to use. */
	compressionMethod: CompressionMethod;
	/** Whether to emit unknown packets as buffer */
	emitUnknownPackets: boolean;
	/** Email for direct email/password authentication (requires 2FA disabled) */
	email?: string;
	/** Password for direct email/password authentication (requires 2FA disabled) */
	password?: string;
	/** SOCKS5 Proxy for the client to use. */
	proxy?: {
		/** Proxy Host */
		host: string;
		/** Proxy Port */
		port: number;
		/** Proxy Username */
		userId?: string;
		/** Proxy Password */
		password?: string;
	};
};

/** Default Client Options */
export const defaultClientOptions: ClientOptions = {
	/** Default Value: 127.0.0.1 */
	address: "127.0.0.1",
	/** Default Value: false */
	offline: false,
	/** Default Value: 19132 */
	port: 19132,
	/** Default Value: Steve */
	username: "Steve",
	/** Default Value: false */
	worker: false,
	/** Default Value: tokens */
	tokensFolder: "tokens",
	/** Default Value: undefined */
	skinData: undefined,
	/** Default Value: undefined */
	skinFile: undefined,
	loginOptions: {
		/** Default Value: Unknown */
		currentInputMode: InputMode.Unknown,
		/** Default Value: Touch */
		defaultInputMode: InputMode.Touch,
		/** Default Value "Nintendo" */
		deviceModel: "Nintendo",
		/** Default Value: Android */
		deviceOS: DeviceOS.Android,
		/** Default Value: 2 */
		memoryTier: 2,
		/** Default Value: 2 */
		platformType: 2,
		/** Default Value: 2 */
		uiProfile: 0,
		/** Default Value: 0 */
		graphicsMode: 0,
	},
	/** Default Value: 11 */
	viewDistance: 11,
	/** Default Value: 1 */
	compressionThreshold: 1,
	/** Default Value: Zlib */
	compressionMethod: CompressionMethod.Zlib,
	/** Default Value: false */
	emitUnknownPackets: false,
};
