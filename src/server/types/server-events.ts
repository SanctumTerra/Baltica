import type { Connection } from "@sanctumterra/raknet";
import type { Player } from "../player";

export type ServerEvents = {
	connection: [Connection];
	playerConnect: [Player];
	disconnect: [string, Player];
};
