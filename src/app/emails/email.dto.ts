export interface GoogleEmailHeader {
  name: string;
  value: string;
}

export interface RawGmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  internalDate: string;
  textBody: string;
  headers: GoogleEmailHeader[];
}

export interface GmailListResponse {
  messages: RawGmailMessage[];
}

export interface GmailMessage {
  id?: string;
  userId: string;
  messageId: string;
  threadId: string;
  subject?: string | null;
  body?: string | null;
  receivedTime: Date;
  isUnread?: boolean | null;
  importance?: boolean | null;
  fromAddress?: string | null;
}
