import { CompressionMethod, Framer } from "@serenityjs/protocol";
import type { Client } from "../client/client";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { PacketEncryptor } from "./packet-encryptor";
import type { Player } from "src/server/player";

class PacketCompressor {
    private client: Client | Player;
    constructor(client: Client | Player) {
        this.client = client;
    }
    
    public decompress(buffer: Buffer): Buffer[] {
        if(buffer[0] !== 0xfe) throw new Error("Invalid packet");        

        let packet = buffer.subarray(1);
        if(this.client._encryptionEnabled) {
            packet = this.client.packetEncryptor.decryptPacket(packet);
        }

        const header = packet[0];
        const method = this.getMethod(header);
            
        if (method !== CompressionMethod.NotPresent) {
            packet = packet.subarray(1);
        }

        const inflated = this.inflate(packet, method);
        const framed = Framer.unframe(inflated);
        return framed;
    }

    public inflate(buffer: Buffer, method: CompressionMethod): Buffer {
        switch(method) {
            case CompressionMethod.Zlib:
                return inflateRawSync(buffer);
            case CompressionMethod.Snappy:
                throw new Error("Snappy compression is not supported");
            default:
                return buffer;
        }
    }

    public compress(buffer: Buffer, method: CompressionMethod): Buffer {
        const framed = Framer.frame(buffer);
        if(this.client._encryptionEnabled) {
            return this.client.packetEncryptor.encryptPacket(framed);
        }

        const shouldCompress = framed.byteLength > this.client.options.compressionThreshold && this.client._compressionEnabled;

        const compressed = shouldCompress ? 
        Buffer.concat([
            Buffer.from([this.client.options.compressionMethod]), this.deflate(framed, this.client.options.compressionMethod)
        ]) : this.client._compressionEnabled ? 
        Buffer.concat([Buffer.from([CompressionMethod.None]), framed]) : framed;

		return Buffer.concat([Buffer.from([254]), compressed]);
    }

    public deflate(buffer: Buffer, method: CompressionMethod): Buffer {
        switch(method) {
            case CompressionMethod.Zlib:
                return deflateRawSync(buffer);
            case CompressionMethod.Snappy:
                throw new Error("Snappy compression is not supported");
            default:
                return buffer;
        }
    }

    public getMethod(header: number): CompressionMethod {
        return header in CompressionMethod
			? (header as CompressionMethod)
			: CompressionMethod.NotPresent;
    }

}

export { PacketCompressor };