import type * as Protocol from "@serenityjs/protocol";
import type { PacketNames } from "../client";
import type { ClientCacheStatusPacket } from "../network/client-cache-status";
import {
	type ServerOptions,
	defaultServerOptions,
} from "../server/server-options";

export type BridgePlayerEvents = {
	[K in PacketNames as `clientbound-${K}`]: [
		packet: InstanceType<(typeof Protocol)[K]>,
	];
} & {
	[K in PacketNames as `serverbound-${K}`]: [
		packet: InstanceType<(typeof Protocol)[K]>,
	];
} & {
	"serverbound-ClientCacheStatusPacket": [packet: ClientCacheStatusPacket];
};

export type BridgeOptions = ServerOptions & {
	destination: {
		host: string;
		port: number;
	};
};

export const defaultBridgeOptions: BridgeOptions = {
	...defaultServerOptions,
	destination: {
		host: "127.0.0.1",
		port: 19132,
	},
};
