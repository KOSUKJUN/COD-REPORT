export function validateReadOnlyQuery(sql) {
  if (typeof sql !== "string" || sql.length === 0 || sql.length > 10000) {
    const error = new Error("쿼리는 1~10,000자여야 합니다.");
    error.status = 400;
    throw error;
  }
  if (/[;#]|--|\/\*/.test(sql)) {
    const error = new Error("주석과 여러 SQL 문장은 사용할 수 없습니다.");
    error.status = 400;
    throw error;
  }
  if (!/^\s*(SELECT|WITH)\b/i.test(sql)) {
    const error = new Error("SELECT 또는 WITH 조회 쿼리만 실행할 수 있습니다.");
    error.status = 400;
    throw error;
  }

  const queryWithoutLiterals = sql.replace(
    /'(?:''|\\.|[^'\\])*'|"(?:\"\"|\\.|[^"\\])*"|`(?:``|[^`])*`/g,
    " ",
  );
  if (
    /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE|CALL|DO|HANDLER|LOAD|SET|PREPARE|EXECUTE|DEALLOCATE)\b/i.test(
      queryWithoutLiterals,
    ) ||
    /:=|\bINTO\s+(?:OUTFILE|DUMPFILE)\b|\bLOAD_FILE\s*\(|\b(?:SLEEP|BENCHMARK|GET_LOCK|RELEASE_LOCK|NEXTVAL)\s*\(|\bFOR\s+UPDATE\b|\bLOCK\s+IN\s+SHARE\s+MODE\b/i.test(
      queryWithoutLiterals,
    )
  ) {
    const error = new Error("변경·잠금·파일 접근 쿼리는 실행할 수 없습니다.");
    error.status = 400;
    throw error;
  }

  return sql.trim();
}

export function countQueryParameters(sql) {
  const queryWithoutLiterals = sql.replace(
    /'(?:''|\\.|[^'\\])*'|"(?:\"\"|\\.|[^"\\])*"|`(?:``|[^`])*`/g,
    " ",
  );
  return (queryWithoutLiterals.match(/\?/g) ?? []).length;
}
