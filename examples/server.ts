import { Server } from "../src/server/server";

// Creates a bare bones server, this does not have the ability of spawning people in just handles the connection and authorisation
const server = new Server({
	port: 19133,
	host: "0.0.0.0",
});

// .start to start the server. kekw
server.start();
