import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { embeddingService } from '../../../app/embeddings';
import logger from '../../utils/logger';

export const getEmailCacheTool = createTool({
  id: 'get-email-cache-tool',
  description: 'Retrieve email cache data from local database',
  inputSchema: z.object({
    message: z.string().describe('User message'),
  }),
  outputSchema: z.string(),
  execute: async ({ context, runtimeContext }) => {
    const ragPromises: Promise<{ type: string; content: string }>[] = [];
    logger.debug(
      `[${runtimeContext.get('sessionId')}] ============= getEmailCacheTool: `,
      context
    );
    ragPromises.push(
      embeddingService
        .searchEmails(runtimeContext.get('sessionId'), context.message)
        .then(results => {
          if (results && results.length > 0) {
            const content = results.map(r => r.content).join('\n\n');
            return { type: 'email', content };
          }
          return { type: 'email', content: '' };
        })
        .catch(error => {
          logger.warn('Email RAG failed:', error);
          return { type: 'email', content: '' };
        })
    );

    const results = await Promise.all(ragPromises);
    const validResults = results.filter(r => r.content.length > 0);

    if (validResults.length === 0) {
      return '';
    }

    // Build a single, unified context prompt
    const contextSections = validResults.map(r => {
      if (r.type === 'email') {
        return `Email Context:\n${r.content}`;
      } else if (r.type === 'calendar') {
        return `Calendar Context:\n${r.content}`;
      }
      return r.content;
    });

    const unifiedContext = contextSections.join('\n\n');
    return unifiedContext;
  },
});
