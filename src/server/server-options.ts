import { CompressionMethod, type DataPacket } from "@serenityjs/protocol";
import type * as Protocol from "@serenityjs/protocol";
import type { PacketNames } from "../client";
import type { ClientCacheStatusPacket } from "../network/packets/client-cache-status";

type Version = "1.21.50" | "1.21.60" | "1.21.70" | "1.21.80";

export type PlayerEvents = {
	[K in PacketNames]: [packet: InstanceType<(typeof Protocol)[K]>];
} & {
	packet: [DataPacket];
	error: [Error];
	login: [];
	ClientCacheStatusPacket: [ClientCacheStatusPacket];
};

export type ServerOptions = {
	host: string;
	port: number;
	offline: boolean;
	version: Version;
	worker: boolean;
	maxPlayers: number;
	compressionMethod: CompressionMethod;
	compressionThreshold: number;
	compressionLevel: number;
	levelName: string;
};

export const defaultServerOptions: ServerOptions = {
	host: "127.0.0.1",
	port: 19132,
	offline: true,
	version: "1.21.80",
	worker: true,
	maxPlayers: 100,
	compressionMethod: CompressionMethod.Zlib,
	compressionThreshold: 512,
	compressionLevel: 4,
	levelName: "SanctumTerra Server",
};
