import { CompressionMethod, Framer } from "@serenityjs/protocol";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { Client } from "../client/client";
import type { Player } from "../server";

class PacketCompressor {
	private client: Client | Player;
	constructor(client: Client | Player) {
		this.client = client;
	}

	public decompress(buffer: Buffer): Buffer[] {
		if (buffer[0] !== 0xfe) throw new Error("Invalid packet");

		let packet = buffer.subarray(1);
		if (this.client._encryptionEnabled) {
			packet = this.client.packetEncryptor.decryptPacket(packet);
		}

		const method = this.getMethod(packet[0]);

		if (method !== CompressionMethod.NotPresent) {
			packet = packet.subarray(1);
		}

		const inflated = this.inflate(packet, method);
		return Framer.unframe(inflated);
	}

	public inflate(buffer: Buffer, method: CompressionMethod): Buffer {
		switch (method) {
			case CompressionMethod.Zlib:
				return inflateRawSync(buffer);
			case CompressionMethod.Snappy:
				// I tried but BDS keeps crashing cause of it.
				throw new Error("Snappy compression is not supported <Inflate>");
			default:
				return buffer;
		}
	}

	public compress(
		buffer: Buffer,
		method: CompressionMethod = this.client.options.compressionMethod,
	): Buffer {
		const framed = Framer.frame(buffer);

		const shouldCompress =
			this.client._compressionEnabled &&
			(this.client.options.compressionThreshold === 1 ||
				(this.client.options.compressionThreshold > 1 &&
					framed.byteLength > this.client.options.compressionThreshold));

		let result: Buffer;
		if (shouldCompress) {
			const deflated = this.deflate(
				framed,
				this.client.options.compressionMethod,
			);
			result = Buffer.allocUnsafe(2 + deflated.length);
			result[0] = 0xfe;
			result[1] = this.client.options.compressionMethod;
			deflated.copy(result, 2);
		} else if (this.client._compressionEnabled) {
			// Allocate buffer with exact size needed: 1 (header) + 1 (compression method) + framed length
			result = Buffer.allocUnsafe(2 + framed.length);
			result[0] = 0xfe;
			result[1] = CompressionMethod.None;
			framed.copy(result, 2);
		} else {
			// Allocate buffer with exact size needed: 1 (header) + framed length
			result = Buffer.allocUnsafe(1 + framed.length);
			result[0] = 0xfe;
			framed.copy(result, 1);
		}

		if (this.client._encryptionEnabled) {
			return this.client.packetEncryptor.encryptPacket(result.subarray(1));
		}

		return result;
	}

	public deflate(buffer: Buffer, method: CompressionMethod): Buffer {
		switch (method) {
			case CompressionMethod.Zlib:
				return deflateRawSync(buffer);
			case CompressionMethod.Snappy:
				throw new Error("Snappy compression is not supported <Deflate>");
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
