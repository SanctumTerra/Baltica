import { defaultServerOptions, type ServerOptions } from "../../index";

export type BridgeOptions = ServerOptions & {
	destination: {
		address: string;
		port: number;
	};
	offline: boolean;
};

export const defaultBridgeOptions: BridgeOptions = {
	...defaultServerOptions,
	destination: {
		address: "193.180.211.84",
		port: 19132,
	},
	offline: false,
};
