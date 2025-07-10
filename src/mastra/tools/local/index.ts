import { getWeatherTool } from './weather';
import { getPortfolioTool } from './portfolio';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const localTools: any[] = [getWeatherTool, getPortfolioTool];
