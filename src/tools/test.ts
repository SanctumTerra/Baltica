import { Client } from "../client/client";

const client = new Client({});

client.connect().then(() => {
	client.sendMessage("Hello, world!");
	client.disconnect();
});
