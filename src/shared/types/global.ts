import type * as Protocol from "@serenityjs/protocol";

export enum ProtocolList {
	"1.21.50" = 766,
	"1.21.60" = 776,
	"1.21.70" = 786,
	"1.21.80" = 800,
	"1.21.90" = 818,
	"1.21.93" = 819,
	"1.21.100" = 827,
	"1.21.113" = 844,
	"1.21.120" = 859,
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
export type CurrentVersion = "1.21.120";
export const CurrentVersionConst: CurrentVersion = "1.21.120";

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
