import * as crypto from "node:crypto";
import type { Client } from "../client/client";
import type { Player } from "../server";

class PacketEncryptor {
	static instance: PacketEncryptor;

	public secretKeyBytes: Uint8Array;
	public compressionThreshold: number;
	public sendCounter: bigint;
	public receiveCounter: bigint;
	public cipher: crypto.CipherGCM | null;
	public decipher: crypto.DecipherGCM | null;
	public client: Client | Player;

	constructor(client: Client | Player, iv: Buffer) {
		this.secretKeyBytes = new Uint8Array(client.secretKeyBytes);
		this.compressionThreshold = client.options.compressionThreshold;
		this.sendCounter = 0n;
		this.receiveCounter = 0n;
		this.cipher = null;
		this.decipher = null;
		this.client = client;

		this.initializeCipher(client.iv);
		this.initializeDecipher(client.iv);
	}

	destroy() {
		this.cipher = null;
		this.decipher = null;
	}

	initializeCipher(iv: Buffer) {
		if (this.cipher) return;
		this.cipher = crypto.createCipheriv(
			"aes-256-gcm",
			new Uint8Array(this.secretKeyBytes),
			new Uint8Array(iv.slice(0, 12)),
		) as crypto.CipherGCM;
	}

	initializeDecipher(iv: Buffer) {
		if (this.decipher) return;
		this.decipher = crypto.createDecipheriv(
			"aes-256-gcm",
			new Uint8Array(this.secretKeyBytes),
			new Uint8Array(iv.slice(0, 12)),
		) as crypto.DecipherGCM;
	}

	public createCipher(
		secret: Buffer,
		initialValue: Buffer,
		cipherAlgorithm: crypto.CipherGCMTypes,
	) {
		if (crypto.getCiphers().includes(cipherAlgorithm)) {
			return crypto.createCipheriv(
				cipherAlgorithm,
				new Uint8Array(secret),
				new Uint8Array(initialValue),
			);
		}
	}

	computeCheckSum(packetPlaintext: Buffer, counter: bigint) {
		const digest = crypto.createHash("sha256");
		const counterBuffer = Buffer.alloc(8);
		counterBuffer.writeBigInt64LE(counter, 0);
		digest.update(new Uint8Array(counterBuffer));
		digest.update(new Uint8Array(packetPlaintext));
		digest.update(this.secretKeyBytes);
		const hash = digest.digest();
		return Buffer.from(new Uint8Array(hash.slice(0, 8)));
	}

	encryptPacket(framed: Buffer): Buffer {
		const checksum = this.computeCheckSum(framed, this.sendCounter);
		const packetToEncrypt = Buffer.concat([framed, checksum]);

		if (!this.cipher) {
			throw new Error("Cipher not initialized");
		}
		const encryptedPayload = this.cipher.update(packetToEncrypt);

		this.sendCounter++;

		const payload = Buffer.concat([Buffer.from([254]), encryptedPayload]);

		return payload;
	}

	decryptPacket(encryptedPayload: Buffer): Buffer {
		if (!this.decipher) {
			throw new Error("Decipher not initialized");
		}

		const decrypted = this.decipher.update(encryptedPayload);
		const packet = decrypted.slice(0, decrypted.length - 8);
		const receivedChecksum = decrypted.slice(decrypted.length - 8);

		const computedChecksum = this.computeCheckSum(packet, this.receiveCounter);

		this.receiveCounter++;
		if (!receivedChecksum.equals(computedChecksum)) {
			throw new Error("Checksum mismatch");
		}
		return packet;
	}
}

export { PacketEncryptor };
