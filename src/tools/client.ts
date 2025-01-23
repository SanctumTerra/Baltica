import { Client } from "../client/client";

const client = new Client({
    host: "127.0.0.1",
    port: 19132,
    offline: true,
    version: "1.21.50",
    worker: true,
});

console.time("client.connect");
client.connect().then(() => {
    console.timeEnd("client.connect");
    setInterval(() => {
        client.sendMessage("Raknet is working!");
    }, 550)
});
