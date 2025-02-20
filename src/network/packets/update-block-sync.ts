import { BlockPosition, DataPacket, UpdateBlockFlagsType, UpdateBlockLayerType } from "@serenityjs/protocol";
import { Create, Serialize } from "@sanctumterra/raknet";
import { VarInt, ZigZong } from "@serenityjs/binarystream";

@Create(110)
export class UpdateBlockSyncPacket extends DataPacket {
    @Serialize(BlockPosition) public position!: BlockPosition;
    @Serialize(VarInt) public blockRuntimeId!: number;
    @Serialize(VarInt) public flags!: UpdateBlockFlagsType;
    @Serialize(VarInt) public layer!: UpdateBlockLayerType;
    @Serialize(ZigZong) public entityUniqueId!: bigint;
    @Serialize(VarInt) public type!: number;
}