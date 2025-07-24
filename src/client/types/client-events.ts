import type * as Protocol from "@serenityjs/protocol";
import type { Advertisement } from "@sanctumterra/raknet";
import type { PacketNames } from "src/types";

type ClientEvents = {
	[K in PacketNames]: [packet: InstanceType<(typeof Protocol)[K]>];
} & {
	session: [];
} & {
	packet: [packet: InstanceType<(typeof Protocol)[PacketNames]>];
	connect: [packet: Advertisement];
};

export type { ClientEvents, PacketNames };
