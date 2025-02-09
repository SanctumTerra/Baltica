import { Logger } from "@sanctumterra/raknet";
import type { TextPacket } from "@serenityjs/protocol";
import { Client, DeviceOS } from "../src/index";

const client = new Client({
	host: "127.0.0.1",
	port: 19132,
	offline: process.argv.includes("offline"),
	version: "1.21.50",
    // Incase you want to use a worker for the Raknet.
	// worker: true,
	deviceOS: DeviceOS.Win10,
    // This method is still in Beta.
	betaAuth: process.argv.includes("betaAuth"),
});

console.time("client.connect");
client.connect().then(() => {
	console.timeEnd("client.connect");
});

client.on("DisconnectPacket", (packet) => {
	console.log(packet);
	cleanup();
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
			Logger.chat(`§e${param1} §eleft the game§r`),
		"chat.type.announcement": () => Logger.chat(`§d[${param1}] ${param2}§r`),
	};
	if (packet?.parameters?.[1]?.includes("Disconnected")) {
		cleanup();
		return;
	}
	const handler = Object.entries(messageTypes).find(([key]) =>
		packet.message.includes(key),
	);
	handler ? handler[1]() : console.log(packet.message);
}

function cleanup() {
	try {
		client.disconnect();
		process.removeAllListeners("SIGINT");
		process.removeAllListeners("SIGTERM");
		process.removeAllListeners("beforeExit");
		process.removeAllListeners("exit");
		process.removeAllListeners("uncaughtException");
		process.removeAllListeners("unhandledRejection");
	} catch (error) {
		console.error("Error during cleanup:", error);
	}
}
