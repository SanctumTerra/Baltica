import {
	Commands,
	InputData,
	TextPacket,
	TextPacketType,
	Vector3f,
} from "@serenityjs/protocol";
import { Bridge } from "../bridge/bridge";
import { ClientCacheStatusPacket } from "../network/client-cache-status";
import type { BridgePlayer } from "../bridge/bridge-player";

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

	player.on("clientbound-AvailableCommandsPacket", (packet) => {
		const symbol =
			packet.commands.find(
				(command) => command.overloads[0].parameters[0].name === "args",
			)?.overloads[0].parameters[0].symbol ?? 124120;
		const command = new Commands(
			"rat",
			"Be a rat.",
			0,
			0,
			-1,
			[],
			[
				{
					chaining: false,
					parameters: [{ symbol, name: "args", optional: true, options: 0 }],
				},
			],
		);
		packet.commands.push(command);
	});

	player.on("serverbound-CommandRequestPacket", (packet) => {
		console.log(packet);
		if (packet.command === "/rat") {
			const text = generateTextPacket(createMessage(player));
			player.player.sendPacket(text);
			packet.command = "";
		}
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

function createMessage(player: BridgePlayer) {
	return `§l§7Custom Command Via Bridge§r\n- §c${player.client.username}§r\n§c${player.bridge.options.levelName}`;
}

function generateTextPacket(message: string) {
	const text = new TextPacket();
	text.message = message;
	text.type = TextPacketType.Chat;
	text.filtered = "";
	text.needsTranslation = false;
	text.parameters = [];
	text.platformChatId = "";
	text.xuid = "";
	text.source = "";
	return text;
}
