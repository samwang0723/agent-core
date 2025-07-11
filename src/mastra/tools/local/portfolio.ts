import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const getPortfolioTool = createTool({
  id: 'get-portfolio-tool',
  description: 'Retrieve portfolio data from local webhook endpoint',
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async () => {
    try {
      const portfolioUrl = process.env.PORTFOLIO_URL!;
      const response = await fetch(portfolioUrl);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch portfolio data: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Portfolio data retrieval failed: ${error.message}`);
      }
      throw new Error('Portfolio data retrieval failed: Unknown error');
    }
  },
});
