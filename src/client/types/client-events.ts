import type * as Protocol from "@serenityjs/protocol";
import { Advertisement } from "@sanctumterra/raknet";

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
	type ClientEvents,
	type PacketNames,
};
