import { Endianness } from "@serenityjs/binarystream";
import { DataPacket, type DimensionType, Packet } from "@serenityjs/protocol";
import { Proto } from "@serenityjs/raknet";

@Proto(Packet.LevelChunk)
class LevelChunkPacket extends DataPacket {
	private static readonly MAX_BLOB_HASHES = 64;
	private static readonly CLIENT_REQUEST_FULL_COLUMN_FAKE_COUNT = 0xffffffff; // PHP_INT_MAX equivalent
	private static readonly CLIENT_REQUEST_TRUNCATED_COLUMN_FAKE_COUNT =
		0xfffffffe; // -2 in unsigned format

	// ChunkPosition fields
	public x!: number;
	public z!: number;

	public dimension!: DimensionType;

	public client_needs_to_request_subchunks!: boolean;
	public client_request_subchunk_limit?: number;
	public sub_chunk_count!: number;
	public partial_subchunk_count_when_requesting?: number;
	public subchunk_count_when_requesting?: number;
	public highest_subchunk_count?: number;

	public cache_enabled!: boolean;
	public blobs?: Array<bigint>; // Blob IDs for cache
	public payload!: Buffer;

	public override serialize(): Buffer {
		this.writeVarInt(Packet.LevelChunk);
		this.writeZigZag(this.x);
		this.writeZigZag(this.z);
		this.writeZigZag(this.dimension);
		this.writeVarInt(this.sub_chunk_count);
		if (this.sub_chunk_count === -2) {
			this.writeUint16(this.highest_subchunk_count ?? 0, Endianness.Little);
		}
		this.writeBool(this.cache_enabled);
		if (this.cache_enabled) {
			if (!this.blobs)
				throw new Error("Blobs required when cache_enabled is true");
			this.writeVarInt(this.blobs.length);
			for (const hash of this.blobs) {
				this.writeUint64(hash, Endianness.Little);
			}
		}
		this.writeByteArray(this.payload);
		return this.getBuffer();
	}

	public override deserialize(): this {
		this.readVarInt(); // packet id
		this.x = this.readZigZag();
		this.z = this.readZigZag();
		this.dimension = this.readZigZag();
		this.sub_chunk_count = this.readVarInt();
		if (this.sub_chunk_count === 4294967294) this.sub_chunk_count = -2;

		if (this.sub_chunk_count === -2) {
			this.highest_subchunk_count = this.readUint16(Endianness.Little);
		}

		this.cache_enabled = this.readBool();
		if (this.cache_enabled) {
			const blobCount = this.readVarInt();
			if (blobCount > LevelChunkPacket.MAX_BLOB_HASHES) {
				throw new Error(`Too many blob hashes: ${blobCount}`);
			}

			this.blobs = [];
			for (let index = 0; index < blobCount; index++) {
				this.blobs.push(this.readLong(Endianness.Little));
			}
		}

		this.payload = this.readByteArray();
		return this;
	}

	private writeByteArray(buffer: Buffer): void {
		this.writeVarInt(buffer.length);
		this.writeBuffer(buffer);
	}

	private readByteArray(): Buffer {
		const length = this.readVarInt();
		return this.readBuffer(length);
	}
}

export { LevelChunkPacket };
