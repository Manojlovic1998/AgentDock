import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconName } from '../../core/model/icons';
import { Accent, BoolPref, PrefsStore, TextPref, Theme } from '../../core/state/prefs.store';
import { Icon } from '../../ui/icon';
import { SegOption, Segmented } from '../../ui/segmented';
import { Switch } from '../../ui/switch';

type Row =
  | { kind: 'toggle'; key: BoolPref; label: string; hint: string }
  | { kind: 'text'; key: TextPref; label: string; hint: string }
  | { kind: 'choice'; key: 'theme' | 'density' | 'edge'; label: string; hint: string; options: SegOption[] }
  | { kind: 'accent'; label: string; hint: string };

const toggle = (key: BoolPref, label: string, hint: string): Row => ({ kind: 'toggle', key, label, hint });
const text = (key: TextPref, label: string, hint: string): Row => ({ kind: 'text', key, label, hint });

const SECTIONS: { label: string; icon: IconName; rows: Row[] }[] = [
  {
    label: 'Appearance',
    icon: 'sun',
    rows: [
      {
        kind: 'choice',
        key: 'theme',
        label: 'Theme',
        hint: 'Dark is the default. Light mirrors every token.',
        options: [
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ],
      },
      { kind: 'accent', label: 'Accent color', hint: 'Used for selection, focus and primary actions.' },
      {
        kind: 'choice',
        key: 'density',
        label: 'Interface density',
        hint: 'Row height in lists and navigation.',
        options: [
          { value: 'compact', label: 'Compact' },
          { value: 'roomy', label: 'Comfortable' },
        ],
      },
    ],
  },
  {
    label: 'Editor',
    icon: 'code',
    rows: [
      text('fontSize', 'Source font size', 'Pixels, applied to source and diff views.'),
      toggle('wrap', 'Word wrap', 'Wrap long lines in source previews.'),
      toggle('lineNo', 'Line numbers', 'Show line numbers in source previews.'),
      toggle('fmt', 'Normalize frontmatter on save', 'Sort keys and fix indentation when writing files.'),
    ],
  },
  {
    label: 'Graph',
    icon: 'network',
    rows: [
      toggle('grid', 'Show grid', 'Dot grid behind the canvas.'),
      toggle('mini', 'Show mini-map', 'Overview in the lower right corner.'),
      {
        kind: 'choice',
        key: 'edge',
        label: 'Edge style',
        hint: 'How relationships are drawn.',
        options: [
          { value: 'curved', label: 'Curved' },
          { value: 'orth', label: 'Orthogonal' },
        ],
      },
      toggle('dim', 'Dim unrelated nodes on selection', 'Keeps focus on the selected resource and its neighbors.'),
      toggle('snap', 'Snap to grid', 'Align dragged nodes to an 8 px grid.'),
    ],
  },
  {
    label: 'Workspace',
    icon: 'folder',
    rows: [
      text('root', 'Project root', 'Folder scanned for .claude/ and .mcp.json.'),
      toggle('autosave', 'Write changes immediately', 'Off keeps edits pending until you save in Changes.'),
      toggle('confirm', 'Confirm before deleting', 'Ask before removing a resource and its references.'),
    ],
  },
  {
    label: 'Configuration discovery',
    icon: 'search',
    rows: [
      toggle('scanUser', 'Include user scope', 'Read agents, skills and settings from ~/.claude/.'),
      toggle('scanPlugins', 'Include installed plugins', 'Show resources contributed by plugins.'),
      toggle('managed', 'Include managed settings', 'Read organization-managed settings when present.'),
      toggle('watch', 'Watch files for external changes', 'Reload when configuration changes on disk.'),
      text('ignore', 'Ignored folders', 'Comma-separated, skipped during discovery.'),
    ],
  },
];

const ACCENTS: Accent[] = ['ember', 'iris', 'mint', 'sky'];

/** Application preferences. */
@Component({
  selector: 'ad-settings',
  imports: [Icon, Segmented, Switch],
  template: `
    <div class="mx-auto flex max-w-[720px] flex-col gap-4">
      <h1 class="m-0 text-[17px] font-semibold tracking-[-0.01em]">Settings</h1>
      @for (s of sections; track s.label) {
        <section class="pnl">
          <div class="ph"><svg [adIcon]="s.icon" class="text-tx3"></svg><span class="font-semibold">{{ s.label }}</span></div>
          @for (r of s.rows; track r.label) {
            <div class="flex flex-wrap items-center gap-4 border-b border-line px-3 py-[9px]">
              <div class="min-w-[200px] flex-1">
                <div class="font-medium">{{ r.label }}</div>
                <div class="mt-px text-[11.5px] text-tx3">{{ r.hint }}</div>
              </div>
              @switch (r.kind) {
                @case ('toggle') {
                  <button adSwitch [checked]="prefs.prefs()[r.key]" [attr.aria-label]="r.label" (click)="prefs.set(r.key, !prefs.prefs()[r.key])"></button>
                }
                @case ('choice') {
                  <ad-segmented [attr.aria-label]="r.label" [options]="r.options" [value]="choice(r.key)" (valueChange)="choose(r.key, $event)" />
                }
                @case ('accent') {
                  <div class="flex items-center gap-2" role="radiogroup" [attr.aria-label]="r.label">
                    @for (a of accents; track a) {
                      <button
                        class="swc"
                        [class]="'a-' + a"
                        [class.on]="prefs.accent() === a"
                        role="radio"
                        [attr.aria-checked]="prefs.accent() === a"
                        [attr.aria-label]="a"
                        (click)="prefs.accent.set(a)"
                      ></button>
                    }
                  </div>
                }
                @case ('text') {
                  <input
                    class="inp !w-60 font-mono !text-[11.5px]"
                    [attr.aria-label]="r.label"
                    [value]="prefs.prefs()[r.key]"
                    (input)="prefs.set(r.key, $any($event.target).value)"
                  />
                }
              }
            </div>
          }
        </section>
      }
    </div>
  `,
  host: { class: 'scr block min-h-0 flex-1 overflow-y-auto px-6 py-5' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings {
  protected readonly prefs = inject(PrefsStore);
  protected readonly sections = SECTIONS;
  protected readonly accents = ACCENTS;

  protected choice(key: 'theme' | 'density' | 'edge'): string {
    return key === 'theme' ? this.prefs.theme() : this.prefs.prefs()[key];
  }

  protected choose(key: 'theme' | 'density' | 'edge', value: string): void {
    if (key === 'theme') this.prefs.theme.set(value as Theme);
    else if (key === 'density') this.prefs.set('density', value as 'compact' | 'roomy');
    else this.prefs.set('edge', value as 'curved' | 'orth');
  }
}
