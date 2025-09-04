import type * as Protocol from "@serenityjs/protocol";
import type { PacketNames } from "../../shared/types";

export type PlayerEvents = {
	[K in PacketNames]: [packet: InstanceType<(typeof Protocol)[K]>];
} & {
	packet: [Protocol.DataPacket];
	error: [Error];
	login: [];
};
