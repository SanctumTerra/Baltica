import { Logger } from "@sanctumterra/raknet";
import type { TextPacket } from "@serenityjs/protocol";
import { DeviceOS } from "../client";
import { Client } from "../client/client";
import { ClientCacheStatusPacket } from "../network/client-cache-status";

const client = new Client({
	host: "127.0.0.1",
	port: 19132,
	// offline: true,
	version: "1.21.50",
	worker: true,
	deviceOS: DeviceOS.Win10,
});

console.time("client.connect");
client.connect().then(() => {
	console.timeEnd("client.connect");
	setInterval(() => {
		// It does not freeze anymore :D
		// client.sendMessage(`Raknet is working! ${Date.now()}`);
	}, 50);
});

// client.on("packet", (packet) => {
// 	console.log(packet.constructor.name);
// });
if (!process.argv.includes("noLog")) {
	if (!process.argv.includes("pmmp")) {
		client.on("LevelChunkPacket", (packet) => {
			console.log(packet);
		});
	}
	client.on("DisconnectPacket", (packet) => {
		console.log(packet);
	});

	client.on("ClientCacheStatus", (packet) => {
		console.log(packet);
	});

	client.on("ResourcePacksInfoPacket", (packet) => {
		console.log(packet);
	});
}
client.send(ClientCacheStatusPacket.create(false));

client.on("TextPacket", handleTextPacket);
async function handleTextPacket(packet: TextPacket): Promise<void> {
	if (!packet.parameters) return Logger.chat(packet.message);

	const [param1, param2] = packet.parameters;
	const messageTypes = {
		"chat.type.text": () => Logger.chat(`§f<${param1}> ${param2}§r`),
		"multiplayer.player.joined": () =>
			Logger.chat(`§e${param1} §ejoined the game§r`),
		"multiplayer.player.left": () =>
			Logger.chat(`§f${param1} §7left the game§r`),
		"chat.type.announcement": () => Logger.chat(`§d[${param1}] ${param2}§r`),
	};

	const handler = Object.entries(messageTypes).find(([key]) =>
		packet.message.includes(key),
	);
	handler ? handler[1]() : console.log(packet.message);
}
