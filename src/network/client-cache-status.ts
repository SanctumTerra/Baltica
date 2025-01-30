import { Bool } from "@serenityjs/binarystream";
import { DataPacket } from "@serenityjs/protocol";
import { Proto, Serialize } from "@serenityjs/raknet";

@Proto(129)
class ClientCacheStatusPacket extends DataPacket {
	public supported = false;

	public override deserialize(): this {
		this.readVarInt();
		this.supported = this.readBool();
		return this;
	}

	public override serialize(): Buffer {
		this.writeVarInt(129);
		this.writeBool(this.supported);
		return this.getBuffer();
	}

	static create(enabled: boolean): ClientCacheStatusPacket {
		const packet = new ClientCacheStatusPacket();
		packet.supported = enabled;
		return packet;
	}
}

export { ClientCacheStatusPacket };
