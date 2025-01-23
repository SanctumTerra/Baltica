import { CompressionMethod } from "@serenityjs/protocol";
import type * as Protocol from "@serenityjs/protocol";

export enum ProtocolList {
    "1.21.50" = 766,
}

export enum DeviceOS {
        Undefined = 0,
        Android = 1,
        IOS = 2,
        OSX = 3,
        FireOS = 4,
        GearVR = 5,
        Hololens = 6,
        Win10 = 7,
        Win32 = 8,
        Dedicated = 9,
        TVOS = 10,
        Orbis = 11,
        NintendoSwitch = 12,
        Xbox = 13,
        WindowsPhone = 14,
}


type ClientOptions = {
    host: string;
    port: number;
    compressionThreshold: number;
    compressionMethod: CompressionMethod;
    compressionLevel: number;
    deviceOS: DeviceOS;
    version: keyof typeof ProtocolList;
    username: string;
    tokensFolder: string;
    viewDistance: number;
    skinData: object | undefined;
    offline: boolean;
    worker: boolean;
}

const defaultClientOptions: ClientOptions = {
    host: "127.0.0.1",
    port: 19132,
    compressionThreshold: 256,
    compressionMethod: CompressionMethod.Zlib,
    compressionLevel: 7,
    deviceOS: DeviceOS.Android,
    version: "1.21.50",
    username: "SanctumTerra",
    tokensFolder: "tokens",
    viewDistance: 10,
    skinData: undefined,
    offline: false,
    worker: false,
}


type PacketNames = {
    [K in keyof typeof Protocol]: K extends `${string}Packet`
            ? K extends "Packet" | "DataPacket"
                    ? never
                    : K
            : never;
}[keyof typeof Protocol];

type ClientEvents = {
    [K in PacketNames]: [packet: InstanceType<(typeof Protocol)[K]>];
} & {
    session: [];
};


export { type ClientOptions, defaultClientOptions, type ClientEvents, type PacketNames };

