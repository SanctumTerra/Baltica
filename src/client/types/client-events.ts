import type * as Protocol from "@serenityjs/protocol";
import type { PacketNames } from "../../shared/types";

type ClientEvents = {
	[K in PacketNames]: [packet: InstanceType<(typeof Protocol)[K]>];
} & {
	session: [];
} & {
	packet: [packet: InstanceType<(typeof Protocol)[PacketNames]>];
	connect: [];
	disconnect: [reason?: string];
	error: [error: Error];
} & {
	[K in `${number}`]: [buffer: Buffer];
};

export type { ClientEvents, PacketNames };
