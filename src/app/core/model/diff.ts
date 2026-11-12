import { DiffLine } from './types';

/** Line diff based on the longest common subsequence. */
export function diff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const L: number[][] = [];
  for (let i = 0; i <= n; i++) L.push(new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ c: 'ctx', o: i + 1, n: j + 1, s: ' ', t: a[i] });
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) {
      out.push({ c: 'del', o: i + 1, n: '', s: '−', t: a[i] });
      i++;
    } else {
      out.push({ c: 'add', o: '', n: j + 1, s: '+', t: b[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ c: 'del', o: i + 1, n: '', s: '−', t: a[i] });
    i++;
  }
  while (j < m) {
    out.push({ c: 'add', o: '', n: j + 1, s: '+', t: b[j] });
    j++;
  }
  return out;
}
