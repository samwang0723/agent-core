# Agent Core

Agent Core is a robust, AI-powered agent framework built with TypeScript, Hono, and the Mastra agent platform. It provides a foundation for building complex conversational AI applications with support for multiple AI models, authentication, and long-term memory.

## Features

- **Conversational AI:** Advanced chat system with streaming (SSE) and standard JSON responses
- **Real-time Events:** Pusher-based WebSocket notifications for calendar conflicts and system events
- **Calendar Intelligence:** Sophisticated conflict detection and notification system
- **Multi-Agent System:** Specialized agents with vNext network orchestration
- **MCP Integration:** Full Model Context Protocol support with multiple server integrations
- **Multi-Model Support:** Anthropic, OpenAI, and Google AI model integration
- **Memory Management:** Optimized conversation history with 30s TTL caching
- **Authentication:** Google OAuth 2.0 with session-based authentication
- **Internationalization:** 10+ language support with automatic locale detection
- **Tool Ecosystem:** Google Calendar, Gmail, Jira, Confluence, web search, Reddit, and more
- **Performance Optimized:** Comprehensive timing instrumentation and caching
- **Microservice Architecture:** PostgreSQL/TimescaleDB, Redis, and containerized MCP servers

## Project Structure

### Core Components

- **`src/app/`**: Hono-based REST API server with domain services
  - Authentication, chat endpoints, health checks, events
  - Calendar, email, user management, embeddings systems
  - Real-time event processing and conflict detection
- **`src/mastra/`**: Mastra agent framework with AI orchestration
  - Specialized agents, memory management, model integration
  - Local and remote tool systems with MCP protocol
  - vNext network orchestration for intelligent routing
- **`deployment/`**: Docker Compose infrastructure
  - PostgreSQL/TimescaleDB, Redis, MCP servers

### Domain Services

- **Calendar System**: Google Calendar integration with conflict detection
- **Email System**: Gmail integration for email operations
- **Event System**: Real-time notifications and subscription management
- **Embeddings**: Vector search and semantic capabilities
- **User Management**: Authentication and session handling

## Prerequisites

Before you begin, ensure you have the following installed:

- [Bun](https://bun.sh/)
- [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/)

## Environment Variables

To run the application, you need to create a `.env` file in the root of the project. Copy the `.env.example` file (if it exists) or create a new one with the following variables:

## Getting Started

1.  **Clone the repository:**

    ```sh
    git clone <repository-url>
    cd agent-core
    ```

2.  **Set up environment variables:**
    Create a `.env` file and populate it with the necessary values as described above.

3.  **Start dependent services:**
    This will start PostgreSQL/TimescaleDB, Redis, and MCP servers.

    ```sh
    docker-compose -f deployment/docker-compose.yml up -d
    ```

4.  **Install dependencies:**
    ```sh
    bun install
    ```

## Running the Application

### Development

To run the application in development mode with live reloading:

```sh
bun run dev        # Start API server on port 3000
bun run dev:mastra # Start Mastra development on port 4111
```

### Build

```sh
bun run build        # Build application to ./dist
bun run build:mastra # Build Mastra framework
```

### Code Quality

```sh
# Format code
bun run format        # Write formatting changes
bun run format:check  # Check formatting only

# Lint code
bun run lint          # Run linting
bun run lint:fix      # Fix linting issues automatically
```

### Production

```sh
bun run build        # Build application to ./dist
bun run build:mastra # Build Mastra framework

bun ./dist/index.js
npx trigger.dev@latest dev # Start trigger.dev jobs
```

The builds will be created in the respective `dist/` directories. You'll need a production start script to run the built files.

## Internationalization

Agent Core supports multiple languages with automatic locale detection. The AI will respond in the user's preferred language based on:

### Supported Languages

- **English (en)** - Default
- **Spanish (es)** - Español
- **French (fr)** - Français
- **German (de)** - Deutsch
- **Chinese (zh)** - 中文
- **Japanese (ja)** - 日本語
- **Korean (ko)** - 한국어
- **Portuguese (pt)** - Português
- **Italian (it)** - Italiano
- **Russian (ru)** - Русский

### Locale Detection Priority

1. **Query Parameters**: `?locale=es` or `?lang=fr`
2. **Custom Headers**: `X-Locale: zh` or `X-Language: ja`
3. **Accept-Language Header**: Standard HTTP header with quality values
4. **Default**: Falls back to English if no locale is detected

### Usage Examples

```bash
# Using query parameter
curl -X POST "http://localhost:3000/api/v1/chat?locale=es" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{"message": "Hello, how are you?"}'

# Using custom header
curl -X POST "http://localhost:3000/api/v1/chat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -H "X-Locale: fr" \
  -d '{"message": "Hello, how are you?"}'

# Using Accept-Language header
curl -X POST "http://localhost:3000/api/v1/chat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -H "Accept-Language: de-DE,de;q=0.9,en;q=0.8" \
  -d '{"message": "Hello, how are you?"}'
```

The AI will automatically respond in the detected language (Spanish, French, or German respectively) while maintaining natural, fluent communication.

## API Endpoints

The API is versioned and all endpoints are prefixed with `/api/v1`.

### Authentication

| Method | Endpoint                | Description                             |
| :----- | :---------------------- | :-------------------------------------- |
| `GET`  | `/auth/google`          | Initiates Google OAuth 2.0 login.       |
| `GET`  | `/auth/google/callback` | Callback for Google OAuth 2.0.          |
| `POST` | `/auth/token`           | Exchange auth code for an access token. |
| `POST` | `/auth/logout`          | Invalidates the user's session.         |
| `GET`  | `/auth/me`              | Get the current user's profile.         |
| `GET`  | `/auth/session`         | Get the current session details.        |

### Chat

_Authentication is required for all chat endpoints._

| Method   | Endpoint        | Description                                      |
| :------- | :-------------- | :----------------------------------------------- |
| `POST`   | `/chat`         | Send a message for a standard JSON response.     |
| `POST`   | `/chat/stream`  | Send a message for a streaming (SSE) response.   |
| `GET`    | `/chat/history` | Get the conversation history for the user.       |
| `DELETE` | `/chat/history` | Delete the conversation history for the user.    |
| `POST`   | `/chat/init`    | Initialize the chat memory for the user session. |

### Events

_Authentication is required for event endpoints._

| Method | Endpoint         | Description                          |
| :----- | :--------------- | :----------------------------------- |
| `POST` | `/events/detect` | Trigger calendar conflict detection. |
| `GET`  | `/events/status` | Get event processing status.         |

#### Chat Request Headers

Both `/chat` and `/chat/stream` endpoints support the following optional headers for localization:

- `X-Locale` or `X-Language`: Set preferred language (e.g., `es`, `fr`, `zh`)
- `Accept-Language`: Standard HTTP header for language preference
- `X-Client-Timezone`: User's timezone for context (e.g., `America/New_York`)

#### Chat Query Parameters

- `locale` or `lang`: Set preferred language (e.g., `?locale=es`)

#### Request Body

```json
{
  "message": "Your message here"
}
```

#### Response Format

**Standard JSON Response (`/chat`):**

```json
{
  "response": "AI response text",
  "userId": "user-id"
}
```

**Streaming Response (`/chat/stream`):**
Server-Sent Events (SSE) format with events:

- `start`: Session initialization
- `chunk`: Text chunks as they're generated
- `finish`: Completion signal
- `error`: Error information

### System

| Method | Endpoint  | Description                               |
| :----- | :-------- | :---------------------------------------- |
| `GET`  | `/health` | Get the health status of the application. |

## Real-time Features

### Calendar Conflict Detection

The system automatically detects calendar conflicts and sends real-time notifications via Pusher WebSocket:

- **Conflict Detection Service**: Intelligent analysis of calendar events
- **Batch Processing**: Efficient handling of multiple calendar operations
- **Real-time Notifications**: Instant alerts via WebSocket connections
- **Event Subscriptions**: Customizable notification preferences

### WebSocket Events

Connect to Pusher channels to receive real-time updates:

```javascript
// Subscribe to calendar conflict notifications
const pusher = new Pusher('your-pusher-key', {
  cluster: 'your-cluster',
});

const channel = pusher.subscribe('calendar-conflicts');
channel.bind('conflict-detected', data => {
  console.log('Calendar conflict:', data);
});
```

## Architecture

### Agent Execution Modes

Agent Core supports two execution modes for routing user messages to appropriate agents:

#### vNext Network Mode (Recommended)

When `MASTRA_USING_VNEXT_NETWORK=true` is set, the system uses the orchestrator network for intelligent agent routing:

- **Context-aware routing**: Automatically determines the best agent based on conversation context
- **Better performance**: Optimized for speed and accuracy
- **Unified experience**: Single network handles all agent coordination

#### Legacy Mode (Fallback)

When vNext network is disabled, the system falls back to intent detection:

- **Intent detection**: Analyzes user messages to determine intent
- **Pattern matching**: Uses keyword and pattern matching for agent selection
- **Agent routing**: Routes to specific agents based on detected intent

### Agent Ecosystem

**Core Agents**:

- **Master Agent**: Orchestrator for complex multi-step tasks
- **General Agent**: Default conversational assistant with Jarvis-like personality

**Productivity Agents**:

- **Gmail Agent**: Email management and operations
- **Google Calendar Agent**: Calendar scheduling with conflict detection
- **Jira Agent**: Project management and issue tracking
- **Confluence Agent**: Documentation and knowledge management (v2 API)

**Information Agents**:

- **Weather Agent**: Weather information and forecasts
- **Web Search Agent**: Internet search capabilities
- **Reddit Agent**: Reddit content and discussions

**Specialized Agents**:

- **Music Agent**: Music recommendations and information
- **Restaurant Agent**: Restaurant recommendations and reviews
- **Portfolio Agent**: Portfolio management and tracking

### MCP Integration

**Local Tools**:

- Embedding operations for semantic search
- Portfolio management tools
- Weather data processing

**Remote MCP Servers**:

- Google Assistant integration
- Time and scheduling services
- Booking and reservation systems
- Web search and Perplexity AI
- Atlassian suite (Jira/Confluence)
- Reddit API integration

### Performance & Infrastructure

**Performance Optimizations**:

- **Memory Caching**: 30-second TTL for memory patterns
- **Streaming Responses**: Real-time SSE generation
- **Database Optimization**: TimescaleDB for time-series data
- **Redis Caching**: Session storage and real-time data
- **Graceful Error Recovery**: Partial response capability

**Infrastructure**:

- **Containerized Services**: Docker Compose orchestration
- **Multiple MCP Servers**: Distributed tool architecture
- **Background Jobs**: Trigger.dev integration with 3600s max duration
- **Monitoring**: Comprehensive timing instrumentation

## Deployment

### Docker Compose Services

The `deployment/docker-compose.yml` includes:

- **PostgreSQL/TimescaleDB**: Primary database with time-series extensions
- **Redis**: Caching and session storage
- **MCP Servers**: Multiple Model Context Protocol servers
  - Google Assistant MCP
  - Time/Booking MCP
  - Web Search MCP
  - Atlassian MCP
  - Reddit MCP
  - Perplexity MCP

### Production Considerations

- Configure environment variables for production
- Set up SSL/TLS certificates
- Configure proper CORS origins
- Set up monitoring and logging
- Configure backup strategies for PostgreSQL
- Set appropriate resource limits for containers
