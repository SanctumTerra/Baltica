import { Create, Serialize } from "@sanctumterra/raknet";
import { DataPacket, Vector3f } from "@serenityjs/protocol";
import { VarLong, Bool } from "@serenityjs/binarystream";

@Create(157)
export class MotionPredictHintsPacket extends DataPacket {
	@Serialize(VarLong) public hints!: bigint;
	@Serialize(Vector3f) public position!: Vector3f;
	@Serialize(Bool) public onGround!: boolean;
}
