import { TourCtx, TourDef } from './tour.types';

/* ---------- helpers shared by the steps ---------- */

/** Shows the graph canvas of the visual workspace. */
function toCanvas({ ui, cmd }: TourCtx): void {
  ui.view.set('graph');
  if (cmd.screen() !== 'workspace') cmd.go('workspace');
}

/** Expands a sidebar section so its navigation items exist. */
function openSection({ ui }: TourCtx, key: 'ws' | 'res' | 'tools'): void {
  ui.secOpen.update((open) => ({ ...open, [key]: true }));
}

/** Back to the inspector's configuration tab for whatever is selected. */
function toConfiguration(ctx: TourCtx): void {
  toCanvas(ctx);
  ctx.ui.inspOpen.set(true);
  ctx.ui.tab.set('cf');
}

const firstAgent = ({ ws }: TourCtx) => ws.model().list.find((n) => n.type === 'agent' && !n.missing);

/* ---------- product tour: read-only, one pass over the whole app ---------- */

const PRODUCT: TourDef = {
  id: 'product',
  title: 'Product tour',
  kind: 'tour',
  steps: [
    {
      title: 'Welcome to AgentDock',
      body: 'AgentDock shows the Claude Code configuration of a project as a graph you can inspect and edit. This tour takes about two minutes and changes nothing.',
      nextLabel: 'Start',
    },
    {
      title: 'Your workspace',
      body: 'This is the project being edited. Open the menu to switch to a recent folder or choose another one with Open folder. Until you do, a sample project is shown.',
      target: 'ws-switcher',
      placement: 'bottom',
    },
    {
      title: 'Everything that was found',
      body: 'The sidebar lists every kind of resource in the project, from agents and skills to hooks and MCP servers, with a count for each. Click one for a plain list.',
      target: 'sidebar',
      placement: 'right',
    },
    {
      title: 'The visual workspace',
      body: 'Each node is a file. Lines are relationships: an agent that preloads a skill, a command that delegates to an agent. Drag to pan, scroll to zoom, and drag a skill onto an agent to attach it.',
      target: 'canvas',
      prepare: toCanvas,
    },
    {
      title: 'Find and filter',
      body: 'Type in Find on canvas to highlight matching nodes. These chips hide or show a whole kind when the graph gets crowded.',
      target: 'filters',
      placement: 'bottom',
      prepare: toCanvas,
    },
    {
      title: 'Create resources',
      body: 'New adds an agent or a skill. It appears on the canvas and opens in the inspector, ready to be named.',
      target: 'new',
      placement: 'bottom',
      prepare: toCanvas,
    },
    {
      title: 'The inspector',
      body: 'Select a node to see it here. Overview shows details and problems, Configuration edits the frontmatter and instructions, and Source shows the file that will be written.',
      target: 'inspector',
      placement: 'left',
      prepare: (ctx) => {
        const agent = firstAgent(ctx);
        if (agent) ctx.cmd.focusNode(agent.id);
        else toCanvas(ctx);
        ctx.ui.inspOpen.set(true);
      },
    },
    {
      title: 'Validation',
      body: 'AgentDock checks the configuration as you edit: missing skills, unknown tools, unset environment variables. The number here is how many problems are open.',
      target: 'nav-validation',
      placement: 'right',
      prepare: (ctx) => openSection(ctx, 'tools'),
    },
    {
      title: 'Nothing is saved until you say so',
      body: 'Every edit is collected in Changes as a line diff per file. Review it there, then discard it or save everything to disk in one go.',
      target: 'nav-changes',
      placement: 'right',
      prepare: (ctx) => openSection(ctx, 'tools'),
    },
    {
      title: 'Search and commands',
      body: 'Press Ctrl K (⌘ K on a Mac) anywhere to jump to a resource by name or run a command such as Auto-layout or Rescan workspace.',
      target: 'search',
      placement: 'bottom',
    },
    {
      title: 'Help is here',
      body: 'Start this tour again from the Help menu, or pick a walkthrough there to practise one task step by step.',
      target: 'help',
      placement: 'bottom',
    },
  ],
};

/* ---------- walkthroughs: the user does the work, steps advance on their actions ---------- */

const CREATE_AGENT: TourDef = {
  id: 'create-agent',
  title: 'Create your first agent',
  kind: 'walkthrough',
  steps: [
    {
      title: 'Add an agent',
      body: 'Click New and choose Agent.',
      target: 'new',
      placement: 'right',
      prepare: toCanvas,
      snapshot: ({ ws }) => ws.counts()['agents'],
      done: ({ ws }, before) => ws.counts()['agents'] > (before as number),
    },
    {
      title: 'Give it a name',
      body: 'The new agent is selected and open in the inspector. Type a name for it, such as code-reviewer. The name becomes the file name.',
      target: 'insp-name',
      placement: 'left',
      prepare: toConfiguration,
      snapshot: ({ ws }) => {
        const n = ws.selectedOne();
        return n ? { id: n.id, name: n.name } : null;
      },
      done: ({ ws }, before) => {
        const b = before as { id: string; name: string } | null;
        const n = b ? ws.model().by[b.id] : undefined;
        return !!b && !!n && n.name !== b.name && n.name.trim().length > 0;
      },
      settle: 1200,
    },
    {
      title: 'Configure it',
      body: 'Describe when Claude should use the agent, then pick its model, permission mode and tools, and write its instructions. Take your time, then continue.',
      target: 'inspector',
      placement: 'left',
      prepare: toConfiguration,
    },
    {
      title: 'See what will be written',
      body: 'Your edits are pending, not saved. Open Changes to review them.',
      target: 'nav-changes',
      placement: 'right',
      prepare: (ctx) => openSection(ctx, 'tools'),
      done: ({ cmd }) => cmd.screen() === 'changes',
    },
    {
      title: 'Save when you are ready',
      body: 'The new agent is listed as an added file with its full contents. Save all writes it to disk; Discard file removes it again. This walkthrough leaves that choice to you.',
      target: 'changes-save',
      placement: 'bottom',
    },
  ],
};

const ATTACH_SKILL: TourDef = {
  id: 'attach-skill',
  title: 'Attach a skill to an agent',
  kind: 'walkthrough',
  available: ({ ws }) => (ws.counts()['agents'] && ws.counts()['skills'] ? null : 'This walkthrough needs at least one agent and one skill'),
  steps: [
    {
      title: 'Pick an agent',
      body: 'Click any agent node on the canvas to select it.',
      target: 'node-agent',
      placement: 'right',
      prepare: (ctx) => {
        toCanvas(ctx);
        ctx.ui.sel.set([]);
      },
      done: ({ ws }) => ws.selectedOne()?.type === 'agent',
    },
    {
      title: 'Open its skills',
      body: 'The Skills tab lists what this agent preloads. Open it.',
      target: 'insp-tab-sk',
      placement: 'left',
      prepare: ({ ui }) => ui.inspOpen.set(true),
      done: ({ ui, ws }) => ui.tab() === 'sk' && ws.selectedOne()?.type === 'agent',
    },
    {
      title: 'Add a skill',
      body: 'Click Add skill and choose one from the list. Dragging a skill node onto the agent on the canvas does the same.',
      target: 'insp-add-skill',
      beside: 'inspector',
      placement: 'left',
      snapshot: ({ ws }) => {
        const n = ws.selectedOne();
        return n ? { id: n.id, count: ws.skillsOf(n.id).length } : null;
      },
      done: ({ ws }, before) => {
        const b = before as { id: string; count: number } | null;
        return !!b && !!ws.model().by[b.id] && ws.skillsOf(b.id).length > b.count;
      },
    },
    {
      title: 'Attached',
      body: 'A new line on the canvas connects the two, and the agent file now shows up in Changes. Undo in the toast reverts it; nothing is on disk until you save.',
      target: 'nav-changes',
      placement: 'right',
      prepare: (ctx) => openSection(ctx, 'tools'),
    },
  ],
};

const FIX_PROBLEM: TourDef = {
  id: 'fix-problem',
  title: 'Fix a validation problem',
  kind: 'walkthrough',
  available: ({ ws }) => (ws.problems().length ? null : 'There are no validation problems to fix right now'),
  steps: [
    {
      title: 'Open Validation',
      body: 'The count next to Validation is the number of open problems. Click it to see them.',
      target: 'nav-validation',
      placement: 'right',
      prepare: (ctx) => openSection(ctx, 'tools'),
      done: ({ cmd }) => cmd.screen() === 'validation',
    },
    {
      title: 'Go to the cause',
      body: 'Problems are grouped by severity, errors first. Use the button on a row to jump to the resource it is about.',
      target: 'problem-row',
      placement: 'bottom',
      done: ({ cmd }) => cmd.screen() !== 'validation',
    },
    {
      title: 'Read what is wrong',
      body: 'The resource is selected and its problems are listed at the top of the inspector. On the canvas, a dashed red line marks a reference to something that does not exist.',
      target: 'insp-problems',
      placement: 'left',
    },
    {
      title: 'Fix it and watch the count',
      body: 'Correct the field in Configuration, or remove the broken reference in the Skills tab. Validation runs as you edit, so this number drops the moment the problem is gone.',
      target: 'nav-validation',
      placement: 'right',
      prepare: (ctx) => openSection(ctx, 'tools'),
    },
  ],
};

const SAVE_CHANGES: TourDef = {
  id: 'save-changes',
  title: 'Review and save changes',
  kind: 'walkthrough',
  available: ({ ws }) => (ws.changes().length ? null : 'There are no pending changes to review. Edit something first'),
  steps: [
    {
      title: 'Open Changes',
      body: 'The number here is how many files have pending edits. Click Changes.',
      target: 'nav-changes',
      placement: 'right',
      prepare: (ctx) => openSection(ctx, 'tools'),
      done: ({ cmd }) => cmd.screen() === 'changes',
    },
    {
      title: 'One row per file',
      body: 'M is modified, A is added and D is deleted, with the lines added and removed. Select a file to see its diff on the right; Discard file reverts just that one.',
      target: 'changes-list',
      placement: 'right',
    },
    {
      title: 'Save or discard',
      body: 'Save all writes every pending file at once and refuses to overwrite a file that changed on disk in the meantime. Discard all throws the edits away. This walkthrough leaves the choice to you.',
      target: 'changes-save',
      placement: 'bottom',
    },
  ],
};

/* ---------- first-run invitation ---------- */

const WELCOME: TourDef = {
  id: 'welcome',
  title: 'Welcome',
  kind: 'offer',
  then: 'product',
  steps: [
    {
      title: 'New here?',
      body: 'Take a two-minute tour of AgentDock. You can start it later from this Help menu.',
      target: 'help',
      placement: 'bottom',
      nextLabel: 'Start tour',
    },
  ],
};

export const TOURS: TourDef[] = [PRODUCT, CREATE_AGENT, ATTACH_SKILL, FIX_PROBLEM, SAVE_CHANGES, WELCOME];
