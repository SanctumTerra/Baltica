import type { PacketNames } from "../../types";
import type * as Protocol from "@serenityjs/protocol";

export type PlayerEvents = {
	[K in PacketNames]: [packet: InstanceType<(typeof Protocol)[K]>];
} & {
	packet: [Protocol.DataPacket];
	error: [Error];
	login: [];
};
