import { Logger } from "@sanctumterra/raknet";
import { Client } from "../client/client";
import type { TextPacket } from "@serenityjs/protocol";

const client = new Client({
    host: "127.0.0.1",
    port: 19132,
    offline: true,
    version: "1.21.50",
    worker: false,
});

console.time("client.connect");
client.connect().then(() => {
    console.timeEnd("client.connect");
    setInterval(() => {
        client.sendMessage(`Raknet is working! ${Date.now()}`);
    }, 50)
});

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
