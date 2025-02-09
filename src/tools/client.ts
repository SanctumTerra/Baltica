import { Logger } from "@sanctumterra/raknet";
import { Commands, type TextPacket } from "@serenityjs/protocol";
import { DeviceOS } from "../client";
import { Client } from "../client/client";
import { ClientCacheStatusPacket } from "../network/client-cache-status";

let isDisconnecting = false;

// Cleanup function to ensure proper cleanup
function cleanup() {
	if (isDisconnecting) return;
	isDisconnecting = true;

	try {
		client.disconnect();
		// Remove all process event listeners
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

// Handle process termination signals
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("beforeExit", cleanup);

// Handle uncaught errors
process.on("uncaughtException", (error) => {
	console.error("Uncaught exception:", error);
	cleanup();
});

process.on("unhandledRejection", (error) => {
	console.error("Unhandled rejection:", error);
	cleanup();
});

const client = new Client({
	host: "127.0.0.1",
	port: 19132,
	offline: process.argv.includes("offline"),
	version: "1.21.50",
	// worker: true,
	deviceOS: DeviceOS.Win10,
	betaAuth: process.argv.includes("betaAuth"),
});

console.time("client.connect");
client.connect().then(() => {
	console.timeEnd("client.connect");
	// setInterval(() => {
	// It does not freeze anymore :D
	// client.sendMessage(`Raknet is working! ${Date.now()}`);
	// }, 50);
});

client.on("AvailableCommandsPacket", (packet) => {
	// console.log(packet.commands.find(cmd => cmd.name === "list")?.overloads[0]);
});

if (process.execArgv.includes("--inspect")) {
	client.on("packet", (packet) => {
		console.log(packet);
	});
}
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

client.on("DisconnectPacket", (packet) => {
	console.log(packet);
	cleanup();
});
