// This is a workaround for 'self-signed certificate in certificate chain' errors.
// It should only be used in development environments with trusted networks.
if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

import {
  batchInsertEmbeddings,
  searchEmbeddings,
  SearchResult,
} from './embedding.repository';
import { embed, embedMany } from 'ai';
import { EmailForEmbedding, CalendarEventForEmbedding } from './embedding.dto';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

// Specify the embedding model, e.g., 'text-embedding-3-small'
// const embeddingModel = openai.embedding('text-embedding-3-small');
const google = createGoogleGenerativeAI({
  apiKey: process.env.LITELLM_KEY,
  headers: {
    'Accept-Encoding': 'identity',
  },
});
const embeddingModel = google.textEmbeddingModel('gemini-embedding-exp-03-07', {
  outputDimensionality: 1536, // optional, number of dimensions for the embedding
  taskType: 'SEMANTIC_SIMILARITY', // optional, specifies the task type for generating embeddings
});

export class EmbeddingService {
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async createEmbeddingsBatch<T>(
    items: T[],
    contentExtractor: (item: T) => string,
    userId: string,
    sourceType: string,
    sourceIdExtractor: (item: T) => string
  ): Promise<void> {
    const BATCH_SIZE = 10;
    const batches = [];

    // Split items into batches of 10
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      batches.push(items.slice(i, i + BATCH_SIZE));
    }

    const allEmbeddingData = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const contentsToEmbed = batch.map(contentExtractor);

      try {
        const { embeddings } = await embedMany({
          model: embeddingModel,
          values: contentsToEmbed,
        });

        const embeddingData = batch.map((item, i) => ({
          userId,
          sourceType,
          sourceId: sourceIdExtractor(item),
          content: contentsToEmbed[i],
          embedding: embeddings[i],
        }));

        allEmbeddingData.push(...embeddingData);

        // Sleep for 1 second between batches if there are more batches to process
        if (batchIndex < batches.length - 1) {
          await this.sleep(500);
        }
      } catch (error) {
        console.error(
          `Failed to create embeddings for batch ${batchIndex + 1}`,
          error
        );
        throw error;
      }
    }

    // Insert all embeddings at once
    if (allEmbeddingData.length > 0) {
      await batchInsertEmbeddings(allEmbeddingData);
    }
  }

  async createEmbeddingsForEmails(userId: string, emails: EmailForEmbedding[]) {
    if (emails.length === 0) {
      return;
    }

    await this.createEmbeddingsBatch(
      emails,
      email =>
        `${email.fromAddress || ''} ${email.subject || ''} ${email.body || ''}`,
      userId,
      'email',
      email => email.id
    );
  }

  async createEmbeddingsForCalendarEvents(
    userId: string,
    events: CalendarEventForEmbedding[]
  ) {
    if (events.length === 0) {
      return;
    }

    await this.createEmbeddingsBatch(
      events,
      event => {
        const start = event.startTime.toISOString();
        const end = event.endTime.toISOString();
        return `${event.title || ''} (from ${start} to ${end}) ${
          event.description?.slice(0, 200) || ''
        } ${event.location || ''}`;
      },
      userId,
      'calendar_event',
      event => event.id
    );
  }

  async searchEmails(
    userId: string,
    queryText: string,
    options: { limit?: number; similarityThreshold?: number } = {}
  ): Promise<SearchResult[]> {
    const { limit = 5, similarityThreshold = 0.5 } = options;
    try {
      const { embedding } = await embed({
        model: embeddingModel,
        value: queryText,
      });

      const results = await searchEmbeddings(
        userId,
        embedding,
        limit,
        0,
        'email'
      );

      return results.filter(r => r.similarity > similarityThreshold);
    } catch (error) {
      console.error('Failed to search embeddings', error);
      return [];
    }
  }

  async searchCalendarEvents(
    userId: string,
    queryText: string,
    options: { limit?: number; similarityThreshold?: number } = {}
  ): Promise<SearchResult[]> {
    const { limit = 5, similarityThreshold = 0.6 } = options;

    try {
      const { embedding } = await embed({
        model: embeddingModel,
        value: queryText,
      });

      const results = await searchEmbeddings(
        userId,
        embedding,
        limit,
        0,
        'calendar_event'
      );

      return results.filter(r => r.similarity > similarityThreshold);
    } catch (error) {
      console.error('Failed to search embeddings', error);
      return [];
    }
  }
}
