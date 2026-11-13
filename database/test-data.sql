CREATE TABLE IF NOT EXISTS sample_daily_stats (
  report_date DATE NOT NULL,
  period_label VARCHAR(16) NOT NULL,
  monitored_total INT NOT NULL,
  detected_total INT NOT NULL,
  ignored_closed INT NOT NULL,
  self_closed INT NOT NULL,
  action_required INT NOT NULL,
  repeated_detected INT NOT NULL,
  PRIMARY KEY (report_date, period_label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sample_security_events (
  event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  report_date DATE NOT NULL,
  occurred_at DATETIME NOT NULL,
  institution_name VARCHAR(120) NOT NULL,
  threat_type VARCHAR(120) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  response_status VARCHAR(24) NOT NULL,
  action_requested_at DATETIME NULL,
  action_completed_at DATETIME NULL,
  notes VARCHAR(500) NOT NULL DEFAULT '',
  UNIQUE KEY uq_sample_event (report_date, occurred_at, institution_name, threat_type),
  KEY ix_sample_events_report_status (report_date, response_status),
  KEY ix_sample_events_occurred_at (occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sample_operations_tasks (
  task_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  report_date DATE NOT NULL,
  section_name VARCHAR(80) NOT NULL,
  task_title VARCHAR(180) NOT NULL,
  task_status VARCHAR(24) NOT NULL,
  owner_name VARCHAR(80) NOT NULL,
  details VARCHAR(500) NOT NULL,
  next_action VARCHAR(500) NOT NULL DEFAULT '',
  UNIQUE KEY uq_sample_task (report_date, task_title),
  KEY ix_sample_tasks_report_status (report_date, task_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO sample_daily_stats (
  report_date, period_label, monitored_total, detected_total,
  ignored_closed, self_closed, action_required, repeated_detected
) VALUES
  ('2026-11-07', '전일', 258, 97, 9, 4, 0, 84),
  ('2026-11-07', '금일', 40, 26, 7, 5, 1, 14),
  ('2026-11-07', '증감', -218, -71, -2, 1, 1, -70),
  ('2026-11-08', '전일', 40, 26, 7, 5, 1, 14),
  ('2026-11-08', '금일', 53, 31, 8, 6, 2, 18),
  ('2026-11-08', '증감', 13, 5, 1, 1, 1, 4)
ON DUPLICATE KEY UPDATE
  monitored_total = VALUES(monitored_total),
  detected_total = VALUES(detected_total),
  ignored_closed = VALUES(ignored_closed),
  self_closed = VALUES(self_closed),
  action_required = VALUES(action_required),
  repeated_detected = VALUES(repeated_detected);

INSERT INTO sample_security_events (
  report_date, occurred_at, institution_name, threat_type, severity,
  response_status, action_requested_at, action_completed_at, notes
) VALUES
  ('2026-11-07', '2026-11-07 08:14:00', '가천대길병원', '비정상 로그인 시도', '높음', '조치 완료', '2026-11-07 08:22:00', '2026-11-07 08:41:00', '계정 잠금 및 접속 기록 확인'),
  ('2026-11-07', '2026-11-07 09:03:00', '가천대길병원', '악성 URL 접속 탐지', '중간', '회신 대기', '2026-11-07 09:16:00', NULL, '사용자 단말 점검 요청'),
  ('2026-11-07', '2026-11-07 10:27:00', '인천의료원', '랜섬웨어 의심 파일', '높음', '조치 완료', '2026-11-07 10:32:00', '2026-11-07 11:05:00', '파일 격리 후 백신 검사'),
  ('2026-11-07', '2026-11-07 12:48:00', '가천대길병원', '웹 취약점 스캔', '낮음', '분석 중', '2026-11-07 13:02:00', NULL, '정상 점검인지 담당자 확인 중'),
  ('2026-11-07', '2026-11-07 14:11:00', '인하대학교병원', '비정상 외부 통신', '중간', '회신 대기', '2026-11-07 14:25:00', NULL, '방화벽 정책 및 프로세스 확인 요청'),
  ('2026-11-07', '2026-11-07 15:36:00', '인천의료원', '피싱 메일 첨부파일', '중간', '조치 완료', '2026-11-07 15:44:00', '2026-11-07 16:10:00', '메일 격리 및 수신자 안내'),
  ('2026-11-08', '2026-11-08 08:12:00', '가천대길병원', '비정상 로그인 시도', '중간', '분석 중', '2026-11-08 08:20:00', NULL, '테스트 데이터: 접속 위치 확인 중'),
  ('2026-11-08', '2026-11-08 09:47:00', '인천의료원', '악성 URL 접속 탐지', '높음', '회신 대기', '2026-11-08 09:53:00', NULL, '테스트 데이터: 단말 점검 요청'),
  ('2026-11-06', '2026-11-06 17:20:00', '가천대길병원', '홈페이지 위변조 의심', '높음', '종결', '2026-11-06 17:31:00', '2026-11-06 18:02:00', '정상 배포 작업으로 확인')
ON DUPLICATE KEY UPDATE
  report_date = VALUES(report_date),
  occurred_at = VALUES(occurred_at),
  institution_name = VALUES(institution_name),
  threat_type = VALUES(threat_type),
  severity = VALUES(severity),
  response_status = VALUES(response_status),
  action_requested_at = VALUES(action_requested_at),
  action_completed_at = VALUES(action_completed_at),
  notes = VALUES(notes);

INSERT INTO sample_operations_tasks (
  report_date, section_name, task_title, task_status, owner_name, details, next_action
) VALUES
  ('2026-11-07', '보안관제', '고위험 경보 교차 분석', '완료', '관제 1팀', '전일 대비 고위험 경보 12건의 연관성과 오탐 여부 확인', '분석 결과를 주간 추세에 반영'),
  ('2026-11-07', '취약점 관리', '주요 서버 취약점 조치 확인', '진행 중', '인프라팀', '운영 서버 3대의 보안 패치 적용 여부 확인', '담당 부서 회신 후 재점검'),
  ('2026-11-07', '피싱 대응', '의심 메일 신고 및 차단', '완료', '메일 보안 담당', '의심 발신 도메인 차단 및 영향 사용자 안내', '유사 발신 재유입 모니터링'),
  ('2026-11-07', '정기 점검', '로그 수집 상태 확인', '진행 중', '플랫폼팀', '주요 보안 장비의 로그 수집 지연 여부 점검', '누락 로그 재전송 확인'),
  ('2026-11-07', '보고 및 공유', '일일 관제 보고서 작성', '대기', '관제 책임자', '탐지 현황과 기관별 조치 결과 취합', '검토 완료 후 보고서 배포'),
  ('2026-11-08', '보안관제', '예약 보고서 생성 확인', '진행 중', '관제 1팀', '매일 오전 8시 자동 보고서 생성 테스트', '뷰어에서 2026-11-08 보고서 확인'),
  ('2026-11-08', '정기 점검', '샘플 통계 데이터 검증', '대기', '플랫폼팀', '테스트용 2026-11-08 통계 행 확인', '보고서 집계 결과와 비교'),
  ('2026-11-06', '보안관제', '홈페이지 변조 경보 검증', '완료', '관제 2팀', '정기 배포 작업과 경보 발생 시각 대조', '정상 작업 예외 목록 갱신')
ON DUPLICATE KEY UPDATE
  report_date = VALUES(report_date),
  section_name = VALUES(section_name),
  task_title = VALUES(task_title),
  task_status = VALUES(task_status),
  owner_name = VALUES(owner_name),
  details = VALUES(details),
  next_action = VALUES(next_action);
