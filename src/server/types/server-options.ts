import { CompressionMethod } from "@serenityjs/protocol";

export type ServerOptions = {
	/** The Address the server should bind to */
	address: string;
	/** The Port the server should bind to */
	port: number;
	/** The maximum amount of players allowed to connect */
	maxPlayers: number;
	/** MOTD of the server */
	motd: string;
	/** Default Level name */
	levelName: string;
	/** Tick rate for the server (Ticks per second) */
	tickRate: number;
	/** Compression Method to use  */
	compressionMethod: CompressionMethod;
	/** Compression Threshhold (size minimum to compress) */
	compressionThreshold: number;
	/** Compression Level to use */
	compressionLevel: number;
};

export const defaultServerOptions: ServerOptions = {
	/** Default Value: 0.0.0.0 */
	address: "0.0.0.0",
	/** Default Value: 20 */
	maxPlayers: 20,
	/** Default Value: 19132 */
	port: 19132,
	/** Default Value: SanctumTerra Server */
	motd: "SanctumTerra Server",
	/** Default Value: Default */
	levelName: "Default",
	/** Default Value: 20 */
	tickRate: 20,
	/** Default Value: 4 */
	compressionLevel: 4,
	/** Default Value: Zlib */
	compressionMethod: CompressionMethod.Zlib,
	/** Compression Threshold */
	compressionThreshold: 1,
} as const;
