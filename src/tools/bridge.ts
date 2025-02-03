import { InputData, Vector3f } from "@serenityjs/protocol";
import { Bridge } from "../bridge/bridge";
import { ClientCacheStatusPacket } from "../network/client-cache-status";

const bridge = new Bridge({
	host: "0.0.0.0",
	port: 19133,
	destination: {
		host: "127.0.0.1",
		port: 19132,
	},
});
bridge.start();

bridge.on("connect", (player) => {
	player.on("serverbound-InventoryTransactionPacket", (packet) => {
		console.log(packet);
	});
	player.on("serverbound-TextPacket", (packet) => {
		packet.message = `${packet.message}.`;

		// @ts-ignores
		// packet.modified = true;
	});

	player.on("serverbound-PlayerAuthInputPacket", (packet) => {
		packet.inputData.setFlag(InputData.StartSwimming, true);
	});

	// player.on("clientbound-LevelChunkPacket", (packet) => {
	//     console.log(packet);
	// })

	// player.on("serverbound-ResourcePackClientResponsePacket", (packet) => {
	//     player.player.sendPacket(ClientCacheStatusPacket.create(false));
	// })

	// player.on("serverbound-ClientCacheStatusPacket", (packet) => {
	//     console.log(packet);
	// })
});
