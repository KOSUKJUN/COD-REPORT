// 외부 DB 접속정보(URL) 해석과 DB별 SQL 차이 처리. 서버와 화면이 함께 사용한다.

export const DATASOURCE_TYPES = [
  {
    value: "oracle",
    label: "Oracle",
    defaultPort: 1521,
    example: "jdbc:oracle:thin:@//192.168.0.101:1521/ORCLPDB1",
    hint: "서비스명: jdbc:oracle:thin:@//호스트:포트/서비스명 · SID: jdbc:oracle:thin:@호스트:포트:SID",
  },
  {
    value: "postgresql",
    label: "PostgreSQL",
    defaultPort: 5432,
    example: "jdbc:postgresql://192.168.0.10:5432/reportdb",
    hint: "jdbc:postgresql://호스트:포트/DB명 (SSL 사용 시 ?sslmode=require)",
  },
  {
    value: "mariadb",
    label: "MariaDB",
    defaultPort: 3306,
    example: "jdbc:mariadb://192.168.0.20:3306/reportdb",
    hint: "jdbc:mariadb://호스트:포트/DB명 (jdbc:mysql:// 형식도 사용 가능)",
  },
  {
    value: "clickhouse",
    label: "ClickHouse",
    defaultPort: 8123,
    example: "jdbc:clickhouse://192.168.0.30:8123/default",
    hint: "jdbc:clickhouse://호스트:HTTP포트/DB명 (HTTP 8123, HTTPS 8443 · ?ssl=true)",
  },
];

const TYPE_PREFIXES = {
  oracle: [/^jdbc:oracle:thin:@/i, /^oracle:\/\//i],
  postgresql: [/^jdbc:postgresql:/i, /^postgres(?:ql)?:/i],
  mariadb: [/^jdbc:(?:mariadb|mysql):/i, /^(?:mariadb|mysql):/i],
  clickhouse: [/^jdbc:(?:clickhouse|ch):/i, /^clickhouse:/i],
};

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export function getDatasourceType(type) {
  return DATASOURCE_TYPES.find((item) => item.value === type) ?? null;
}

function parseQuery(text = "") {
  return Object.fromEntries(
    text
      .split(/[&;]/)
      .filter(Boolean)
      .map((pair) => {
        const [key, ...rest] = pair.split("=");
        return [decodeURIComponent(key).toLowerCase(), decodeURIComponent(rest.join("="))];
      }),
  );
}

// "//host:port/db?query" 또는 "host:port/db" 형식
function parseHostPath(rest, defaultPort) {
  const match = /^(?:\/\/)?([^/:?\s]+)(?::(\d{1,5}))?(?:\/([^?\s]*))?(?:\?(.*))?$/.exec(rest);
  if (!match) return null;
  const port = match[2] ? Number(match[2]) : defaultPort;
  if (port < 1 || port > 65535) return null;
  return {
    host: match[1],
    port,
    database: match[3] ? decodeURIComponent(match[3]) : "",
    query: parseQuery(match[4]),
  };
}

export function parseDatasourceUrl(type, rawUrl) {
  const definition = getDatasourceType(type);
  if (!definition) throw invalid("지원하지 않는 DB 종류입니다.");
  const url = String(rawUrl ?? "").trim();
  if (!url) throw invalid("URL을 입력해 주세요.");

  let rest = url;
  let protocol = "";
  for (const prefix of TYPE_PREFIXES[type]) {
    if (prefix.test(rest)) {
      rest = rest.replace(prefix, "");
      break;
    }
  }
  if (type === "clickhouse" && /^https?:\/\//i.test(rest)) {
    protocol = rest.slice(0, rest.indexOf(":")).toLowerCase();
    rest = rest.replace(/^https?:/i, "");
  }

  if (type === "oracle") {
    // TNS 접속 기술자는 그대로 사용한다.
    if (rest.startsWith("(")) {
      return { type, connectString: rest };
    }
    const sid = /^(?:\/\/)?([^/:?\s]+):(\d{1,5}):([A-Za-z0-9_$#.]+)$/.exec(rest);
    if (sid) {
      const [, host, port, sidName] = sid;
      return {
        type,
        host,
        port: Number(port),
        database: sidName,
        connectString: `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SID=${sidName})))`,
      };
    }
    const parsed = parseHostPath(rest, definition.defaultPort);
    if (!parsed || !parsed.database) {
      throw invalid(`Oracle URL 형식이 올바르지 않습니다. 예: ${definition.example}`);
    }
    return {
      type,
      host: parsed.host,
      port: parsed.port,
      database: parsed.database,
      connectString: `${parsed.host}:${parsed.port}/${parsed.database}`,
    };
  }

  const parsed = parseHostPath(rest, definition.defaultPort);
  if (!parsed) {
    throw invalid(`${definition.label} URL 형식이 올바르지 않습니다. 예: ${definition.example}`);
  }

  if (type === "postgresql") {
    const sslmode = parsed.query.sslmode || (parsed.query.ssl === "true" ? "require" : "");
    return {
      type,
      host: parsed.host,
      port: parsed.port,
      database: parsed.database || "postgres",
      ssl: ["require", "verify-ca", "verify-full"].includes(sslmode),
    };
  }

  if (type === "clickhouse") {
    const secure = protocol === "https" || parsed.query.ssl === "true" || parsed.query.secure === "true";
    const port = /:\d{1,5}(?:\/|\?|$)/.test(rest) ? parsed.port : secure ? 8443 : 8123;
    return {
      type,
      host: parsed.host,
      port,
      database: parsed.database || "default",
      httpUrl: `${secure ? "https" : "http"}://${parsed.host}:${port}`,
    };
  }

  return {
    type,
    host: parsed.host,
    port: parsed.port,
    database: parsed.database,
  };
}

// SQL 문자열·식별자 안의 ? 는 건드리지 않는다.
const LITERAL_OR_PLACEHOLDER = /'(?:''|\\.|[^'\\])*'|"(?:""|\\.|[^"\\])*"|`(?:``|[^`])*`|\?/g;

// 화면에서는 모든 DB에 ? 를 쓰고, 실행할 때 DB별 자리표시자로 바꾼다.
export function convertPlaceholders(sql, type) {
  let index = 0;
  return sql.replace(LITERAL_OR_PLACEHOLDER, (token) => {
    if (token !== "?") return token;
    index += 1;
    if (type === "postgresql") return `$${index}`;
    if (type === "oracle") return `:${index}`;
    if (type === "clickhouse") return `{p${index}:String}`;
    return "?";
  });
}

export function wrapWithRowLimit(sql, type, limit) {
  if (type === "oracle") {
    return `SELECT * FROM (${sql}) WHERE ROWNUM <= ${limit}`;
  }
  return `SELECT * FROM (${sql}) AS report_binding_result LIMIT ${limit}`;
}

export function connectionTestQuery(type) {
  return type === "oracle" ? "SELECT 1 AS ok FROM DUAL" : "SELECT 1 AS ok";
}
