export { codeAnalysisTools } from './code-analysis-tools.js';
export { gitTools } from './git-tools.js';

/**
 * All tools available to Mastra agents
 */
export const allTools = {
  ...require('./code-analysis-tools.js').codeAnalysisTools,
  ...require('./git-tools.js').gitTools
};
