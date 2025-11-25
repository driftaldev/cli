/**
 * Stream events for real-time UI updates during code review
 */

export type StreamEventType =
  | "thinking"
  | "text"
  | "file-start"
  | "file-complete"
  | "agent-start"
  | "agent-complete"
  | "complete";

export interface ThinkingStreamEvent {
  type: "thinking";
  content: string;
  delta: string;
}

export interface TextStreamEvent {
  type: "text";
  content: string;
  delta: string;
}

export interface FileStartStreamEvent {
  type: "file-start";
  fileName: string;
  agent: string;
}

export interface FileCompleteStreamEvent {
  type: "file-complete";
  fileName: string;
}

export interface AgentStartStreamEvent {
  type: "agent-start";
  agent: "security" | "performance" | "logic";
  fileName: string;
}

export interface AgentCompleteStreamEvent {
  type: "agent-complete";
  agent: "security" | "performance" | "logic";
  fileName: string;
}

export interface CompleteStreamEvent {
  type: "complete";
}

export type StreamEvent =
  | ThinkingStreamEvent
  | TextStreamEvent
  | FileStartStreamEvent
  | FileCompleteStreamEvent
  | AgentStartStreamEvent
  | AgentCompleteStreamEvent
  | CompleteStreamEvent;

export type StreamEventCallback = (event: StreamEvent) => void;

/**
 * State for the streaming review UI
 */
export interface StreamingState {
  currentFile: string | null;
  currentAgent: "security" | "performance" | "logic" | null;
  thinkingContent: string;
  reviewContent: string;
  isThinking: boolean;
  isComplete: boolean;
  filesProcessed: number;
  totalFiles: number;
}

export const initialStreamingState: StreamingState = {
  currentFile: null,
  currentAgent: null,
  thinkingContent: "",
  reviewContent: "",
  isThinking: false,
  isComplete: false,
  filesProcessed: 0,
  totalFiles: 0,
};

