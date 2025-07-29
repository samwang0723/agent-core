# Events System

The Events System is a comprehensive real-time notification and event processing architecture that handles calendar events, email notifications, and conflict detection with AI-powered summarization.

## Notification Flow Diagram

```mermaid
graph TD
    %% Data Sources
    A[Google Calendar API] --> B[Calendar Service]
    C[Gmail API] --> D[Gmail Service]
    
    %% Background Jobs/Cron
    E[Trigger.dev Jobs] --> F{Job Types}
    F --> G[syncCalendarCronTask<br/>Every 30 minutes]
    F --> H[syncGmailCronTask<br/>Every 60 minutes]
    F --> I[importCalendarTask<br/>On-demand]
    F --> J[importGmailTask<br/>On-demand]
    
    %% Data Processing
    G --> K[importCalendar Function]
    H --> L[importGmail Function]
    I --> K
    J --> L
    
    K --> B
    L --> D
    
    %% Service Layer
    B --> M[Calendar Events Processing]
    D --> N[Email Processing]
    
    %% Event Detection
    M --> O[EventDetector.detectCalendarEvents]
    N --> P[EventDetector.detectImportantEmails]
    
    O --> Q{Event Types}
    P --> R[Important Email Events]
    
    Q --> S[New Calendar Events]
    Q --> T[Upcoming Events]
    Q --> U[Calendar Conflicts]
    
    %% Batch Processing
    S --> V[Event Batch Service]
    T --> V
    U --> W[Conflict Batch Service]
    R --> X[Email Batch Service]
    
    %% AI Summary Generation
    V --> Y[Mastra General Agent<br/>AI Summary]
    W --> Z[Mastra General Agent<br/>Conflict Summary]
    X --> AA[Mastra General Agent<br/>Email Summary]
    
    %% Chat Message Creation
    Y --> BB[Chat Message Event]
    Z --> BB
    AA --> BB
    
    %% Real-time Broadcasting
    BB --> CC[Pusher Event Broadcaster]
    
    %% Notification Cache Check
    CC --> DD{Duplicate Check<br/>Notification Cache}
    DD -->|Not Duplicate| EE[Broadcast to User Channel]
    DD -->|Duplicate| FF[Skip Notification]
    
    %% User Subscription Management
    EE --> GG[Event Subscription Manager]
    GG --> HH{User Has Subscription?}
    HH -->|No| II[Auto-create Default Subscription]
    HH -->|Yes| JJ[Send to Pusher Channel]
    II --> JJ
    
    %% Final Delivery
    JJ --> KK[user-{userId} Channel]
    KK --> LL[Frontend WebSocket Client]
    
    %% Storage & Persistence
    CC --> MM[Event Storage<br/>Database]
    V --> NN[Notification Cache<br/>Redis TTL]
    W --> NN
    X --> NN
    
    %% Embedding Generation
    M --> OO[Embedding Service<br/>Vector Embeddings]
    N --> PP[Embedding Service<br/>Email Embeddings]

    %% Styling
    classDef apiService fill:#e1f5fe
    classDef jobService fill:#f3e5f5
    classDef eventService fill:#e8f5e8
    classDef aiService fill:#fff3e0
    classDef notificationService fill:#ffebee
    classDef storage fill:#f5f5f5
    
    class A,C apiService
    class E,F,G,H,I,J,K,L jobService
    class O,P,Q,V,W,X,CC,GG eventService
    class Y,Z,AA,BB aiService
    class DD,EE,JJ,KK,LL notificationService
    class MM,NN,OO,PP storage
```

## Core Components

### Event Detection (`event.detector.ts`)
- **Calendar Events**: Detects new events, upcoming events (within 2 hours), and scheduling conflicts
- **Email Events**: Identifies important emails based on content analysis, keywords, and VIP domains
- **Priority Scoring**: Automatic importance calculation for events and emails

### Batch Processing (`event-batch.service.ts`)
- **Batched Summaries**: Groups related events for AI-powered summarization
- **Duplicate Prevention**: Redis-based caching prevents notification spam
- **Locale Support**: AI responses in user's preferred language

### Conflict Detection (`conflict-detection.service.ts`)
- **Overlap Detection**: Identifies overlapping calendar events
- **Back-to-Back Events**: Detects tight scheduling with insufficient gaps
- **Severity Analysis**: Classifies conflicts as minor, moderate, or major

### Real-time Broadcasting (`pusher.service.ts`)
- **WebSocket Delivery**: Pusher-based real-time notifications
- **User Channels**: Private channels per user (`user-{userId}`)
- **Auto-subscription**: Automatic subscription management

### Event Storage (`event.storage.ts`)
- **Persistence**: Database storage for all events
- **Cleanup**: Automatic removal of old events

## Event Types

### Calendar Events
- `CALENDAR_NEW_EVENT`: Newly detected calendar events
- `CALENDAR_UPCOMING_EVENT`: Events starting within 2 hours
- `CALENDAR_CONFLICT_DETECTED`: Scheduling conflicts

### Email Events
- `GMAIL_IMPORTANT_EMAIL`: High-priority emails based on content analysis

### System Events
- `CHAT_MESSAGE`: AI-generated summaries as chat messages
- `SYSTEM_NOTIFICATION`: System-wide notifications

## Notification Flow Summary

### 1. **Data Collection**
- **Cron Jobs**: Calendar sync (30min), Gmail sync (60min) via Trigger.dev
- **On-demand**: Manual imports triggered by user actions

### 2. **Event Detection**
- **Calendar**: New events, upcoming events (within 2 hours), conflicts detected
- **Email**: Important emails based on keywords, VIP domains, and content analysis

### 3. **Batch Processing & AI Summarization**
- Events grouped by type and processed in batches
- Mastra AI agents generate conversational summaries in user's locale
- Duplicate detection via Redis cache (30s TTL)

### 4. **Real-time Delivery**
- **Pusher WebSocket**: User-specific channels (`user-{userId}`)
- **Auto-subscription**: Creates default subscriptions if missing
- **Event Storage**: Persists all events in database

### 5. **Key Features**
- **Conflict Detection**: Overlapping/back-to-back calendar events
- **Importance Scoring**: Email priority based on content analysis
- **Internationalization**: AI responses in user's preferred locale
- **Deduplication**: Prevents spam notifications using Redis cache

## Configuration

### Environment Variables
```env
PUSHER_APP_ID=your_pusher_app_id
PUSHER_KEY=your_pusher_key
PUSHER_SECRET=your_pusher_secret
PUSHER_CLUSTER=us2
REDIS_URL=redis://localhost:6379
```

### Background Jobs
- **Gmail Sync**: Every 60 minutes (`syncGmailCronTask`)
- **Calendar Sync**: Every 30 minutes (`syncCalendarCronTask`)
- **On-demand**: Manual imports via `importGmailTask` and `importCalendarTask`