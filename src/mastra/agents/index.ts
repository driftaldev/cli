// Code analyzer (combines logic and security analysis)
export {
  createCodeAgent,
  createLogicAgent, // Backwards compatibility alias
  runLogicAnalysis,
  runLogicAnalysisStreaming,
  runLogicAnalysisWithContext,
} from "./logic-agent.js";
