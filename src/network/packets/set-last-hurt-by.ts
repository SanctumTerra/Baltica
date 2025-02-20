import { DataPacket } from "@serenityjs/protocol";
import { Create, Serialize } from "@sanctumterra/raknet";
import { VarInt } from "@serenityjs/binarystream";

@Create(96)
export class SetLastHurtByPacket extends DataPacket {
	@Serialize(VarInt) public lastHurtBy!: bigint;
}
