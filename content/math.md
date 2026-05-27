# 수학 수식 (KaTeX)

`$...$`는 인라인, `$$...$$`는 블록(디스플레이) 수식으로 렌더링됩니다.

## 인라인

질량-에너지 등가는 $E = mc^2$ 이고, 피타고라스 정리는 $a^2 + b^2 = c^2$ 입니다.
오일러 항등식 $e^{i\pi} + 1 = 0$ 도 인라인으로 표시됩니다.

## 블록 수식

이차방정식의 근:

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

가우스 적분:

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

## 행렬

$$
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
\begin{pmatrix} x \\ y \end{pmatrix}
=
\begin{pmatrix} ax + by \\ cx + dy \end{pmatrix}
$$

## 합과 극한

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}, \qquad
\lim_{x \to 0} \frac{\sin x}{x} = 1
$$

## 코드 안의 달러는 수식이 아님

인라인 코드 `price = $5 + $3` 는 수식으로 처리되면 안 됩니다.

```bash
echo "$HOME costs $5"
```
