import type { Advertisement } from "@sanctumterra/raknet";
import type * as Protocol from "@serenityjs/protocol";
import type { PacketNames } from "../../shared/types";

type ClientEvents = {
	[K in PacketNames]: [packet: InstanceType<(typeof Protocol)[K]>];
} & {
	session: [];
} & {
	packet: [packet: InstanceType<(typeof Protocol)[PacketNames]>];
	connect: [];
} & {
	// 0 - 255 : [buffer: Buffer]
	// 256 - 65535 : [buffer: Buffer]
	[K in `${number}`]: [buffer: Buffer];
};

export type { ClientEvents, PacketNames };
