---
tags: [markdown, gfm]
---

# GFM 종합 샘플

GitHub Flavored Markdown의 다양한 요소를 한 화면에서 확인합니다.

## 텍스트 강조

**굵게**, *기울임*, ***굵은 기울임***, ~~취소선~~, `인라인 코드`, H~2~O 아래첨자는 표준 밖입니다.

자동 링크: https://github.com 그리고 이메일 test@example.com

## 목록

### 순서 없는 (중첩)

- 1단계
  - 2단계
    - 3단계
      - 4단계
- 다시 1단계

### 순서 있는

1. 첫째
2. 둘째
   1. 둘-하나
   2. 둘-둘
3. 셋째

### 작업 목록

- [x] 디자인
- [x] 구현
- [ ] 테스트
- [ ] 배포

## 인용 (중첩)

> 1단계 인용
>
> > 2단계 인용
> >
> > > 3단계 인용

## 표 (정렬)

| 왼쪽 정렬 | 가운데 | 오른쪽 정렬 |
| :-------- | :----: | ----------: |
| a         |   b    |           c |
| 긴 텍스트 항목 | x | 12345 |
| 가 | 나 | 다 |

## 수평선

---

## 인라인 HTML / details

<details>
<summary>접고 펼치기 (탭하세요)</summary>

숨겨진 내용입니다. `details/summary`가 동작하면 이 텍스트가 보입니다.

</details>

## 이모지

:rocket: 같은 단축코드는 표준 밖이지만, 유니코드 이모지는 직접 표시됩니다 🚀🎉✅🔥📱

## 긴 단어 / 줄바꿈

VeryLongWordWithoutSpacesThatShouldWrapOrScrollGracefullyOnNarrowMobileScreensWithoutBreakingLayout

연속  공백과
줄바꿈   처리도 확인합니다.
