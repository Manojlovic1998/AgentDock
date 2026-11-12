import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { plural } from '../../core/model/graph';
import { SEVERITY_ICON } from '../../core/model/icons';
import { Kind } from '../../core/model/types';
import { Commands } from '../../core/state/commands';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { Icon } from '../../ui/icon';

/** Workspace summary: counts, distribution, sources, top problems and pending changes. */
@Component({
  selector: 'ad-overview',
  imports: [Icon],
  template: `
    <div class="mx-auto flex max-w-[1080px] flex-col gap-4">
      <div class="flex flex-wrap items-center gap-3">
        <div class="min-w-60 flex-1">
          <h1 class="m-0 text-[17px] font-semibold tracking-[-0.01em]">{{ ws.snapshot.name }}</h1>
          <div class="mt-0.5 font-mono text-[11.5px] text-tx3">
            {{ ws.snapshot.path }} · branch {{ ws.snapshot.branch }} · scanned 2 minutes ago
          </div>
        </div>
        <button class="bt" (click)="cmd.runValidation()"><svg adIcon="shield"></svg>Run validation</button>
        <button class="bt pr" (click)="cmd.go('workspace')"><svg adIcon="network"></svg>Open visual workspace</button>
      </div>

      <div class="pnl grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))]">
        @for (st of stats(); track st.label) {
          <button class="flex flex-col gap-1 border-r border-line px-3.5 py-3 text-left hover:bg-bg3" (click)="cmd.go(st.screen)">
            <span class="lb">{{ st.label }}</span>
            <span class="flex items-baseline gap-2">
              <span class="font-mono text-[22px] font-medium tracking-[-0.02em]">{{ st.value }}</span>
              <span class="text-[11.5px] text-tx2" [class.c-err]="st.bad">{{ st.note }}</span>
            </span>
          </button>
        }
      </div>

      <div class="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] items-start gap-4">
        <div class="flex flex-col gap-4">
          <section class="pnl">
            <div class="ph">
              <span class="lb flex-1">Resource distribution</span>
              <span class="font-mono text-[11px] text-tx3">{{ totalLabel() }}</span>
            </div>
            <div class="p-3">
              <div class="flex h-2 gap-0.5 overflow-hidden rounded-sm">
                @for (d of dist(); track d.type) {
                  <span class="basis-0 bg-k" [class]="'k-' + d.type" [style.flex-grow]="d.n"></span>
                }
              </div>
              <div class="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
                @for (d of dist(); track d.type) {
                  <button class="lr !h-[26px]" [class]="'k-' + d.type" (click)="cmd.go(d.screen)">
                    <span class="size-2 rounded-xs bg-k"></span>
                    <span class="flex-1 text-left">{{ d.label }}</span>
                    <span class="font-mono text-tx2">{{ d.n }}</span>
                  </button>
                }
              </div>
            </div>
          </section>
          <section class="pnl">
            <div class="ph"><span class="lb flex-1">Configuration sources</span></div>
            <div class="p-1.5">
              @for (so of sources(); track so.path) {
                <div class="lr">
                  <svg adIcon="folder" class="text-tx3"></svg>
                  <span class="w-[150px] font-mono text-[11.5px]">{{ so.path }}</span>
                  <span class="el min-w-0 flex-1 text-tx2">{{ so.note }}</span>
                  <span class="chip">{{ so.scope }}</span>
                </div>
              }
            </div>
          </section>
        </div>

        <div class="flex flex-col gap-4">
          <section class="pnl">
            <div class="ph">
              <span class="lb flex-1">Needs attention</span>
              <button class="bt gh !h-[22px]" (click)="cmd.go('validation')">All problems<svg adIcon="chevR" class="s"></svg></button>
            </div>
            <div class="p-1.5">
              @for (p of topProblems(); track $index) {
                <button class="lr !h-auto !items-start !p-1.5 text-left" (click)="cmd.openProblem(p)">
                  <svg [adIcon]="sevIcon[p.sev]" class="mt-px" [class]="'c-' + p.sev"></svg>
                  <span class="flex-1 leading-[1.45]">
                    {{ p.msg }}<span class="block font-mono text-[10.5px] text-tx3">{{ p.file }}</span>
                  </span>
                </button>
              }
            </div>
          </section>
          <section class="pnl">
            <div class="ph">
              <span class="lb flex-1">Recent changes</span>
              <button class="bt gh !h-[22px]" (click)="cmd.go('changes')">Review<svg adIcon="chevR" class="s"></svg></button>
            </div>
            <div class="p-1.5">
              @for (c of ws.changes(); track c.id) {
                <button class="lr" (click)="cmd.openChange(c.id)">
                  <span class="kd" [class]="c.kind">{{ c.kind }}</span>
                  <span class="el min-w-0 flex-1 text-left font-mono text-[11.5px]">{{ c.file }}</span>
                  <span class="c-ok font-mono text-[11px]">+{{ c.add }}</span>
                  <span class="c-err font-mono text-[11px]">−{{ c.del }}</span>
                </button>
              } @empty {
                <div class="p-2 text-tx3">No pending changes. Configuration on disk matches the editor.</div>
              }
            </div>
          </section>
        </div>
      </div>
    </div>
  `,
  host: { class: 'scr block min-h-0 flex-1 overflow-y-auto px-6 py-5' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Overview {
  protected readonly ws = inject(WorkspaceStore);
  protected readonly cmd = inject(Commands);
  protected readonly sevIcon = SEVERITY_ICON;

  protected readonly totalLabel = computed(() => plural(this.ws.total(), 'resource'));

  protected readonly stats = computed(() => {
    const c = this.ws.counts();
    const m = this.ws.model();
    const links = m.rel.filter((r) => m.by[r[0]].type === 'agent' && m.by[r[1]].type === 'skill').length;
    const errors = this.ws.errorCount();
    const warnings = this.ws.warnCount();
    return [
      { label: 'Resources', value: this.ws.total(), note: 'across 3 scopes', bad: false, screen: 'workspace' },
      { label: 'Agents', value: c['agents'], note: plural(links, 'skill link'), bad: false, screen: 'agents' },
      { label: 'Skills', value: c['skills'], note: '1 user · 1 plugin', bad: false, screen: 'skills' },
      {
        label: 'Problems',
        value: errors + warnings,
        note: plural(errors, 'error') + ' · ' + plural(warnings, 'warning'),
        bad: errors > 0,
        screen: 'validation',
      },
    ];
  });

  protected readonly dist = computed(() => {
    const c = this.ws.counts();
    const named = c['agents'] + c['skills'] + c['commands'] + c['rules'] + c['mcp'];
    const rows: [Kind, string, number, string][] = [
      ['agent', 'Agents', c['agents'], 'agents'],
      ['skill', 'Skills', c['skills'], 'skills'],
      ['cmd', 'Commands', c['commands'], 'commands'],
      ['rule', 'Rules', c['rules'], 'rules'],
      ['mcp', 'MCP servers', c['mcp'], 'mcp'],
      ['mem', 'Memory, settings, hooks, other', this.ws.total() - named, 'claudemd'],
    ];
    return rows.map(([type, label, n, screen]) => ({ type, label, n, screen }));
  });

  protected readonly sources = computed(() => [
    { path: '.claude/', note: 'Agents, skills, commands, rules, settings', scope: 'project' },
    { path: '~/.claude/', note: '1 skill, CLAUDE.md, settings, 1 output style', scope: 'user' },
    { path: 'plugins/', note: 'kendo-toolkit, commit-commands', scope: 'plugin' },
    { path: '.mcp.json', note: plural(this.ws.counts()['mcp'], 'server'), scope: 'project' },
  ]);

  protected readonly topProblems = computed(() => this.ws.problems().slice(0, 4));
}
