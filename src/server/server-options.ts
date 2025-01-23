import { CompressionMethod, type DataPacket } from "@serenityjs/protocol";
import type { PacketNames } from "../client";
import type * as Protocol from "@serenityjs/protocol";

type Version = "1.21.50";


export type PlayerEvents = {
    [K in PacketNames]: [packet: InstanceType<(typeof Protocol)[K]>];
} & {
    "packet": [DataPacket];
    "error": [Error];
    "login": [];
}


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
}

export const defaultServerOptions: ServerOptions = {
    host: "127.0.0.1",
    port: 19132,
    offline: true,
    version: "1.21.50",
    worker: true,
    maxPlayers: 100,
    compressionMethod: CompressionMethod.Zlib,
    compressionThreshold: 1,
    compressionLevel: 7,
    levelName: "SanctumTerra Server",
}
