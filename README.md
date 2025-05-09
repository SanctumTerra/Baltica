# Baltica

<p align="center">
  <img src="https://raw.githubusercontent.com/SanctumTerra/Baltica/master/.extra/logo.png" alt="Baltica Logo" width="200"/>
</p>

Baltica is a high-performance Minecraft Bedrock Edition networking toolkit built with TypeScript. It serves three main purposes:
1. A powerful bridge/proxy that can modify, intercept, and manipulate network traffic between Minecraft Bedrock clients and servers
2. A robust client library for creating Minecraft Bedrock bots and automated players
3. A flexible server implementation for creating custom Minecraft Bedrock servers

## Features

- 🚀 High-performance packet handling and forwarding
- 🤖 Bot creation and automation
- 🔒 Support for encryption and compression
- 🎮 Multiple protocol version support (1.21.50 - 1.21.80)
- 🌐 Customizable packet manipulation
- 🔄 Packet caching for improved performance
- 📦 Resource pack handling
- 🎯 Event-driven architecture
- 🤝 Multi-client support for running multiple bots
- 🖥️ Custom server implementation
- ⚡ Bun runtime support for enhanced performance

## Prerequisites

- Node.js (v16 or higher recommended) or Bun runtime
- TypeScript
- npm, yarn, or bun

## Installation

### Using Package Manager (Recommended)

```bash
# Using npm
npm install baltica

# Using yarn
yarn add baltica

# Using bun
bun add baltica
```

### From Source

If you want to contribute or modify the source code:

1. Clone the repository:
```bash
git clone https://github.com/yourusername/baltica.git
cd baltica
```

2. Install dependencies:
```bash
# Using npm
npm install

# Using yarn
yarn install

# Using bun
bun install
```

3. Build the project:
```bash
# Using npm
npm run build

# Using yarn
yarn build

# Using bun
bun run build
```

## Quick Start

```typescript
import { Client, Server, Bridge } from 'baltica';

// Create a bot
const bot = new Client({
    host: 'server-address',
    port: 19132,
    version: '1.21.80',
    username: 'MyBot'
});

// Create a server
const server = new Server({
    host: '0.0.0.0',
    port: 19132,
    maxPlayers: 20
});

// Create a bridge
const bridge = new Bridge({
    host: '0.0.0.0',
    port: 19132,
    destination: {
        host: 'target-server.com',
        port: 19132
    }
});
```

## Usage

### Creating a Custom Server

```typescript
import { Server } from './src/server/server';

const server = new Server({
    host: '0.0.0.0',
    port: 19132,
    version: '1.21.80',
    maxPlayers: 20
});

// Handle player connections
server.on('playerConnect', (player) => {
    console.log(`Player ${player.profile.name} connected!`);
    
    // Handle player packets
    player.on('TextPacket', (packet) => {
        // Broadcast chat messages
        if (packet.type === TextPacketType.Chat) {
            server.broadcast(`${player.profile.name}: ${packet.message}`);
        }
    });
});

// Handle disconnections
server.on('disconnect', (displayName, player) => {
    console.log(`Player ${displayName} disconnected`);
});

server.start();
```

### Creating Minecraft Bots

```typescript
import { Client } from './src/client/client';

// Create a basic bot
const bot = new Client({
    host: 'server-address',
    port: 19132,
    version: '1.21.80',
    username: 'MyBot',
    tokensFolder: 'tokens',
    viewDistance: 10
});

// Connect and handle events
await bot.connect();

// Listen for chat messages
bot.on('TextPacket', (packet) => {
    if (packet.type === TextPacketType.Chat) {
        console.log(`${packet.source}: ${packet.message}`);
        
        // Respond to messages
        if (packet.message.startsWith('!hello')) {
            bot.sendMessage('Hello there!');
        }
    }
});

// Handle player movement
bot.on('MovePlayerPacket', (packet) => {
    // React to player movements
    console.log(`Player ${packet.runtimeEntityId} moved to ${packet.position}`);
});
```

### Running Multiple Bots

```typescript
async function createBots(count: number) {
    const bots = [];
    
    for (let i = 0; i < count; i++) {
        const bot = new Client({
            host: 'server-address',
            port: 19132,
            version: '1.21.80',
            username: `Bot${i}`,
            tokensFolder: 'tokens',
            viewDistance: 2,  // Lower view distance for better performance
            worker: true      // Enable worker mode for better performance
        });
        
        await bot.connect();
        bots.push(bot);
    }
    
    return bots;
}

// Create 5 bots
const myBots = await createBots(5);
```

### Basic Bridge Setup

```typescript
import { Bridge } from './src/bridge/bridge';

const bridge = new Bridge({
    host: '0.0.0.0',
    port: 19132,
    destination: {
        host: 'target-server.com',
        port: 19132
    },
    version: '1.21.80',
    maxPlayers: 20
});

bridge.start();
```

## Configuration Options

### Server Options
- `host`: The IP address to bind the server to
- `port`: The port to listen on
- `version`: Minecraft protocol version
- `maxPlayers`: Maximum number of concurrent players
- `motd`: Message of the day

### Client/Bot Options
- `host`: Target server address
- `port`: Target server port
- `version`: Protocol version
- `username`: Bot username
- `tokensFolder`: Directory for authentication tokens
- `viewDistance`: Render distance (lower values improve performance)
- `offline`: Enable offline mode
- `worker`: Enable worker mode for improved performance with multiple bots
- `deviceOS`: Device OS to emulate (defaults to Nintendo Switch)
- `skinData`: Custom skin data for the bot

### Bridge Options
- `host`: The IP address to bind the bridge server to
- `port`: The port to listen on
- `destination`: Target server configuration (host and port)
- `version`: Minecraft protocol version
- `maxPlayers`: Maximum number of concurrent players

## Events

Baltica uses an event-driven architecture across all its components. Each component (Server, Client/Bot, Bridge) emits events that you can listen to for various game events and packet handling.

```typescript
// Example of event handling
client.on('packet', (packet) => {
    // Handle any packet
});

bridge.on('connect', (player) => {
    // Handle player connection
});

server.on('playerConnect', (player) => {
    // Handle new player
});
```

For detailed event documentation, please refer to our [API Documentation](https://github.com/SanctumTerra/Baltica/wiki).

## Performance

Baltica supports both Node.js and Bun runtimes, with Bun offering significant performance improvements:
- Faster startup times
- Lower memory usage
- Better packet processing performance
- Improved concurrent connections handling

To run with Bun:
```bash
bun run start
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Built with [@serenityjs/protocol](https://github.com/SerenityJS/protocol) for Minecraft protocol implementation
- Uses [@sanctumterra/raknet](https://github.com/sanctumterra/raknet) for RakNet networking
