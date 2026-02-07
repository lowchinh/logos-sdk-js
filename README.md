# Logos SDK (JS/TS)

Official SDK for connecting to the Logos backend, supporting WebSocket communication, Intelligent Voice Activity Detection (VAD), and audio stream processing.

## Installation

### Option A: Install via Git (Recommended)
If the SDK is hosted on a private or public Git repository, you can install it directly:

```bash
npm install git+https://github.com/your-org/logos-sdk-js.git
```

### Option B: Local Development Installation
If you are using it in another local project, you can use `npm link` or point directly to the path:

```bash
npm install ../path/to/logos-sdk-js
```

## Quick Start

```typescript
import { LogosClient } from '@aidoll/logos-sdk';

const client = new LogosClient({
  serverUrl: 'http://localhost:8000',
  apiKey: 'your-api-key',
  mode: 'trading', 
});

// Listen for AI text responses
client.on('text', ({ aiText, isFinal }) => {
  console.log('AI Response:', aiText);
});

// Listen for AI speech requests
client.on('audio', ({ text }) => {
  console.log('Play Speech:', text);
  // Call TTS here to play the audio
});

// Listen for status changes
client.on('status', (status) => {
  console.log('Current Status:', status);
});

// Connect and start listening
client.connect();
client.startListening();
```

## API Reference

### Configuration (LogosClientOptions)
- `serverUrl`: Backend API URL.
- `apiKey`: Authentication key.
- `mode`: Persona mode ('trading').
- `vad`: VAD configuration (sensitivity, timeout, etc.).

### Methods
- `connect()`: Establishes the connection.
- `disconnect()`: Disconnects and releases resources.
- `startListening()`: Starts microphone monitoring.
- `stopListening()`: Stops microphone monitoring.
- `sendText(text)`: Sends a plain text command.

### Events
- `connected`: Successfully connected.
- `disconnected`: Connection lost.
- `text`: Received text stream.
- `audio`: Received audio/speech command.
- `status`: SDK status synchronization.
- `error`: Error handling.
