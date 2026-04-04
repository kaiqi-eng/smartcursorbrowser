export type JobStatus =
  | "queued"
  | "running"
  | "paused_for_verification"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface LoginFieldInput {
  name: string;
  selector?: string;
  value: string;
  secret?: boolean;
}

export interface ScrapeJobRequest {
  url: string;
  goal: string;
  extractionSchema?: Record<string, string>;
  loginFields?: LoginFieldInput[];
  webhookUrl?: string;
  sourceType?: "generic" | "otter";
  maxSteps?: number;
  timeoutMs?: number;
  userAgent?: string;
}

export interface ActionContext {
  step: number;
  currentUrl: string;
  pageTitle: string;
  screenshotBase64?: string; // changed to optional (safe)
  textSnapshot: string;
  goal: string;
  lastError?: string;
  loginFieldHints?: Array<Pick<LoginFieldInput, "name" | "selector" | "secret">>;
}

export type BrowserActionType =
  | "goto"
  | "click"
  | "type"
  | "wait"
  | "scroll"
  | "extract"
  | "done";

export interface BrowserAction {
  type: BrowserActionType;
  selector?: string;
  x?: number;
  y?: number;
  text?: string;
  url?: string;
  waitMs?: number;
  scrollBy?: number;
  reason?: string;
}

export interface JobTraceEvent {
  timestamp: string;
  step: number;
  action: BrowserAction;
  note: string;
}

export interface ScrapeResult {
  finalUrl?: string;
  pageTitle?: string;
  extractedData?: Record<string, unknown>;
  rawText?: string;
  rawHtml?: string;
  sourceUrl?: string;
  summary?: string;
  transcript?: string;
  parsedPosts?: Array<{
    timestamp: string;
    content: string;
  }>;
  validationPayload?: {
    goal: string;
    finalUrl: string;
    pageTitle: string;
    rawText: string;
    rawHtml: string;
    parsedPosts: Array<{
      timestamp: string;
      content: string;
    }>;
    extractedData: Record<string, unknown>;
    instructions: {
      outputFormat: string;
      policy: string;
      parsedPostsFormat: string;
    };
  };
  goalAssessment?: {
    meetsGoal: boolean;
    confidence: "low" | "medium" | "high";
    reason: string;
    missingRequirements: string[];
  };
  trace: JobTraceEvent[];
}

export interface JobProgress {
  step: number;
  maxSteps: number;
  message: string;
}

export interface JobLiveView {
  currentUrl?: string;
  pageTitle?: string;
  screenshotBase64?: string;
  updatedAt: string;
}

export interface JobRecord {
  id: string;
  status: JobStatus;
  request: ScrapeJobRequest;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress: JobProgress;
  error?: string;
  result?: ScrapeResult;
  latestValidationPayload?: ScrapeResult["validationPayload"];
  liveView?: JobLiveView;
  cancelRequested: boolean;
  webhookDispatchedAt?: string;
  webhookDispatchError?: string;
}

export interface JobSummary {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  progress: JobProgress;
  error?: string;
}