import { Create, DataType, Serialize } from "@sanctumterra/raknet";
import { BlockPosition, DataPacket } from "@serenityjs/protocol";
import {
	type BinaryStream,
	VarInt,
	ZigZong,
} from "node_modules/@serenityjs/binarystream";
import { ZigZag } from "@serenityjs/binarystream";

class BlockUpdate extends DataType {
	public position!: BlockPosition;
	public runtimeId!: number;
	public flags!: number;
	public uniqueId!: bigint;
	public type!: number;

	public write(stream: BinaryStream) {
		BlockPosition.write(stream, this.position);
		stream.writeVarInt(this.runtimeId);
		stream.writeVarInt(this.flags);
		stream.writeZigZong(this.uniqueId);
		stream.writeVarInt(this.type);
	}

	public static read(stream: BinaryStream): BlockUpdate {
		const block = new BlockUpdate();
		block.position = BlockPosition.read(stream);
		block.runtimeId = stream.readVarInt();
		block.flags = stream.readVarInt();
		block.uniqueId = stream.readZigZong();
		block.type = stream.readVarInt();
		return block;
	}
}

class SubchunkBlocks extends DataType {
	public blocks: BlockUpdate[] = [];

	public write(stream: BinaryStream) {
		stream.writeVarInt(this.blocks.length);
		for (const block of this.blocks) {
			block.write(stream);
		}
	}

	public static read(stream: BinaryStream): SubchunkBlocks {
		const subchunk = new SubchunkBlocks();
		subchunk.blocks = [];
		const length = stream.readVarInt();
		for (let i = 0; i < length; i++) {
			const block = BlockUpdate.read(stream);
			subchunk.blocks.push(block);
		}
		console.log("Subchunk Blocks");
		console.log(subchunk);
		return subchunk;
	}
}

@Create(172)
export class UpdateSubchunkBlocksPacket extends DataPacket {
	@Serialize(ZigZag) public x!: number;
	@Serialize(ZigZag) public y!: number;
	@Serialize(ZigZag) public z!: number;
	@Serialize(SubchunkBlocks) public blocks!: SubchunkBlocks;
	@Serialize(SubchunkBlocks) public extra!: SubchunkBlocks;
}
