# Agent Core

Agent Core is a robust, AI-powered agent framework built with TypeScript, Hono, and the Mastra agent platform. It provides a foundation for building complex conversational AI applications with support for multiple AI models, authentication, and long-term memory.

## Features

- **Conversational AI:** Core logic for handling chat messages, with support for both streaming (SSE) and standard JSON responses.
- **Internationalization:** Multi-language support with automatic locale detection from headers, query parameters, and Accept-Language headers.
- **Authentication:** Secure user authentication using Google OAuth 2.0.
- **Intent Detection:** A sophisticated intent detection system to route user messages to the appropriate agent or tool.
- **Multi-Model Support:** Integrates with various AI models, including Anthropic, Google, and OpenAI.
- **Mastra Framework:** Built on the Mastra agent framework for powerful and flexible agent creation.
- **Long-Term Memory:** Conversation history and memory management for context-aware interactions.
- **Tool Integration:** Supports a wide range of tools, including Google Calendar, Gmail, Jira, web search, and more.
- **Performance Monitoring:** Comprehensive timing instrumentation and optimized caching for enhanced performance.
- **Containerized:** Comes with a Docker Compose setup for easy and consistent deployment of the application and its dependent services.

## Project Structure

The project is organized into two main parts:

- `src/app`: Contains the web server logic, API routes, controllers, and user-facing services. This is the entry point for all API requests.
- `src/mastra`: Contains the core agent logic, including agent definitions, memory services, model integrations, and tools.
- `deployment`: Contains Docker and database schema files for deployment.

## Prerequisites

Before you begin, ensure you have the following installed:

- [Bun](https://bun.sh/)
- [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/)

## Environment Variables

To run the application, you need to create a `.env` file in the root of the project. Copy the `.env.example` file (if it exists) or create a new one with the following variables:

```env
# Application Port
PORT=3000

# CORS Origin
CORS_ORIGIN=http://localhost:3000

# Google OAuth 2.0 Credentials
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
GOOGLE_REDIRECT_URI="http://localhost:3000/api/v1/auth/google/callback"

# Database Connection (for TimescaleDB running in Docker)
DATABASE_URL="postgres://postgres:postgres@localhost:5432/agent-core-main"

# Mastra Configuration
MASTRA_USING_VNEXT_NETWORK=true

# AI Provider API Keys
ANTHROPIC_API_KEY="your-anthropic-api-key"
OPENAI_API_KEY="your-openai-api-key"
GOOGLE_API_KEY="your-google-api-key"

# Optional: Performance and Debugging
ENABLE_PERFORMANCE_LOGGING=false
NODE_ENV=development

# Add any other required environment variables for tools (e.g., Jira, etc.)
```

## Getting Started

1.  **Clone the repository:**

    ```sh
    git clone <repository-url>
    cd agent-core
    ```

2.  **Set up environment variables:**
    Create a `.env` file and populate it with the necessary values as described above.

3.  **Start dependent services:**
    This will start the PostgreSQL database and other microservices defined in the `docker-compose.yml` file.

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
bun run dev
```

The server will be available at `http://localhost:3000`.

### Mastra Development

To run the Mastra framework in development mode:

```sh
bun run dev:mastra
```

### Code Quality

Format your code:

```sh
bun run format        # Format code
bun run format:check  # Check formatting
```

Lint your code:

```sh
bun run lint          # Run linting
bun run lint:fix      # Fix linting issues
```

### Production

To build the application for production:

```sh
bun run build
```

This will create a production-ready build in the `dist/` directory. You will need a production-ready start script to run the built files, for example using `node` or `bun`.

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

### Available Agents

- **General Agent**: Default conversational assistant with Jarvis-like personality
- **Weather Agent**: Weather information and forecasts
- **Gmail Agent**: Email management and operations
- **Google Calendar Agent**: Calendar scheduling and management
- **Jira Agent**: Project management and issue tracking
- **Confluence Agent**: Documentation and knowledge management
- **Web Search Agent**: Internet search capabilities
- **Reddit Agent**: Reddit content and discussions
- **Music Agent**: Music recommendations and information
- **Restaurant Agent**: Restaurant recommendations and reviews
- **Portfolio Agent**: Portfolio management and tracking

### Performance Features

- **Memory Caching**: 30-second TTL for memory patterns to reduce database queries
- **Streaming Responses**: Real-time response generation with SSE
- **Timing Instrumentation**: Comprehensive performance monitoring
- **Graceful Error Recovery**: Partial response capability on errors

## Deployment

The application is designed to be deployed using Docker. The `deployment/docker-compose.yml` file provides a starting point for running the application and its dependencies in a containerized environment. You can adapt this file for your production deployment needs.
