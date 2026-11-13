import { labelOf, plural } from './graph';
import { COPYABLE, Change, CopyItem, Model, Resource } from './types';

/**
 * A resource that will be copied, with what the dialog shows about it.
 */
export interface PlannedCopy extends CopyItem {
  /** Id of the resource in the open workspace. */
  id: string;
  /** Name as shown on the canvas. */
  label: string;
  /** The resource has pending edits. The copy is taken from disk, so it will not include them. */
  unsaved: boolean;
  /** Added because a selected agent uses it, not because the user picked it. */
  viaAgent: boolean;
}

/**
 * What a copy request comes down to once resources that cannot be copied are set aside.
 */
export interface CopyPlan {
  /** Resources to copy, selected ones first, without duplicates. */
  items: PlannedCopy[];
  /** Selected resources that cannot be copied, each with the reason to show the user. */
  blocked: { label: string; reason: string }[];
  /** Number of project skills the selected agents use that the user did not select themselves. */
  agentSkills: number;
}

/**
 * Why a resource cannot be copied to another project.
 *
 * @param n - Resource from the open workspace.
 * @returns The reason as a sentence fragment that follows the resource name, or null when it can be copied.
 * Agents, skills, commands, rules and MCP servers of the project can be copied; CLAUDE.md cannot.
 */
export function copyBlocker(n: Resource): string | null {
  if (COPYABLE.indexOf(n.type as CopyItem['kind']) < 0) return 'is specific to its project and cannot be copied';
  if (n.missing) return 'does not exist';
  if (n.raw === undefined) return 'has not been saved yet. Save it first';
  if (n.scope === 'user') return 'is in user scope, so every project already has it';
  if (n.scope === 'managed') return 'is deployed by your organization and cannot be copied';
  if (n.scope !== 'project') return `belongs to ${n.scope ?? 'another'} scope and cannot be copied`;
  return null;
}

/**
 * Works out which files a copy request covers.
 *
 * @remarks
 * Skills used by a selected agent are only added when they are project skills on disk; user and
 * plugin skills are available in the destination already, or are not ours to copy. MCP servers
 * an agent uses are not added: they hold credentials and addresses the user should choose to share.
 *
 * @param ids - Ids of the resources the user chose. Unknown ids are ignored.
 * @param model - Current workspace model, used to look resources and relationships up.
 * @param changes - Pending changes, used to flag resources whose copy will lack unsaved edits.
 * @param withSkills - Whether to add the project skills that selected agents use.
 * @returns The files to copy and the chosen resources that had to be left out.
 */
export function copyPlan(ids: string[], model: Model, changes: Change[], withSkills: boolean): CopyPlan {
  const changed = new Set(changes.map((c) => c.id));
  const items: PlannedCopy[] = [];
  const blocked: CopyPlan['blocked'] = [];
  const seen = new Set<string>();

  const add = (n: Resource, viaAgent: boolean): void => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    // A server is one key of a shared file, so the item also says which one.
    const name = n.type === 'mcp' ? { name: n.name } : {};
    items.push({ id: n.id, kind: n.type as CopyItem['kind'], file: n.file, ...name, label: labelOf(n), unsaved: changed.has(n.id), viaAgent });
  };

  const chosen = ids.map((id) => model.by[id]).filter((n): n is Resource => !!n);
  for (const n of chosen) {
    const reason = copyBlocker(n);
    if (reason) blocked.push({ label: labelOf(n), reason });
    else add(n, false);
  }

  const picked = new Set(seen);
  const used: Resource[] = [];
  for (const agent of chosen.filter((n) => n.type === 'agent' && seen.has(n.id))) {
    for (const [from, to] of model.rel) {
      const skill = model.by[to];
      if (from === agent.id && skill?.type === 'skill' && !picked.has(skill.id) && !copyBlocker(skill) && used.indexOf(skill) < 0) used.push(skill);
    }
  }
  if (withSkills) used.forEach((skill) => add(skill, true));

  return { items, blocked, agentSkills: used.length };
}

/**
 * Sentence for the toast and activity log after a copy.
 *
 * @param copied - Number of resources written.
 * @param skipped - Number left alone because the destination already had them.
 * @param destination - Name of the destination project.
 * @returns For example "Copied 3 resources to billing-api (1 skipped: already there)".
 */
export function copySummary(copied: number, skipped: number, destination: string): string {
  if (!copied) return `Nothing copied to ${destination}: ${skipped === 1 ? 'it is' : `all ${skipped} are`} already there`;
  return `Copied ${plural(copied, 'resource')} to ${destination}` + (skipped ? ` (${skipped} skipped: already there)` : '');
}
