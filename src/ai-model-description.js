export function getModelDescription(provider, id) {
  if (typeof id !== "string") return null;
  const name = id.toLowerCase();
  if (provider === "anthropic" && /^claude-/.test(name)) {
    if (/(?:^|-)opus(?:-|$)/.test(name)) return "Opus 계열: 복잡한 작업에 중점을 둔 모델입니다.";
    if (/(?:^|-)sonnet(?:-|$)/.test(name)) return "Sonnet 계열: 성능과 속도의 균형을 지향하는 모델입니다.";
    if (/(?:^|-)haiku(?:-|$)/.test(name)) return "Haiku 계열: 빠른 응답과 효율성을 지향하는 모델입니다.";
  }
  if (provider === "gemini" && /^gemini-/.test(name)) {
    if (/(?:^|-)flash-lite(?:-|$)/.test(name)) return "Flash-Lite 계열: 속도와 효율성에 중점을 둔 모델입니다.";
    if (/(?:^|-)flash(?:-|$)/.test(name)) return "Flash 계열: 빠른 응답과 효율성을 지향하는 모델입니다.";
    if (/(?:^|-)pro(?:-|$)/.test(name)) return "Pro 계열: 복잡한 작업에 중점을 둔 모델입니다.";
  }
  if (provider === "ollama") {
    if (/qwen/.test(name)) return "Qwen 비전 계열: 한글 인식과 요소 위치 파악에 강해 문서 서식 변환에 권장합니다. 27B 이상이 표 병합과 음영을 더 정확히 인식합니다.";
    if (/gemma/.test(name)) return "Gemma 비전 계열: 이미지를 읽을 수 있지만 표와 요소 위치 인식은 Qwen 계열보다 부정확할 수 있습니다.";
    return null;
  }
  if (provider === "openai" && /^(?:gpt-|o\d)/.test(name)) {
    if (/(?:^|-)nano(?:-|$)/.test(name)) return "nano 계열: 경량화와 효율성을 지향하는 모델입니다.";
    if (/(?:^|-)mini(?:-|$)/.test(name)) return "mini 계열: 크기와 속도, 비용 효율의 균형을 지향하는 모델입니다.";
    if (/(?:^|-)pro(?:-|$)/.test(name)) return "pro 계열: 복잡한 작업에 중점을 둔 모델입니다.";
    if (/^o\d/.test(name)) return "추론 모델 계열: 단계적인 문제 해결에 중점을 둔 모델입니다.";
    return "GPT 계열 모델입니다. 세부 기능과 요금은 제공자 문서에서 확인해 주세요.";
  }
  return null;
}
