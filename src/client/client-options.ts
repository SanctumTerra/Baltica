import { CompressionMethod, DataPacket, InputMode } from "@serenityjs/protocol";
import type * as Protocol from "@serenityjs/protocol";
import type { ClientCacheStatusPacket } from "../network/packets/client-cache-status";
import type { Advertisement } from "@sanctumterra/raknet";
import {
	AddPaintingPacket,
	UpdateSubchunkBlocksPacket,
	MotionPredictHintsPacket,
	SetLastHurtByPacket,
	SetDefaultGamemodePacket,
	UpdatePlayerGameTypePacket,
	UpdateBlockSyncPacket,
} from "../network/packets";
import { LevelChunkPacket } from "../network/packets/level-chunk-packet";
import type {SkinData} from "./types/payload";

export enum ProtocolList {
	"1.21.50" = 766,
	"1.21.60" = 776,
	"1.21.70" = 786,
	"1.21.80" = 800,
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
	version: "1.21.80",
	username: "SanctumTerra",
	tokensFolder: "tokens",
	viewDistance: 10,
	skinData: undefined,
	offline: false,
	worker: false,
	loginOptions: {
		DeviceModel: "Beans something something",
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
	ClientCacheStatusPacket: [
		packet: InstanceType<typeof ClientCacheStatusPacket>,
	];
	UpdateSubchunkBlocksPacket: [
		packet: InstanceType<typeof UpdateSubchunkBlocksPacket>,
	];
	MotionPredictHintsPacket: [
		packet: InstanceType<typeof MotionPredictHintsPacket>,
	];
	SetLastHurtByPacket: [packet: InstanceType<typeof SetLastHurtByPacket>];
	SetDefaultGamemodePacket: [
		packet: InstanceType<typeof SetDefaultGamemodePacket>,
	];
	UpdatePlayerGameTypePacket: [
		packet: InstanceType<typeof UpdatePlayerGameTypePacket>,
	];
	UpdateBlockSyncPacket: [packet: InstanceType<typeof UpdateBlockSyncPacket>];
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

export const ExtraPackets = {
	[58]: LevelChunkPacket,
	[22]: AddPaintingPacket,
	[172]: UpdateSubchunkBlocksPacket,
	[157]: MotionPredictHintsPacket,
	[96]: SetLastHurtByPacket,
	[105]: SetDefaultGamemodePacket,
	[151]: UpdatePlayerGameTypePacket,
	[110]: UpdateBlockSyncPacket,
};
