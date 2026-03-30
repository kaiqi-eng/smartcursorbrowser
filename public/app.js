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
let pollFailures = 0;
const JOB_API_BASES = ["/jobs", "/app/jobs"];

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
      ok: true,
      data: responseText ? JSON.parse(responseText) : {},
      raw: responseText,
    };
  } catch {
    return {
      ok: false,
      data: {},
      raw: responseText,
    };
  }
}

async function requestJobApi(pathSuffix, options = {}) {
  let lastAttempt = null;
  for (const base of JOB_API_BASES) {
    const response = await fetch(`${base}${pathSuffix}`, options);
    const parsed = await parseJsonResponse(response);
    lastAttempt = { base, response, parsed };
    if (response.status !== 404) {
      return lastAttempt;
    }
  }
  return lastAttempt;
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
    const attempt = await requestJobApi("", { method: "POST", headers: getHeaders(), body: JSON.stringify(payload) });
    const { base, response, parsed } = attempt;
    const { data } = parsed;
    setDebug(`Response (${response.status}) via ${base}`, data);
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
  const attempt = await requestJobApi(`/${jobId}/cancel`, { method: "POST", headers: getHeaders() });
  const { response, parsed } = attempt;
  const { data } = parsed;
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
    const liveAttempt = await requestJobApi(`/${jobId}/live-image`, { headers: getHeaders() });
    const { base: liveBase, response: liveResponse, parsed: liveParsed } = liveAttempt;

    // Fallback path: if live endpoint is missing/non-json, use status endpoint.
    if (!liveResponse.ok || !liveParsed.ok) {
      const statusAttempt = await requestJobApi(`/${jobId}`, { headers: getHeaders() });
      const { base: statusBase, response: statusResponse, parsed: statusParsed } = statusAttempt;
      if (!statusResponse.ok || !statusParsed.ok) {
        throw new Error(
          `Polling failed (live ${liveResponse.status}, status ${statusResponse.status}): ${
            statusParsed.ok ? statusParsed.data.error || "Unknown error" : statusParsed.raw.slice(0, 120)
          }`,
        );
      }

      const statusData = statusParsed.data;
      jobMeta.textContent = `Status: ${statusData.status} | Step: ${statusData.progress.step}/${statusData.progress.maxSteps}`;
      setStatus(statusData.progress.message || statusData.status);
      setDebug(`Last status payload via ${statusBase}`, statusData);

      if (["succeeded", "failed", "cancelled"].includes(statusData.status)) {
        clearInterval(pollHandle);
        pollHandle = null;
        const resultAttempt = await requestJobApi(`/${jobId}/result`, { headers: getHeaders() });
        const { response: resultResponse, parsed: resultParsed } = resultAttempt;
        if (resultParsed.ok) {
          resultBox.textContent = JSON.stringify(resultParsed.data, null, 2);
        } else {
          resultBox.textContent = `Result endpoint returned non-JSON (${resultResponse.status}).\n${resultParsed.raw.slice(0, 300)}`;
        }
      }
      pollFailures = 0;
      return;
    }
    const live = liveParsed.data;

    jobMeta.textContent = `Status: ${live.status} | Step: ${live.progress.step}/${live.progress.maxSteps} | URL: ${live.currentUrl || "-"}`;
    setStatus(live.progress.message || live.status);
    if (live.imageDataUrl) {
      liveImage.src = live.imageDataUrl;
    }
    if (["succeeded", "failed", "cancelled"].includes(live.status)) {
      clearInterval(pollHandle);
      pollHandle = null;
      const resultAttempt = await requestJobApi(`/${jobId}/result`, { headers: getHeaders() });
      const { response: resultResponse, parsed: resultParsed } = resultAttempt;
      if (resultParsed.ok) {
        resultBox.textContent = JSON.stringify(resultParsed.data, null, 2);
      } else {
        resultBox.textContent = `Result endpoint returned non-JSON (${resultResponse.status}).\n${resultParsed.raw.slice(0, 300)}`;
      }
    }
    setDebug(`Last live payload via ${liveBase}`, live);
    pollFailures = 0;
  } catch (error) {
    pollFailures += 1;
    setStatus(`Polling issue (${pollFailures}): ${error.message}`);
    setDebug("Polling Error", error.message || String(error));
    // Stop only after repeated failures to tolerate transient deployment hiccups.
    if (pollHandle && pollFailures >= 5) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  }
}

function startPolling() {
  if (pollHandle) {
    clearInterval(pollHandle);
  }
  pollFailures = 0;
  pollHandle = setInterval(pollOnce, 1500);
  void pollOnce();
}

document.getElementById("createJobBtn").addEventListener("click", createJob);
document.getElementById("watchBtn").addEventListener("click", startPolling);
document.getElementById("cancelJobBtn").addEventListener("click", cancelJob);
jobIdInput.addEventListener("blur", () => {
  jobIdInput.value = normalizeJobId(jobIdInput.value);
});
