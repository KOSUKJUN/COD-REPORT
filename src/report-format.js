// 보고서 화면과 내보내기 파일이 같은 문구를 쓰도록 공유하는 표시 형식.

export function formatReportDate(value) {
  if (!value) {
    return "";
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return String(value);
  }
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "long" }).format(date);
}

export function formatReportPeriod(value) {
  if (!value) {
    return "";
  }
  const periodDate = new Date(value);
  if (Number.isNaN(periodDate.valueOf())) {
    return String(value);
  }
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][periodDate.getDay()];
  const year = periodDate.getFullYear();
  const month = String(periodDate.getMonth() + 1).padStart(2, "0");
  const day = String(periodDate.getDate()).padStart(2, "0");
  const hours = String(periodDate.getHours()).padStart(2, "0");
  const minutes = String(periodDate.getMinutes()).padStart(2, "0");
  return `${year}.${month}.${day}(${weekday}) ${hours}:${minutes}`;
}
