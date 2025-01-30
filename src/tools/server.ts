import { Server } from "../server/server";

const server = new Server({
	port: 19133,
	host: "0.0.0.0",
});

server.start();
