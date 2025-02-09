import type { BridgePlayer } from "../bridge/bridge-player";
import { Bridge } from "../bridge/bridge";
import {
	type AvailableCommandsPacket,
	type CommandRequestPacket,
	Commands,
	ModalFormRequestPacket,
	type ModalFormResponsePacket,
	type SetCommandsEnabledPacket,
	type StartGamePacket,
	TextPacket,
	TextPacketType,
} from "@serenityjs/protocol";
import { ActionForm } from "@serenityjs/core";
import { Logger } from "@sanctumterra/raknet";
import { inspect } from "node:util";

const bridge = new Bridge({
	host: "0.0.0.0",
	port: 19133,
	destination: {
		host: "127.0.0.1",
		// host: "zeqa.net",
		port: 19132,
	},
	offline: true,
});

bridge.on("connect", (player) => {
	console.log("Player connected: ", player.player?.profile?.name ?? "Unknown");
	player.on("clientbound-AvailableCommandsPacket", (packet) => {
		pushCommand(player, packet);
	});
	player.on("serverbound-CommandRequestPacket", (packet, cancelled) => {
		handleCommand(player, packet, cancelled);
	});
	player.on("clientbound-StartGamePacket", (packet) => {
		handleStartGame(player, packet);
	});
	player.on("serverbound-SetCommandsEnabledPacket", (packet) => {
		handleSetCommandsEnabled(player, packet);
	});
	player.on("serverbound-TextPacket", (packet) => {
		console.log(packet);
		packet.message += ".";
	});
});

bridge.start();

function handleSetCommandsEnabled(
	player: BridgePlayer,
	packet: SetCommandsEnabledPacket,
) {
	console.log(
		"Player set commands enabled: ",
		player.player?.profile?.name ?? "Unknown",
	);
	packet.enabled = true;
}

function handleStartGame(player: BridgePlayer, packet: StartGamePacket) {
	// console.log(
	// 	"Player started game: ",
	// 	player.player?.profile?.name ?? "Unknown",
	// );
	packet.achievementsDisabled = true;
	packet.hardcore = true;
	packet.commandsEnabled = true;
	// packet.
}

function handleCommand(
	player: BridgePlayer,
	packet: CommandRequestPacket,
	cancelled: boolean,
) {
	// biome-ignore lint/style/noParameterAssign: <ring ring>
	cancelled = true;
	const allowed = ["/bridge"];
	console.log(packet.command);
	if (!allowed.includes(packet.command)) return;
	Logger.info(
		`${player.player?.profile?.name ?? "Unknown"} is trying to use /bridge`,
	);
	const rand = (max: number) => Math.floor(Math.random() * max);
	const form = new ActionForm();
	form.title = "Bridge Options";
	form.content = "Choose an option";
	form.button("Stop Bridge");
	form.button("Do Nothing");
	const modal = new ModalFormRequestPacket();
	const payload = JSON.stringify(form);

	modal.id = rand(10000);
	modal.payload = payload;
	player.player.send(modal);
	player.on("serverbound-ModalFormResponsePacket", (packet, cancelled) => {
		handler(player, modal, packet, cancelled);
	});
}

function handler(
	player: BridgePlayer,
	modal: ModalFormRequestPacket,
	packet: ModalFormResponsePacket,
	cancelled: boolean,
) {
	if (packet.id !== modal.id) return;
	const text = generateTextPacket("Hello");
	player.player.send(text);

	// biome-ignore lint/style/noParameterAssign: <explanation>
	cancelled = true;
}

function pushCommand(player: BridgePlayer, packet: AvailableCommandsPacket) {
	// console.log(inspect(packet.commands, { depth: null }));
	const command = new Commands(
		"bridge",
		"Bridge Options.",
		0,
		1,
		-1,
		[],
		[
			{
				chaining: false,
				parameters: [],
			},
		],
	);

	// packet.enumConstraints = [];

	// console.log(inspect(packet, { depth: null, colors: true }));
	packet.commands.push(command);
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
