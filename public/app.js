const apiKeyInput = document.getElementById("apiKey");
const urlInput = document.getElementById("url");
const goalInput = document.getElementById("goal");
const loginFieldsInput = document.getElementById("loginFields");
const jobIdInput = document.getElementById("jobId");
const lastJobId = document.getElementById("lastJobId");
const statusLine = document.getElementById("statusLine");
const debugBox = document.getElementById("debugBox");
const jobMeta = document.getElementById("jobMeta");
const resultBox = document.getElementById("resultBox");
const liveImage = document.getElementById("liveImage");
let pollHandle = null;

apiKeyInput.value = localStorage.getItem("service_api_key") || "testing";

function setStatus(text) {
  statusLine.textContent = text;
}

function setDebug(label, value) {
  const rendered = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  debugBox.textContent = `${label}\n${rendered}`;
}

function normalizeJobId(raw) {
  const text = (raw || "").trim();
  if (!text) {
    return "";
  }
  const uuidMatch = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  return uuidMatch ? uuidMatch[0] : text;
}

async function parseJsonResponse(response) {
  const responseText = await response.text();
  try {
    return {
      data: responseText ? JSON.parse(responseText) : {},
      raw: responseText,
    };
  } catch {
    throw new Error(`Non-JSON response (${response.status}): ${responseText.slice(0, 200)}`);
  }
}

function safeParseLoginFields(raw) {
  const text = (raw || "").trim();
  if (!text) {
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error("Login fields must be a JSON array.");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Login fields JSON is invalid: ${error.message}`);
  }
}

function getHeaders() {
  const key = apiKeyInput.value.trim();
  localStorage.setItem("service_api_key", key);
  return {
    "Content-Type": "application/json",
    "x-api-key": key,
  };
}

async function createJob() {
  try {
    const url = urlInput.value.trim();
    const goal = goalInput.value.trim();
    if (!url) {
      throw new Error("Start URL is required.");
    }
    if (!goal) {
      throw new Error("Goal is required.");
    }
    const payload = { url, goal, loginFields: safeParseLoginFields(loginFieldsInput.value), maxSteps: 20 };
    setDebug("Request payload", payload);
    setStatus("Creating job...");
    const response = await fetch("/jobs", { method: "POST", headers: getHeaders(), body: JSON.stringify(payload) });
    const { data } = await parseJsonResponse(response);
    setDebug(`Response (${response.status})`, data);
    if (!response.ok) {
      throw new Error(data.error || "Job creation failed");
    }
    const createdJobId = data.jobId || data.id;
    if (!createdJobId) {
      throw new Error("Job created but response did not include job id");
    }
    jobIdInput.value = createdJobId;
    lastJobId.textContent = `Last job id: ${createdJobId}`;
    setStatus(`Job created: ${createdJobId}`);
    startPolling();
  } catch (error) {
    setStatus(`Error: ${error.message}`);
    setDebug("Create Job Error", error.message || String(error));
  }
}

async function cancelJob() {
  const jobId = normalizeJobId(jobIdInput.value);
  jobIdInput.value = jobId;
  if (!jobId) {
    setStatus("Enter a job id first.");
    return;
  }
  const response = await fetch(`/jobs/${jobId}/cancel`, { method: "POST", headers: getHeaders() });
  const { data } = await parseJsonResponse(response);
  if (!response.ok) {
    setStatus(data.error || "Cancel failed");
    return;
  }
  setStatus(`Cancel requested for ${jobId}`);
}

async function pollOnce() {
  const jobId = normalizeJobId(jobIdInput.value);
  jobIdInput.value = jobId;
  if (!jobId) {
    return;
  }
  try {
    const liveResponse = await fetch(`/jobs/${jobId}/live-image`, { headers: getHeaders() });
    const { data: live } = await parseJsonResponse(liveResponse);
    if (!liveResponse.ok) {
      throw new Error(live.error || "Failed to fetch live image");
    }
    jobMeta.textContent = `Status: ${live.status} | Step: ${live.progress.step}/${live.progress.maxSteps} | URL: ${live.currentUrl || "-"}`;
    setStatus(live.progress.message || live.status);
    if (live.imageDataUrl) {
      liveImage.src = live.imageDataUrl;
    }
    if (["succeeded", "failed", "cancelled"].includes(live.status)) {
      clearInterval(pollHandle);
      pollHandle = null;
      const resultResponse = await fetch(`/jobs/${jobId}/result`, { headers: getHeaders() });
      const { data: resultData } = await parseJsonResponse(resultResponse);
      resultBox.textContent = JSON.stringify(resultData, null, 2);
    }
    setDebug("Last live payload", live);
  } catch (error) {
    setStatus(`Polling error: ${error.message}`);
    setDebug("Polling Error", error.message || String(error));
    if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  }
}

function startPolling() {
  if (pollHandle) {
    clearInterval(pollHandle);
  }
  pollHandle = setInterval(pollOnce, 1500);
  void pollOnce();
}

document.getElementById("createJobBtn").addEventListener("click", createJob);
document.getElementById("watchBtn").addEventListener("click", startPolling);
document.getElementById("cancelJobBtn").addEventListener("click", cancelJob);
jobIdInput.addEventListener("blur", () => {
  jobIdInput.value = normalizeJobId(jobIdInput.value);
});
