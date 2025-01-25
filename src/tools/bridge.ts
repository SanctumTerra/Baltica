import { Bridge } from "../bridge/bridge";

const bridge = new Bridge(
    {
        host: "0.0.0.0",
        port: 19133,
        destination: {
            host: "127.0.0.1",
            port: 19132,
        }
    }
);
bridge.start();

bridge.on("connect", (player) => {
    player.on("serverbound-InventoryTransactionPacket", (packet) => {
        console.log(packet);
    })
})