import { DataPacket } from "@serenityjs/protocol";
import { Create, Serialize } from "@sanctumterra/raknet";
import { ZigZag } from "@serenityjs/binarystream";

@Create(105)
export class SetDefaultGamemodePacket extends DataPacket {
	@Serialize(ZigZag) public gamemode!: number;
}
