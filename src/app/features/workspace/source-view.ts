import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal, untracked } from '@angular/core';
import { IconName, iconFor } from '../../core/model/icons';
import { highlight, sourceOf } from '../../core/model/source';
import { KindOrNone } from '../../core/model/types';
import { PrefsStore } from '../../core/state/prefs.store';
import { UiStore } from '../../core/state/ui.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { Tip } from '../../headless/tip';
import { Icon } from '../../ui/icon';
import { SourceCode } from '../../ui/source-code';

/** What the right-hand pane shows: the file of a graph resource, or a file without one. */
interface Shown {
  /** Stable key: the resource id, or "doc:" plus the path. */
  key: string;
  /** Resource id; null for a file without a graph node. */
  id: string | null;
  file: string;
  text: string;
  /** Why the file cannot be edited as text, or null when it can. */
  blocked: string | null;
  json: boolean;
}

const DOC_ICON: Record<string, IconName> = { settings: 'sliders', style: 'type', memory: 'db', claudemd: 'file' };

/** Configuration files on the left; the source of the selected one on the right, to read or to edit. */
@Component({
  selector: 'ad-source-view',
  imports: [Icon, SourceCode, Tip],
  template: `
    <div class="scr w-[250px] flex-none overflow-y-auto border-r border-line bg-bg1 px-1.5 py-2">
      <div class="lb px-2 pt-0.5 pb-1.5">Configuration files</div>
      @for (f of files(); track f.key) {
        <button class="nv" [class]="'k-' + f.type" [class.on]="f.on" [attr.aria-current]="f.on ? 'true' : null" (click)="pick(f.id, null)">
          <svg [adIcon]="f.icon" class="text-k"></svg>
          <span class="el min-w-0 flex-1 text-left font-mono text-[11.5px]">{{ f.label }}</span>
        </button>
      }
      @if (docs().length) {
        <div class="lb px-2 pt-3 pb-1.5">Settings, styles and memory</div>
        @for (d of docs(); track d.file) {
          <button class="nv" [class.on]="d.on" [attr.aria-current]="d.on ? 'true' : null" (click)="pick(null, d.file)">
            <svg [adIcon]="d.icon" class="text-tx3"></svg>
            <span class="el min-w-0 flex-1 text-left font-mono text-[11.5px]">{{ d.label }}</span>
            @if (d.changed) {
              <span class="kd M">M</span>
            }
          </button>
        }
      }
    </div>
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <div class="flex h-8 flex-none items-center gap-2 border-b border-line px-3">
        <span class="el min-w-0 flex-1 font-mono text-[11.5px] text-tx2">{{ current()?.file ?? 'Select a file' }}</span>
        @if (current(); as c) {
          @if (error(); as e) {
            <span class="el c-err max-w-[46%] text-[11px]" role="alert">{{ e }}</span>
          }
          @if (c.blocked) {
            <span class="chip" [adTip]="c.blocked" [tipEnd]="true">read-only</span>
          } @else {
            <button class="bt gh" [class.on]="editing()" [attr.aria-pressed]="editing()" (click)="editing.set(!editing())">
              <svg adIcon="code"></svg>{{ editing() ? 'Done' : 'Edit source' }}
            </button>
          }
          @if (c.id) {
            <button class="bt gh" (click)="editFields()"><svg adIcon="pencil"></svg>Edit fields</button>
          }
        }
      </div>
      @if (editing() && current() && !current()!.blocked) {
        <textarea
          class="scr min-h-0 flex-1 resize-none border-0 bg-transparent px-3 py-2.5 font-mono leading-[1.55] text-tx outline-none"
          spellcheck="false"
          [attr.aria-label]="'Source of ' + current()!.file"
          [style.font-size.px]="prefs.codeSize()"
          [style.white-space]="prefs.prefs().wrap ? 'pre-wrap' : 'pre'"
          [value]="draft()"
          (input)="type($any($event.target).value)"
        ></textarea>
      } @else {
        <div class="scr flex-1 overflow-auto py-2.5 pr-3">
          <ad-source-code [lines]="lines()" />
        </div>
      }
    </div>
  `,
  host: { class: 'flex min-h-0 flex-1' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceView {
  protected readonly ui = inject(UiStore);
  protected readonly prefs = inject(PrefsStore);
  private readonly ws = inject(WorkspaceStore);

  /** The right-hand pane is a text editor instead of a highlighted preview. */
  protected readonly editing = signal(false);
  /** Why the text in the editor has not been applied, if it has not. */
  protected readonly error = signal<string | null>(null);

  /** The picked file without a node, else the selected resource, else the first one so the view is never empty. */
  protected readonly current = computed<Shown | null>(() => {
    const doc = this.ws.docs().find((d) => d.file === this.ui.doc());
    if (doc) {
      const blocked = doc.writable ? null : `Files in ${doc.scope} scope are read-only.`;
      return { key: 'doc:' + doc.file, id: null, file: doc.file, text: doc.text, blocked, json: doc.kind === 'settings' };
    }
    const m = this.ws.model();
    const n = this.ws.selectedOne() ?? m.by['angular-developer'] ?? m.list[0];
    if (!n || n.missing) return null;
    return { key: n.id, id: n.id, file: n.file, text: sourceOf(n, m.rel, m.by).join('\n'), blocked: this.ws.rawBlocker(n), json: n.type === 'mcp' };
  });

  /**
   * Text in the editor. It starts from the file whenever another file is opened or editing is
   * switched on, and is otherwise only changed by typing, so the caret never jumps.
   */
  protected readonly draft = linkedSignal({
    source: () => (this.current()?.key ?? '') + '|' + this.editing(),
    computation: () => untracked(() => this.current()?.text ?? ''),
  });

  protected readonly files = computed(() => {
    const cur = this.current();
    return this.ws
      .visible()
      .filter((n) => !n.missing)
      .map((n) => ({
        key: n.id,
        id: n.id,
        type: n.type as KindOrNone,
        icon: iconFor(n.type),
        label: n.type === 'mcp' ? '.mcp.json › ' + n.name : n.file.replace('.claude/', ''),
        on: cur?.id === n.id,
      }));
  });

  protected readonly docs = computed(() => {
    const cur = this.current();
    const pending = this.ws.state().docs;
    return this.ws.docs().map((d) => ({
      file: d.file,
      icon: DOC_ICON[d.kind] ?? 'file',
      label: d.file.replace(/^\.claude\//, ''),
      on: cur?.key === 'doc:' + d.file,
      changed: d.file in pending,
    }));
  });

  protected readonly lines = computed(() => highlight((this.current()?.text ?? '').split('\n')));

  protected pick(id: string | null, doc: string | null): void {
    this.error.set(null);
    if (id) this.ui.sel.set([id]);
    this.ui.doc.set(doc);
  }

  /** Applies what was typed as a pending edit, unless it would leave a JSON file unreadable. */
  protected type(text: string): void {
    const c = this.current();
    if (!c) return;
    this.draft.set(text);
    if (c.id) return this.error.set(this.ws.editRaw(c.id, text));
    if (c.json) {
      try {
        JSON.parse(text);
      } catch (e) {
        return this.error.set('Not valid JSON, so not applied yet: ' + (e as Error).message);
      }
    }
    this.error.set(null);
    this.ws.editDoc(c.file, text);
  }

  protected editFields(): void {
    const id = this.current()?.id;
    if (!id) return;
    this.ui.view.set('graph');
    this.ui.sel.set([id]);
    this.ui.tab.set('cf');
    this.ui.inspOpen.set(true);
  }
}
