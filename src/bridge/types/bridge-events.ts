import type { BridgePlayer } from "../bridge-player";

export type BridgeEvents = {
	connect: [player: BridgePlayer];
	disconnect: [player: BridgePlayer];
};
