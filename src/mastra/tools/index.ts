export { gitTools } from './git-tools.js';

/**
 * All tools available to Mastra agents
 */
export const allTools = {
  ...require('./git-tools.js').gitTools
};
