import { CompressionMethod, DataPacket, InputMode } from "@serenityjs/protocol";
import type * as Protocol from "@serenityjs/protocol";
import type { Advertisement } from "@sanctumterra/raknet";
import type { SkinData } from "./types/payload";
import { ClientCacheStatusPacket } from "@serenityjs/protocol";

export enum ProtocolList {
	"1.21.50" = 766,
	"1.21.60" = 776,
	"1.21.70" = 786,
	"1.21.80" = 800,
	"1.21.90" = 818,
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
	Linux = 15,
}

/**
 * Checks if client version is higher than the specified version
 * @param clientVersion The client version to check
 * @param targetVersion The version to compare against
 * @returns True if client version is higher than targetVersion
 */
export function versionHigherThan(
	clientVersion: keyof typeof ProtocolList,
	targetVersion: keyof typeof ProtocolList,
): boolean {
	return ProtocolList[clientVersion] > ProtocolList[targetVersion];
}

/**
 * Checks if client version is lower than the specified version
 * @param clientVersion The client version to check
 * @param targetVersion The version to compare against
 * @returns True if client version is lower than targetVersion
 */
export function versionLowerThan(
	clientVersion: keyof typeof ProtocolList,
	targetVersion: keyof typeof ProtocolList,
): boolean {
	return ProtocolList[clientVersion] < ProtocolList[targetVersion];
}

type LoginPacketOptions = {
	DeviceModel: string;
	CurrentInputMode: InputMode;
	DefaultInputMode: InputMode;
};

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
	skinData: SkinData | undefined;
	offline: boolean;
	worker: boolean;
	loginOptions: LoginPacketOptions;
	betaAuth: boolean;
	platformType: number;
	memoryTier: number;
	uiProfile: number;
	graphicsMode: number;
};

const defaultClientOptions: ClientOptions = {
	host: "127.0.0.1",
	port: 19132,
	compressionThreshold: 1,
	compressionMethod: CompressionMethod.Zlib,
	compressionLevel: 7,
	deviceOS: DeviceOS.NintendoSwitch,
	version: "1.21.90",
	username: "SanctumTerra",
	tokensFolder: "tokens",
	viewDistance: 10,
	skinData: undefined,
	offline: false,
	worker: false,
	loginOptions: {
		DeviceModel: "Bean Bag Chair",
		CurrentInputMode: InputMode.GamePad,
		DefaultInputMode: InputMode.GamePad,
	},
	betaAuth: false,
	platformType: 2,
	memoryTier: 2,
	uiProfile: 0,
	graphicsMode: 0,
};

// : Record<number, typeof DataPacket>

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
} & {
	packet: [packet: InstanceType<(typeof Protocol)[PacketNames]>];
	connect: [packet: Advertisement];
};

export {
	type ClientOptions,
	defaultClientOptions,
	type ClientEvents,
	type PacketNames,
};
