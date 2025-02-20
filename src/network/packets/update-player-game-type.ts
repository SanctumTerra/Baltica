import { DataPacket } from "@serenityjs/protocol";
import { Create, Serialize } from "@sanctumterra/raknet";
import { ZigZag, ZigZong, VarLong } from "@serenityjs/binarystream";

@Create(151)
export class UpdatePlayerGameTypePacket extends DataPacket {
	@Serialize(ZigZag) public gameType!: number;
	@Serialize(ZigZong) public uniqueId!: bigint;
	@Serialize(VarLong) public playerGamemode!: bigint;
}
