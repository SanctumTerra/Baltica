import type * as Protocol from "@serenityjs/protocol";

export enum ProtocolList {
	"1.21.50" = 766,
	"1.21.60" = 776,
	"1.21.70" = 786,
	"1.21.80" = 800,
	"1.21.90" = 818,
	"1.21.93" = 819,
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

export type PacketNames = {
	[K in keyof typeof Protocol]: K extends `${string}Packet`
		? K extends "Packet" | "DataPacket"
			? never
			: K
		: never;
}[keyof typeof Protocol];

/**
 * We do not have multi protocol as of now (Not yet planned either).
 */
export type CurrentVersion = "1.21.93";
export const CurrentVersionConst: CurrentVersion = "1.21.93";

/**
 * Checks if client version is higher than the specified version
 * @param version The client version to check
 * @param targetVersion The version to compare against
 * @returns True if client version is higher than targetVersion
 */
export function versionHigherThan(
	version: keyof typeof ProtocolList,
	targetVersion: keyof typeof ProtocolList,
): boolean {
	return ProtocolList[version] > ProtocolList[targetVersion];
}

/**
 * Checks if client version is lower than the specified version
 * @param version The client version to check
 * @param targetVersion The version to compare against
 * @returns True if client version is lower than targetVersion
 */
export function versionLowerThan(
	version: keyof typeof ProtocolList,
	targetVersion: keyof typeof ProtocolList,
): boolean {
	return ProtocolList[version] < ProtocolList[targetVersion];
}
