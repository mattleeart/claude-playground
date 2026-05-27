# 코드 하이라이트 샘플

여러 언어의 코드 블록이 구문 강조되는지 확인합니다. 각 블록 우측 상단의 복사 버튼도 테스트합니다.

## JavaScript

```javascript
async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const users = [1, 2, 3].map((n) => ({ id: n, active: n % 2 === 0 }));
```

## Python

```python
from dataclasses import dataclass

@dataclass
class Point:
    x: float
    y: float

    def dist(self, other: "Point") -> float:
        return ((self.x - other.x) ** 2 + (self.y - other.y) ** 2) ** 0.5

print(Point(0, 0).dist(Point(3, 4)))  # 5.0
```

## Rust

```rust
fn main() {
    let nums = vec![1, 2, 3, 4, 5];
    let sum: i32 = nums.iter().filter(|&&n| n % 2 == 1).sum();
    println!("odd sum = {}", sum);
}
```

## Go

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 3)
    for i := 0; i < 3; i++ { ch <- i * i }
    close(ch)
    for v := range ch { fmt.Println(v) }
}
```

## SQL

```sql
SELECT u.name, COUNT(o.id) AS orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.created_at > '2024-01-01'
GROUP BY u.name
HAVING COUNT(o.id) > 5
ORDER BY orders DESC;
```

## Bash

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "processing ${f}"
  wc -l "$f"
done
```

## JSON

```json
{
  "name": "viewer",
  "features": ["mermaid", "katex", "highlight"],
  "mobile": true,
  "version": 2.0
}
```

## 긴 한 줄 (가로 스크롤 확인)

```text
this_is_a_very_long_single_line_of_code_that_should_scroll_horizontally_inside_the_pre_block_without_wrapping_or_breaking_the_mobile_layout_x_x_x_end
```
