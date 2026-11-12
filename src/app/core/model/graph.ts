import { Kind, Point, Rect, Resource } from './types';

/** Node size per kind: [width, height]. */
export const NODE_SIZE: Record<Kind, [number, number]> = {
  agent: [236, 82],
  skill: [224, 52],
  cmd: [172, 48],
  mcp: [172, 52],
  rule: [190, 48],
  mem: [190, 52],
};

export const KIND_LABEL: Record<Kind, string> = {
  agent: 'Agent',
  skill: 'Skill',
  cmd: 'Command',
  mcp: 'MCP server',
  rule: 'Rule',
  mem: 'Memory file',
};

/** Canvas filter chips; memory files share the "rule" filter. */
export const FILTERS: [key: Kind, label: string][] = [
  ['agent', 'Agents'],
  ['skill', 'Skills'],
  ['cmd', 'Commands'],
  ['mcp', 'MCP'],
  ['rule', 'Memory'],
];

export function filterKey(n: Resource): Kind {
  return n.type === 'mem' ? 'rule' : n.type;
}

export const STATUS_LABEL = { ok: 'Valid', warn: 'Warning', err: 'Error' } as const;

export function labelOf(n: Resource): string {
  return n.type === 'cmd' ? '/' + n.name : n.name;
}

export function plural(n: number, word: string): string {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

/** Default column layout: commands and MCP left, agents, skills, then memory and rules. */
export function layout(list: Resource[]): Record<string, Point> {
  const P: Record<string, Point> = {};
  const c = { agent: 0, skill: 0, cmd: 0, mcp: 0, rule: 0 };
  const nCmd = Math.max(1, list.filter((n) => n.type === 'cmd').length);
  for (const n of list) {
    if (n.type === 'agent') P[n.id] = { x: 268, y: 70 + 134 * c.agent++ };
    else if (n.type === 'skill') P[n.id] = { x: 568, y: 62 + 64 * c.skill++ };
    else if (n.type === 'cmd') P[n.id] = { x: 40, y: 87 + 134 * c.cmd++ };
    else if (n.type === 'mcp') P[n.id] = { x: 40, y: 87 + 134 * (nCmd - 1) + 111 + 62 * c.mcp++ };
    else if (n.type === 'rule') P[n.id] = { x: 868, y: 138 + 58 * c.rule++ };
    else P[n.id] = { x: 848, y: 70 };
  }
  return P;
}

/** SVG path for the edge a → b given both node positions. */
export function edgePath(a: Resource, b: Resource, pa: Point, pb: Point, orth: boolean): string {
  const R = Math.round;
  const sa = NODE_SIZE[a.type];
  const sb = NODE_SIZE[b.type];
  if (a.type === 'mem' && b.type === 'rule') {
    const x = R(pa.x + 10);
    const y = R(pb.y + sb[1] / 2);
    return `M${x} ${R(pa.y + sa[1])}V${y - 6}Q${x} ${y} ${x + 6} ${y}H${R(pb.x)}`;
  }
  const fwd = pb.x >= pa.x + sa[0] - 20;
  const sx = R(fwd ? pa.x + sa[0] : pa.x);
  const sy = R(pa.y + sa[1] / 2);
  const tx = R(fwd ? pb.x : pb.x + sb[0]);
  const ty = R(pb.y + sb[1] / 2);
  if (orth) {
    const mx = R((sx + tx) / 2);
    return `M${sx} ${sy}H${mx}V${ty}H${tx}`;
  }
  const k = R(Math.max(36, Math.abs(tx - sx) * 0.5) * (fwd ? 1 : -1));
  return `M${sx} ${sy}C${sx + k} ${sy} ${tx - k} ${ty} ${tx} ${ty}`;
}

/** Padded bounding box of all nodes; used by fit-to-screen and the mini-map. */
export function bounds(list: Resource[], pos: (id: string) => Point): Rect {
  if (!list.length) return { x: 0, y: 0, w: 800, h: 600 };
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  for (const n of list) {
    const p = pos(n.id);
    const z = NODE_SIZE[n.type];
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + z[0]);
    y1 = Math.max(y1, p.y + z[1]);
  }
  return { x: x0 - 30, y: y0 - 46, w: x1 - x0 + 60, h: y1 - y0 + 76 };
}
