import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const getPortfolioTool = createTool({
  id: 'get-portfolio-tool',
  description: 'Retrieve portfolio data from local webhook endpoint',
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async () => {
    const startTime = performance.now();
    try {
      const portfolioUrl = process.env.PORTFOLIO_URL!;
      const response = await fetch(portfolioUrl, {
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch portfolio data: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      const endTime = performance.now();
      console.log(
        `Portfolio service response time: ${(endTime - startTime).toFixed(2)}ms`
      );
      return data;
    } catch (error) {
      const endTime = performance.now();
      const responseTime = (endTime - startTime).toFixed(2);

      if (error instanceof Error) {
        if (
          error.name === 'TimeoutError' ||
          error.message.includes('timeout')
        ) {
          console.error(`Portfolio service timeout after ${responseTime}ms`);
          throw new Error(
            'Portfolio data retrieval failed: Service timeout (3s)'
          );
        }
        console.error(
          `Portfolio service error after ${responseTime}ms: ${error.message}`
        );
        throw new Error(`Portfolio data retrieval failed: ${error.message}`);
      }
      console.error(`Portfolio service unknown error after ${responseTime}ms`);
      throw new Error('Portfolio data retrieval failed: Unknown error');
    }
  },
});
