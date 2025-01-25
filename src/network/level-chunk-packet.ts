import { Endianness } from "@serenityjs/binarystream";
import { DataPacket, type DimensionType, Packet } from "@serenityjs/protocol";
import { Proto } from "@serenityjs/raknet";

@Proto(Packet.LevelChunk)
class LevelChunkPacket extends DataPacket {
  private static readonly MAX_BLOB_HASHES = 64;

  public x!: number; // ChunkPos
  public z!: number; // ChunkPos
  public dimension!: DimensionType; // Dimension Id
  public subChunkCount!: number;
  public highestSubchunkCount?: number; // Only used when subChunkCount is -2
  public cacheEnabled!: boolean;
  public blobs?: Array<bigint>; // Array of Blob Ids (unsigned int64)
  public data!: Buffer; // Serialized Chunk Data

  public override serialize(): Buffer {
    this.writeUint8(Packet.LevelChunk);
    this.writeZigZag(this.x);
    this.writeZigZag(this.z);
    this.writeZigZag(this.dimension);
    this.writeVarInt(this.subChunkCount);

    if (this.subChunkCount === -2) {
      if (this.highestSubchunkCount === undefined) {
        throw new Error("highestSubchunkCount must be defined when subChunkCount is -2");
      }
      this.writeUint16(this.highestSubchunkCount, Endianness.Little);
    }

    this.writeBool(this.cacheEnabled);

    if (this.cacheEnabled && this.blobs) {
      if (this.blobs.length > LevelChunkPacket.MAX_BLOB_HASHES) {
        throw new Error(`Too many blob hashes: ${this.blobs.length}`);
      }
      this.writeVarInt(this.blobs.length);
      for (const hash of this.blobs) {
        this.writeLong(hash, Endianness.Little);
      }
    }

    this.writeByteArray(this.data);
    return this.getBuffer();
  }

  public override deserialize(): this {
    this.readUint8(); // packet id
    this.x = this.readZigZag();
    this.z = this.readZigZag();
    this.dimension = this.readZigZag();
    this.subChunkCount = this.readVarInt();
    
    if (this.subChunkCount === -2) {
      this.highestSubchunkCount = this.readUint16(Endianness.Little);
    }

    this.cacheEnabled = this.readBool();
    if (this.cacheEnabled) {
      const blobCount = this.readVarInt();
      if (blobCount > LevelChunkPacket.MAX_BLOB_HASHES) {
        throw new Error(`Too many blob hashes: ${blobCount}`);
      }
      this.blobs = [];
      for (let index = 0; index < blobCount; index++) {
        this.blobs.push(this.readLong(Endianness.Little));
      }
    }

    this.data = this.readByteArray();
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