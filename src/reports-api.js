const latestReportUrl = "/api/reports/latest";
const reportsUrl = "/api/reports";
const sampleReportUrl = "/reports/daily-report.json";
const dataQueryUrl = "/api/data/query";
const templatesUrl = "/api/templates";

function isReportType(type) {
  return ["daily", "weekly", "monthly"].includes(type) ||
    (typeof type === "string" && /^custom-[0-9a-f-]{36}$/.test(type));
}

function normalizeReportBlocks(blocks) {
  return blocks.map((block) =>
    block.type === "table" ? normalizeTableBlock(block) : block,
  );
}

async function parseApiResponse(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `API 요청 실패 (${response.status})`);
  }
  return result;
}

export async function executeDataQuery(query, parameters, datasourceId = "") {
  return parseApiResponse(
    await fetch(dataQueryUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, parameters, datasourceId }),
    }),
  );
}

// ---------- 접속정보(외부 데이터소스) ----------

async function postJson(url, body, method = "POST") {
  return parseApiResponse(
    await fetch(url, {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function getDatasources() {
  const result = await parseApiResponse(
    await fetch("/api/datasources", { headers: { Accept: "application/json" } }),
  );
  return Array.isArray(result.datasources) ? result.datasources : [];
}

export async function saveDatasource(datasource) {
  return datasource.id
    ? postJson(`/api/datasources/${encodeURIComponent(datasource.id)}`, datasource, "PUT")
    : postJson("/api/datasources", datasource);
}

export async function deleteDatasources(ids) {
  return postJson("/api/datasources/delete", { ids });
}

export async function testDatasource(datasource) {
  return postJson("/api/datasources/test", datasource);
}

// ---------- 사용자·그룹 관리 ----------

export async function getAdminUsers() {
  const result = await parseApiResponse(
    await fetch("/api/admin/users", { headers: { Accept: "application/json" } }),
  );
  return result.users;
}

export async function createAdminUser(user) {
  return postJson("/api/admin/users", user);
}

export async function updateAdminUser(userCd, user) {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userCd)}`, {
    method: "PATCH",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(user),
  });
  if (response.status !== 204) await parseApiResponse(response);
}

export async function bulkUpdateAdminUsers(userCds, action, value) {
  return postJson("/api/admin/users/bulk", { userCds, action, value });
}

export async function importAdminUsers(users, createMissingGroups) {
  return postJson("/api/admin/users/import", { users, createMissingGroups });
}

export async function deleteAdminUser(userCd) {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userCd)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  if (response.status !== 204) await parseApiResponse(response);
}

export async function getAdminGroups() {
  const result = await parseApiResponse(
    await fetch("/api/admin/groups", { headers: { Accept: "application/json" } }),
  );
  return result.groups;
}

export async function getTemplateAccessOptions() {
  const result = await parseApiResponse(
    await fetch("/api/access-options", { headers: { Accept: "application/json" } }),
  );
  return { groups: result.groups, users: result.users };
}

export async function createAdminGroup(group) {
  return postJson("/api/admin/groups", group);
}

export async function updateAdminGroup(groupCd, group) {
  const response = await fetch(`/api/admin/groups/${encodeURIComponent(groupCd)}`, {
    method: "PATCH",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(group),
  });
  if (response.status !== 204) await parseApiResponse(response);
}

export async function updateAdminGroupMembers(groupCd, userCds) {
  const response = await fetch(`/api/admin/groups/${encodeURIComponent(groupCd)}/members`, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ userCds }),
  });
  if (response.status !== 204) await parseApiResponse(response);
}

export async function deleteAdminGroup(groupCd) {
  const response = await fetch(`/api/admin/groups/${encodeURIComponent(groupCd)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  if (response.status !== 204) await parseApiResponse(response);
}

export async function getDatabaseStatus() {
  return parseApiResponse(
    await fetch("/api/data/status", {
      headers: { Accept: "application/json" },
    }),
  );
}

export async function getTemplates() {
  const result = await parseApiResponse(
    await fetch(templatesUrl, { headers: { Accept: "application/json" } }),
  );
  if (!Array.isArray(result.templates)) {
    throw new Error("보고서 양식 목록 형식이 올바르지 않습니다.");
  }
  return result.templates;
}

export async function createTemplate(template) {
  return parseApiResponse(
    await fetch(templatesUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(template),
    }),
  );
}

export async function updateTemplate(id, template) {
  return parseApiResponse(
    await fetch(`${templatesUrl}/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(template),
    }),
  );
}

export async function updateTemplateAccess(id, access) {
  const result = await postJson(
    `${templatesUrl}/${encodeURIComponent(id)}/access`,
    access,
    "PUT",
  );
  return result.access;
}

export async function deleteTemplate(id) {
  const response = await fetch(`${templatesUrl}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  if (response.status === 204) {
    return;
  }
  await parseApiResponse(response);
}

export async function getSchedules() {
  const result = await parseApiResponse(
    await fetch("/api/schedules", { headers: { Accept: "application/json" } }),
  );
  if (!Array.isArray(result.schedules)) {
    throw new Error("보고서 실행 일정 목록 형식이 올바르지 않습니다.");
  }
  return result.schedules;
}

export async function saveSchedule(id, schedule) {
  return parseApiResponse(
    await fetch(`/api/schedules/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(schedule),
    }),
  );
}

export function normalizeTableBlock(block) {
  if (block.gridVersion === 1) {
    return block;
  }

  const legacyColumns = block.columns ?? [];
  const legacyColumnStyles = block.columnStyles ?? [];
  const legacyRows = block.rows ?? [];
  const columnCount = legacyColumns.length + 1;
  const rows = [];
  const merges = [...(block.merges ?? [])];

  if (block.groupHeaders?.length) {
    const topHeaders = Array(columnCount).fill("");
    const subHeaders = Array(columnCount).fill("");
    let physicalColumn = 0;
    let subHeaderIndex = 0;
    for (const header of block.groupHeaders) {
      const colspan = header.colspan || 1;
      const rowspan = header.rowspan || 1;
      topHeaders[physicalColumn] = header.label;
      if (colspan > 1 || rowspan > 1) {
        merges.push({
          row: 0,
          column: physicalColumn,
          rowspan: Math.min(rowspan, 2),
          colspan,
        });
      }

      if (rowspan === 1 && colspan > 1) {
        for (let offset = 0; offset < colspan; offset += 1) {
          subHeaders[physicalColumn + offset] =
            block.subHeaders?.[subHeaderIndex + offset] ?? "";
        }
        subHeaderIndex += colspan;
      }
      physicalColumn += colspan;
    }
    rows.push({
      cells: topHeaders,
      cellStyles: Array.from({ length: columnCount }, () => ({})),
    });
    rows.push({
      cells: subHeaders,
      cellStyles: Array.from({ length: columnCount }, () => ({})),
    });
  } else {
    rows.push({
      cells: [block.rowHeader ?? "구분", ...legacyColumns],
      cellStyles: Array.from({ length: columnCount }, () => ({})),
    });
  }

  legacyRows.forEach((row) => {
    rows.push({
      cells: [row.label ?? "", ...(row.cells ?? [])],
      cellStyles: [{}, ...(row.cellStyles ?? [])],
    });
  });

  return {
    ...block,
    gridVersion: 1,
    columns: Array(columnCount).fill(""),
    columnStyles: [{}, ...legacyColumnStyles],
    rows,
    merges,
    groupHeaders: undefined,
    subHeaders: undefined,
    rowHeader: undefined,
  };
}

function describeResponse(response) {
  const statusText = response.statusText ? ` ${response.statusText}` : "";
  return `API 요청 실패 (${response.status}${statusText})`;
}

function parseReport(value, source) {
  if (
    value === null ||
    typeof value !== "object" ||
    !isReportType(value.type) ||
    typeof value.date !== "string" ||
    !Array.isArray(value.blocks) ||
    (value.type.startsWith("custom-") &&
      !["daily", "weekly", "monthly"].includes(value.layoutType))
  ) {
    throw new Error(`${source} 보고서 JSON 형식이 올바르지 않습니다.`);
  }

  return {
    ...value,
    blocks: normalizeReportBlocks(value.blocks),
    pages: Array.isArray(value.pages)
      ? value.pages.map((page) => ({
          ...page,
          blocks: normalizeReportBlocks(page.blocks ?? []),
        }))
      : undefined,
  };
}

export async function getLatestReport() {
  const response = await fetch(latestReportUrl, {
    headers: { Accept: "application/json" },
  });

  if (response.status === 404) {
    return null;
  }
  return parseReport(await parseApiResponse(response), "최신");
}

export async function getReport(type, date) {
  const response = await fetch(
    `${reportsUrl}/${encodeURIComponent(type)}/${encodeURIComponent(date)}`,
    { headers: { Accept: "application/json" } },
  );
  if (response.status === 404) {
    return null;
  }
  return parseReport(await parseApiResponse(response), "저장된");
}

export async function getReportInstance(id) {
  const response = await fetch(
    `${reportsUrl}/instances/${encodeURIComponent(id)}`,
    { headers: { Accept: "application/json" } },
  );
  return parseReport(await parseApiResponse(response), "저장된");
}

// 뷰어에서 수정한 리포트 내용을 같은 리포트에 덮어쓴다.
export async function updateReportInstance(id, report) {
  const saved = await parseApiResponse(
    await fetch(`${reportsUrl}/instances/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        blocks: report.blocks,
        pages: report.pages,
        baseEditedAt: report.editedAt ?? null,
      }),
    }),
  );
  return parseReport(saved, "저장된");
}

export async function generateReportNow(request) {
  const report = await parseApiResponse(
    await fetch(`${reportsUrl}/generate`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }),
  );
  return parseReport(report, "생성된");
}

export async function getSavedReports(type) {
  const url = type
    ? `${reportsUrl}?type=${encodeURIComponent(type)}`
    : reportsUrl;
  const result = await parseApiResponse(
    await fetch(url, { headers: { Accept: "application/json" } }),
  );
  if (!Array.isArray(result.reports)) {
    throw new Error("저장된 보고서 목록 형식이 올바르지 않습니다.");
  }
  return result.reports;
}

export async function getSampleReport() {
  const response = await fetch(sampleReportUrl, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(describeResponse(response));
  }

  return parseReport(await response.json(), "샘플");
}

export async function saveLatestReport(report) {
  return saveReport(report);
}

export async function saveReport(report) {
  const response = await fetch(reportsUrl, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(report),
  });

  await parseApiResponse(response);
}
