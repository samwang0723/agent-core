import { getWeatherTool } from './weather';
import { getPortfolioTool } from './portfolio';
import { fileEditing } from './file';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const localTools: any[] = [
  getWeatherTool,
  getPortfolioTool,
  fileEditing,
];
