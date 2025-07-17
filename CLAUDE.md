# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Start development server**: `bun run dev` (starts on port 3000 with auto-reload)
- **Start Mastra development**: `bun run dev:mastra` (Mastra framework development mode)
- **Build application**: `bun run build` (builds to ./dist directory)
- **Build Mastra**: `bun run build:mastra`
- **Format code**: `bun run format` (write) or `bun run format:check` (check only)
- **Lint code**: `bun run lint` or `bun run lint:fix`
- **Start services**: `docker-compose -f deployment/docker-compose.yml up -d` (PostgreSQL/TimescaleDB)
- **Install dependencies**: `bun install`

## Architecture Overview

This is a conversational AI application built on the Mastra agent framework with a dual-architecture approach:

### Core Components

1. **Web API (`src/app/`)**: Hono-based REST API server
   - Entry point: `src/app/index.ts`
   - Routes: Authentication, chat endpoints, health checks
   - Authentication: Google OAuth 2.0 with session-based auth
   - Middleware: CORS, error handling, authentication

2. **Mastra Agent System (`src/mastra/`)**: AI agent orchestration
   - Entry point: `src/mastra/index.ts`
   - Multiple specialized agents (weather, gmail, calendar, jira, etc.)
   - Two execution modes: Legacy intent detection vs vNext network orchestration
   - Memory management with optimized caching (30s TTL)

### Agent Execution Modes

**vNext Network Mode** (preferred, enabled via `MASTRA_USING_VNEXT_NETWORK=true`):

- Uses `orchestrator-network` for intelligent agent routing
- Context-aware message processing
- Better performance and accuracy

**Legacy Mode** (fallback):

- Intent detection system with keyword/pattern matching
- Routes to specific agents based on detected intent
- Located in `src/app/intents/`

### Key Features

- **Streaming Chat**: Server-Sent Events (SSE) for real-time responses
- **Memory System**: User conversation context with resource/thread management
- **Internationalization**: Multi-locale support with automatic detection from headers/query params
- **Performance Monitoring**: Detailed timing instrumentation throughout request lifecycle
- **Authentication**: Google OAuth with secure session management
- **Multi-Model Support**: Anthropic, OpenAI, Google AI integration
- **Tool Integration**: Calendar, email, Jira, web search, portfolio management

### Database & Memory

- **Primary DB**: PostgreSQL/TimescaleDB via Docker
- **Memory Storage**: Mastra memory service with thread/resource pattern caching
- **Session Management**: Cookie-based authentication with user context

### Agent Architecture

Agents are located in `src/mastra/agents/` and include:

- `general.ts`: Default conversational agent
- `weather.ts`, `gmail.ts`, `gcalendar.ts`: Service-specific agents
- `jira.ts`, `confluence.ts`: Productivity tools
- `websearch.ts`, `reddit.ts`: Information retrieval
- `portfolio.ts`, `music.ts`, `restaurant.ts`: Specialized domains

### Performance Considerations

- Memory pattern caching prevents redundant database queries
- Streaming responses minimize perceived latency
- Comprehensive timing instrumentation for optimization
- Graceful error recovery with partial response capability

### Environment Requirements

Key environment variables needed:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `DATABASE_URL` (PostgreSQL connection)
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`
- `MASTRA_USING_VNEXT_NETWORK=true` (recommended)
- `PORT`, `CORS_ORIGIN`

### Internationalization

- **Supported Locales**: English, Spanish, French, German, Chinese, Japanese, Korean, Portuguese, Italian, Russian
- **Detection Priority**: Query params (`locale`/`lang`) → Custom headers (`X-Locale`/`X-Language`) → Accept-Language → Default (en)
- **Implementation**: Locale detection in `src/app/utils/locale.ts`, context integration in conversation service
- **AI Response**: System messages automatically instruct models to respond in detected locale

### Background Jobs

- Trigger.dev integration configured in `trigger.config.ts`
- Job definitions in `src/app/jobs/`
- 3600s max duration, exponential backoff retry strategy
