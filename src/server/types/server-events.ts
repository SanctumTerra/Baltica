import { Connection } from "@sanctumterra/raknet";
import { Player } from "../player";

export type ServerEvents = {
	connection: [Connection];
	playerConnect: [Player];
	disconnect: [string, Player];
}