import { parseResponse, fetchNoCache } from "../utils/http.js";

async function listDashboards() {
  const response = await fetchNoCache("/api/dashboards");
  const data = await parseResponse(response);
  return data.items || [];
}

async function openDashboard(name) {
  const response = await fetchNoCache(`/api/dashboards/${encodeURIComponent(name)}`);
  return parseResponse(response);
}

async function saveDashboard(name, dashboard) {
  const response = await fetchNoCache(`/api/dashboards/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      dashboard
    })
  });
  return parseResponse(response);
}

async function deleteDashboard(name) {
  const response = await fetchNoCache(`/api/dashboards/${encodeURIComponent(name)}`, {
    method: "DELETE"
  });
  return parseResponse(response);
}

export { listDashboards, openDashboard, saveDashboard, deleteDashboard };
