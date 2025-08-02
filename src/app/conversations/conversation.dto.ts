import { CoreMessage, LanguageModelUsage, ToolCall, ToolResult } from 'ai';

export type Message = CoreMessage;

export interface TimeRange {
  from: string;
  to: string;
}
export interface ClientLocation {
  timezone: string;
  country?: string;
  city?: string;
}
