# Mermaid 다이어그램

코드 펜스에 `mermaid`를 지정하면 다이어그램으로 렌더링됩니다.

## 플로우차트

```mermaid
flowchart TD
    A[시작] --> B{로그인?}
    B -- 예 --> C[문서 목록]
    B -- 아니오 --> D[패턴 입력]
    D --> B
    C --> E[문서 보기]
    E --> F[끝]
```

## 시퀀스 다이어그램

```mermaid
sequenceDiagram
    participant U as 사용자
    participant V as 뷰어
    participant G as GitHub
    U->>V: 패턴 입력
    V->>V: PBKDF2 검증
    V->>G: manifest.json 요청
    G-->>V: 문서 목록
    V-->>U: 렌더링된 문서
```

## 파이 차트

```mermaid
pie title 콘텐츠 구성
    "코드" : 35
    "텍스트" : 40
    "다이어그램" : 15
    "이미지" : 10
```

## 간트 차트

```mermaid
gantt
    title 개발 로드맵
    dateFormat YYYY-MM-DD
    section 핵심
    뷰어 :done, a1, 2024-01-01, 3d
    하이라이트 :active, a2, after a1, 2d
    section 확장
    다이어그램 : a3, after a2, 2d
    수식 : a4, after a3, 2d
```

## 상태 다이어그램

```mermaid
stateDiagram-v2
    [*] --> 잠김
    잠김 --> 해제: 올바른 패턴
    잠김 --> 잠김: 틀린 패턴
    해제 --> 잠김: 잠그기
    해제 --> [*]
```

## 잘못된 다이어그램 (오류 처리 확인)

```mermaid
this is not valid mermaid syntax @@@
```
