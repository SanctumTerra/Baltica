import { Advertisement } from "@sanctumterra/raknet";
import type * as Protocol from "@serenityjs/protocol";
import type { PacketNames } from "../../shared/types";

export type BridgeEventSignal = {
	packet: InstanceType<(typeof Protocol)[PacketNames]>;
	cancelled: boolean;
	modified: boolean;
};

export type BridgePlayerEvents = {
	[K in PacketNames as `clientBound-${K}`]: [
		signal: {
			packet: InstanceType<(typeof Protocol)[K]>;
			cancelled: boolean;
			modified: boolean;
		},
	];
} & {
	[K in PacketNames as `serverBound-${K}`]: [
		signal: {
			packet: InstanceType<(typeof Protocol)[K]>;
			cancelled: boolean;
			modified: boolean;
		},
	];
};
