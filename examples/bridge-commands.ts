import { type AvailableCommandsPacket, type CommandRequestPacket, Commands, ModalFormRequestPacket, type ModalFormResponsePacket, TextPacket, TextPacketType } from "@serenityjs/protocol";
import { Bridge } from "../src/bridge/bridge";
import type { BridgePlayer } from "../src/bridge/bridge-player";
import { ActionForm } from "@serenityjs/core";
import { Logger } from "@sanctumterra/raknet";

const bridge = new Bridge({
	host: "0.0.0.0",
	port: 19133,
	destination: {
		host: "127.0.0.1",
		port: 19132,
	},
    // This makes the Client offline not the player that connects.
	offline: true
});

bridge.on("connect", (player) => {
	console.log("Player connected: ", player.player?.profile?.name ?? "Unknown");
	player.on("clientbound-AvailableCommandsPacket", (packet, eventStatus) => {
		pushCommand(player, packet);
	});
	player.on("serverbound-CommandRequestPacket", (packet, eventStatus) => {
		handleCommand(player, packet, eventStatus);
	});
});


function pushCommand(player: BridgePlayer, packet: AvailableCommandsPacket) {
	const command = new Commands( "bridge", "Bridge Options.", 0, 1, -1, [], [{
			chaining: false,
			parameters: [],
		},],
	);
	packet.commands.push(command);
}

function handler(
	player: BridgePlayer,
	modal: ModalFormRequestPacket,
	packet: ModalFormResponsePacket,
	eventStatus: { cancelled: boolean, modified: boolean },
) {
	if (packet.id !== modal.id) return;
    const text = generateTextPacket(`Hey ${player.player?.profile?.name ?? player.player.data.payload.ThirdPartyName}`);
    player.player.send(text);   
    // Incase of using Biome Linter.
	// biome-ignore lint/style/noParameterAssign: <explanation>
	eventStatus.cancelled = true;
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

function handleCommand(
	player: BridgePlayer,
	packet: CommandRequestPacket,
	eventStatus: { cancelled: boolean, modified: boolean },
) {
	// biome-ignore lint/style/noParameterAssign: <ring ring>
	eventStatus.cancelled = true;
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
	player.on("serverbound-ModalFormResponsePacket", (packetModal, eventStatusModal) => {
		handler(player, modal, packetModal, eventStatusModal);
	});
}