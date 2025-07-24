# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Start development server**: `bun run dev` (starts on port 3000 with auto-reload)
- **Start Mastra development**: `bun run dev:mastra` (Mastra framework development mode on port 4111)
- **Build application**: `bun run build` (builds to ./dist directory)
- **Build Mastra**: `bun run build:mastra`
- **Format code**: `bun run format` (write) or `bun run format:check` (check only)
- **Lint code**: `bun run lint` or `bun run lint:fix`
- **Start services**: `docker-compose -f deployment/docker-compose.yml up -d` (PostgreSQL/TimescaleDB, Redis, MCP servers)
- **Install dependencies**: `bun install`

## Architecture Overview

This is a conversational AI application built on the Mastra agent framework with a comprehensive microservice architecture:

### Core Components

1. **Web API (`src/app/`)**: Hono-based REST API server
   - Entry point: `src/app/index.ts`
   - Routes: Authentication (`/auth`), chat endpoints (`/chat`), health checks (`/health`), events (`/events`)
   - Authentication: Google OAuth 2.0 with session-based auth
   - Middleware: CORS, error handling, authentication

2. **Mastra Agent System (`src/mastra/`)**: AI agent orchestration
   - Entry point: `src/mastra/index.ts`
   - Multiple specialized agents with vNext network orchestration
   - Memory management with optimized caching (30s TTL)
   - MCP (Model Context Protocol) server integration

### Domain Services

**Calendar System (`src/app/calendar/`)**:

- Calendar repository, service, and DTOs
- Google Calendar integration
- Event management and scheduling

**Email System (`src/app/emails/`)**:

- Email repository, service, and DTOs
- Gmail integration for email operations

**Event System (`src/app/events/`)**:

- **Conflict Detection**: Intelligent calendar conflict detection service
- **Event Processing**: Batch processing, chat integration, and real-time detection
- **Pusher Integration**: Real-time event notifications via WebSocket
- **Subscription Management**: Event subscription and notification system

**Embeddings (`src/app/embeddings/`)**:

- Vector embedding repository and service
- Semantic search capabilities

**User Management (`src/app/users/`)**:

- User controller, repository, service, and DTOs
- Authentication and session management

### Agent Architecture

Current agents in `src/mastra/agents/`:

- `master.ts`: Master orchestrator agent
- `general.ts`: Default conversational agent
- `weather.ts`: Weather information and forecasting
- `gmail.ts`, `gcalendar.ts`: Google service integrations
- `jira.ts`, `confluence.ts`: Atlassian productivity tools
- `websearch.ts`, `reddit.ts`: Information retrieval
- `portfolio.ts`, `music.ts`, `restaurant.ts`: Specialized domains

### Tool Integration

**Local Tools (`src/mastra/tools/local/`)**:

- `embedding.ts`: Vector embedding operations
- `portfolio.ts`: Portfolio management tools
- `weather.ts`: Weather data tools

**Remote Tools (`src/mastra/tools/remote/`)**:

- **MCP Integration**: Full Model Context Protocol support
- MCP server configuration, DTOs, repository, and service
- Multiple MCP servers: Google Assistant, Time, Booking, Web Search, Atlassian, Reddit, Perplexity

### Memory & Context Management

- **Memory Service**: `src/mastra/memory/memory.service.ts` with thread/resource pattern
- **Context Utils**: User runtime context management
- **Performance Optimization**: 30-second TTL caching for memory patterns
- **Conversation History**: Persistent chat history with user sessions

### Network & Orchestration

- **Orchestrator Network**: `src/mastra/network/orchestrator.ts` for intelligent agent routing
- **vNext Network Mode**: Enabled via `MASTRA_USING_VNEXT_NETWORK=true`
- **Model Service**: Multi-provider AI model integration (Anthropic, OpenAI, Google)

### Database & Infrastructure

- **Primary DB**: PostgreSQL/TimescaleDB via Docker
- **Cache Layer**: Redis for session storage and real-time data
- **Docker Services**: Complete containerized environment with:
  - TimescaleDB (PostgreSQL with time-series extensions)
  - Redis cache
  - Multiple MCP servers (Google Assistant, Time, Booking, Web Search, Atlassian, Reddit, Perplexity)

### Key Features

- **Streaming Chat**: Server-Sent Events (SSE) for real-time responses
- **Calendar Intelligence**: Conflict detection and notification system
- **Real-time Events**: Pusher-based WebSocket notifications
- **Multi-Model Support**: Anthropic, OpenAI, Google AI integration
- **MCP Protocol**: Extensible tool integration via Model Context Protocol
- **Internationalization**: Multi-locale support with automatic detection
- **Performance Monitoring**: Comprehensive timing instrumentation

### Environment Requirements

Key environment variables needed:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `DATABASE_URL` (PostgreSQL connection)
- `REDIS_URL` (Redis connection for caching)
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`
- `MASTRA_USING_VNEXT_NETWORK=true` (recommended)
- `PORT`, `CORS_ORIGIN`
- Pusher configuration for real-time events

### Internationalization

- **Supported Locales**: English, Spanish, French, German, Chinese, Japanese, Korean, Portuguese, Italian, Russian
- **Detection Priority**: Query params (`locale`/`lang`) → Custom headers (`X-Locale`/`X-Language`) → Accept-Language → Default (en)
- **Implementation**: Locale detection in `src/app/utils/locale.ts`, context integration in conversation service
- **AI Response**: System messages automatically instruct models to respond in detected locale

### Background Jobs

- Trigger.dev integration configured in `trigger.config.ts`
- Job definitions in `src/app/jobs/`
- 3600s max duration, exponential backoff retry strategy
