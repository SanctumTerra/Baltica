import { Bool } from "@serenityjs/binarystream";
import { DataPacket } from "@serenityjs/protocol";
import { Proto, Serialize } from "@serenityjs/raknet";

@Proto(129)
export class ClientCacheStatusPacket extends DataPacket {
    @Serialize(Bool)
    public supported!: boolean;
}