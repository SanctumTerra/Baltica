# <p align="center"> Baltica 🌊 </p>

<p align="center">
  <img src="https://raw.githubusercontent.com/SanctumTerra/Baltica/master/.extra/logo.png" alt="Baltica Logo" width="200"/>
</p>

<p align="center">
  <em>A blazing fast Minecraft Bedrock toolkit for TypeScript developers</em>
</p>

---

## 🚀 What's New in v0.1.0

Complete rewrite, from the ground up! Here's what makes it awesome:

- **Lightning Fast Performance** - We obsessed over every millisecond to make this as snappy as possible.

- **Full TypeScript Support** - Proper types everywhere, so your IDE will actually help you instead of fighting you.

- **Zero Maintenance Headaches** - Built on top of solid libraries like `@serenityjs/protocol` and `@serenityjs/binarystream` so we don't have to reinvent the wheel.

- **Three-in-one** - Three tools in one package: Server, Client, and Bridge (MITM Proxy)

---

## 📋 Version Support

`0.1.0` → Minecraft Bedrock `1.21.93`

`0.1.8` → Minecraft Bedrock `1.21.100` & `1.21.101`

`0.1.13` → Minecraft Bedrock `1.21.113`


*Note: We dropped multi-version support because honestly, it was more trouble than it was worth. One version, done right.*

---

## 🛠️ Getting Started

### Client Usage

Perfect for creating bots, automation tools, or custom clients:

```typescript
const client = new Client({
  offline: false, // Set to true if you don't want Xbox Live authentication
  username: 'MyAwesomeBot',
  address: "127.0.0.1",
  port: 19132,
});

// Connect and get server info
await client.connect();

// Listen for chat messages
client.on("TextPacket", (packet) => {
  console.log(`Got message: ${packet.message}`);
});

// Send a friendly greeting when connected
client.on("connect", () => {
  const packet = new TextPacket();
   packet.message = 'Hey everyone! 👋';
   packet.needsTranslation = false;
   packet.parameters = [];
   packet.platformChatId = '';
   packet.source = client.username;
   packet.type = TextPacketType.Chat;
   packet.xuid = client.profile.xuid.toString();
   packet.filtered = '';
  client.send(packet.serialize());
});
```

### Server Usage

Want to create your own Minecraft server? We got you:

```typescript
const server = new Server({
  address: "127.0.0.1",
  port: 19132
});

server.start();

server.on("playerConnect", (player) => {
  console.log(`${player.username} is connecting...`);

  player.on("login", () => {
    console.log(`Welcome ${player.username}! 🎉`);
  });
});
```

### Bridge/Proxy Usage

This is where things get spicy - intercept and modify packets on the fly:

```typescript
import { Bridge } from "baltica";

const bridge = new Bridge({
  destination: {
    address: "127.0.0.1", // Your actual server
    port: 19132,
  },
  address: "0.0.0.0", // Proxy address
  port: 19133,        // Proxy port
});

bridge.start();

// Intercept all connections
bridge.on("connect", (player) => {
  console.log(`Player connected through proxy: ${player.client.username}`);

  // Listen to messages going TO the client
  player.on("clientBound-TextPacket", (signal) => {
    console.log(`Server said: ${signal.packet.message}`);
  });

  // Modify messages coming FROM the client
  player.on("serverBound-TextPacket", (signal) => {
    // Add a fun prefix to all messages
    signal.packet.message = `[${player.client.username}]: ${signal.packet.message}`;
    signal.modified = true; // Don't forget this!
  });
});
```

### Using Bridge to get skinData

This example shows how to obtain skinData via bridge and use it with a client.

```typescript
const bridge = new Bridge({
	destination: {
		address: "127.0.0.1",
	   port: 19132,
	},
});
bridge.start();

bridge.on("connect", (player) => {
   setTimeout(() => {
      console.log(player.player.loginPayload as SkinData);
      writeFileSync(`${player.client.username}-skin.json`, JSON.stringify({
         AnimatedImageData: player.player.loginPayload.AnimatedImageData,
         ArmSize: player.player.loginPayload.ArmSize,
         CapeData: player.player.loginPayload.CapeData,
         CapeId: player.player.loginPayload.CapeId,
         CapeImageHeight: player.player.loginPayload.CapeImageHeight,
         CapeImageWidth: player.player.loginPayload.CapeImageWidth,
         CapeOnClassicSkin: player.player.loginPayload.CapeOnClassicSkin,
         PersonaPieces: player.player.loginPayload.PersonaPieces,
         PersonaSkin: player.player.loginPayload.PersonaSkin,
         SkinAnimationData: player.player.loginPayload.SkinAnimationData,
         SkinData: player.player.loginPayload.SkinData,
         SkinGeometryData: player.player.loginPayload.SkinGeometryData,
         SkinGeometryDataEngineVersion: player.player.loginPayload.SkinGeometryDataEngineVersion,
         SkinId: player.player.loginPayload.SkinId,
         SkinImageHeight: player.player.loginPayload.SkinImageHeight,
         SkinImageWidth: player.player.loginPayload.SkinImageWidth,
         PieceTintColors: player.player.loginPayload.PieceTintColors,
         PremiumSkin: player.player.loginPayload.PremiumSkin,
         SkinColor: player.player.loginPayload.SkinColor,
         SkinResourcePatch: player.player.loginPayload.SkinResourcePatch,
         TrustedSkin: player.player.loginPayload.TrustedSkin,
      } as SkinData))
   }, 6000);
})
```

And this is how you could apply it:

```ts
import * as skin from "username-skin.json";

const client = new Client({
   skinData: skin,
});
```

---

## 🤝 Contributing

Found a bug? Have a cool idea? We'd love to hear from you! Open an issue or submit a PR.

---

## 📄 License

This project is licensed under the MIT License - because sharing is caring.

---

<p align="center">
  Made with ❤️ by the SanctumTerra team
</p>
