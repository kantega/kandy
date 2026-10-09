/** One word of a transcript, flagged when the other transcript lacks it. */
export interface DiffWord {
  text: string;
  differs: boolean;
}

/** Comparison key: case and surrounding punctuation do not count as a difference. */
const normalize = (word: string): string =>
  word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/**
 * Word-level diff of two transcripts via longest common subsequence. Returns
 * both sides with the words outside the common subsequence flagged, plus the
 * number of flagged words across both sides.
 */
export function diffWords(
  a: string,
  b: string,
): { a: DiffWord[]; b: DiffWord[]; differing: number } {
  const wa = words(a);
  const wb = words(b);
  const na = wa.map(normalize);
  const nb = wb.map(normalize);

  // lcs[i][j] = LCS length of na[i..] and nb[j..].
  const lcs: number[][] = Array.from({ length: wa.length + 1 }, () =>
    new Array<number>(wb.length + 1).fill(0),
  );
  for (let i = wa.length - 1; i >= 0; i--) {
    for (let j = wb.length - 1; j >= 0; j--) {
      lcs[i][j] =
        na[i] === nb[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const keepA = new Array<boolean>(wa.length).fill(false);
  const keepB = new Array<boolean>(wb.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < wa.length && j < wb.length) {
    if (na[i] === nb[j]) {
      keepA[i++] = true;
      keepB[j++] = true;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  const sideA = wa.map((text, k) => ({ text, differs: !keepA[k] }));
  const sideB = wb.map((text, k) => ({ text, differs: !keepB[k] }));
  const differing =
    sideA.filter((w) => w.differs).length +
    sideB.filter((w) => w.differs).length;
  return { a: sideA, b: sideB, differing };
}
