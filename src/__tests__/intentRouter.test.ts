import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock all external dependencies ───────────────────────────────────────────

vi.mock('../ai/gateway', () => ({
  generateWithClaude: vi.fn(),
  generateDialogWithClaude: vi.fn(),
  generateVisionWithClaude: vi.fn(),
  REVISION_SYSTEM_PREFIX: '',
}));

vi.mock('../ai/claude', () => ({
  generateNextQuestion: vi.fn(),
  generateStructuredBrief: vi.fn(),
}));

vi.mock('../handlers/navigation', () => ({
  handleStatus: vi.fn().mockResolvedValue(undefined),
  handleExport: vi.fn().mockResolvedValue(undefined),
  handleHelp: vi.fn().mockResolvedValue(undefined),
  handleProjects: vi.fn().mockResolvedValue(undefined),
  handleModule: vi.fn().mockResolvedValue(undefined),
  handleRestart: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../handlers/newProject', () => ({
  handleProjectNameInput: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../briefing/dialog', () => ({
  handleUserMessage: vi.fn().mockResolvedValue(undefined),
  handleSummarize: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../modules/brandDna', () => ({
  handleDnaRevisionInput: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../modules/naming', () => ({
  handleNamingRevisionInput: vi.fn().mockResolvedValue(undefined),
  handleNamingSelectInput: vi.fn().mockResolvedValue(undefined),
  handleVerbalRevisionInput: vi.fn().mockResolvedValue(undefined),
  extractCleanName: vi.fn().mockImplementation((t: string) => t),
}));

vi.mock('../modules/conceptDirection', () => ({
  handleConceptRevisionInput: vi.fn().mockResolvedValue(undefined),
  handleConceptSelectInput: vi.fn().mockResolvedValue(undefined),
  handleConceptSelectedRevisionInput: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../modules/visualIdentity', () => ({
  handleVisualRevisionInput: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db/projects', () => ({
  getUserProjects: vi.fn().mockResolvedValue([]),
  getProjectById: vi.fn().mockResolvedValue(null),
  deleteProject: vi.fn().mockResolvedValue(undefined),
  deleteAllUserProjects: vi.fn().mockResolvedValue(0),
  findProjectByName: vi.fn().mockResolvedValue(null),
}));

vi.mock('../db/users', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));

vi.mock('../db/briefs', () => ({
  getDialog: vi.fn().mockResolvedValue([]),
}));

vi.mock('../utils/nextStep', () => ({
  getProjectState: vi.fn().mockResolvedValue(null),
  continueKeyboard: vi.fn().mockReturnValue({}),
  progressSummary: vi.fn().mockReturnValue(''),
  MODULES: {
    1: { num: 1, name: 'Бриф', startCallback: 'module:1:start' },
    2: { num: 2, name: 'Brand DNA', startCallback: 'module:2:start' },
    3: { num: 3, name: 'Нейминг', startCallback: 'module:3:start' },
    4: { num: 4, name: 'Concept Direction', startCallback: 'module:4:start' },
    5: { num: 5, name: 'Visual Identity', startCallback: 'module:5:start' },
    6: { num: 6, name: 'Brand Book', startCallback: 'module:6:start' },
  },
}));

vi.mock('../prompts/styleGuide', () => ({
  getStyleGuide: vi.fn().mockResolvedValue(''),
}));

vi.mock('../handlers/urlFetch', () => ({
  handleUrlMessage: vi.fn().mockResolvedValue(undefined),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { routeIntent } from '../handlers/intentRouter';
import { generateWithClaude } from '../ai/gateway';
import { handleProjects } from '../handlers/navigation';
import { handleUrlMessage } from '../handlers/urlFetch';

// ── Mock context factory ──────────────────────────────────────────────────────

function createMockCtx(sessionOverrides: Record<string, unknown> = {}) {
  return {
    session: {
      active_project_id: null,
      current_module: null,
      module_state: null,
      briefing_step: null,
      awaiting_input: null,
      figma_file_key: null,
      role: null,
      pending_doc_analysis: null,
      pending_doc_filename: null,
      pending_selection: null,
      pending_figma_text: null,
      ...sessionOverrides,
    },
    from: { id: 12345, first_name: 'Test', last_name: 'User', username: 'testuser' },
    chat: { id: 12345 },
    reply: vi.fn().mockResolvedValue({}),
    answerCallbackQuery: vi.fn().mockResolvedValue({}),
    api: {
      sendChatAction: vi.fn().mockResolvedValue({}),
    },
    message: { text: '' },
    match: null,
  };
}

// Gateway returns a plain string (unlike raw SDK content-blocks).
function mockClaudeJson(json: object): string {
  return JSON.stringify(json);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('routeIntent', () => {
  let ctx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    ctx = createMockCtx();
    vi.clearAllMocks();
  });

  it('empty text → replies without throwing', async () => {
    await expect(routeIntent(ctx as any, '')).resolves.not.toThrow();
    expect(ctx.reply).toHaveBeenCalled();
  });

  it('"Новый проект" keyword → sets awaiting_input = project_name, no Claude call', async () => {
    await routeIntent(ctx as any, 'Новый проект');
    expect(ctx.session.awaiting_input).toBe('project_name');
    expect(ctx.reply).toHaveBeenCalled();
    expect(vi.mocked(generateWithClaude)).not.toHaveBeenCalled();
  });

  it('URL → calls handleUrlMessage', async () => {
    await routeIntent(ctx as any, 'https://example.com');
    expect(vi.mocked(handleUrlMessage)).toHaveBeenCalledWith(ctx, 'https://example.com');
  });

  it('"Покажи проекты" → LIST_PROJECTS intent → calls handleProjects', async () => {
    vi.mocked(generateWithClaude).mockResolvedValueOnce(
      mockClaudeJson({ intent: 'LIST_PROJECTS', entity: '' })
    );
    await routeIntent(ctx as any, 'Покажи проекты');
    expect(vi.mocked(handleProjects)).toHaveBeenCalled();
  });

  it('"Удали проект Стартап" → DELETE_PROJECT intent → replies', async () => {
    vi.mocked(generateWithClaude).mockResolvedValueOnce(
      mockClaudeJson({ intent: 'DELETE_PROJECT', entity: 'Стартап' })
    );
    await routeIntent(ctx as any, 'Удали проект Стартап');
    expect(ctx.reply).toHaveBeenCalled();
  });

  it('"Хочу сделать бренд для кофейни" → NEW_PROJECT intent → sets awaiting_input', async () => {
    vi.mocked(generateWithClaude).mockResolvedValueOnce(
      mockClaudeJson({ intent: 'NEW_PROJECT', entity: '' })
    );
    await routeIntent(ctx as any, 'Хочу сделать бренд для кофейни');
    expect(ctx.session.awaiting_input).toBe('project_name');
  });

  it('"Как это работает?" → QUESTION intent → replies with answer', async () => {
    // First call: classifyIntent (classifier tier, returns JSON)
    vi.mocked(generateWithClaude).mockResolvedValueOnce(
      mockClaudeJson({ intent: 'QUESTION', entity: 'Как это работает?' })
    );
    // Second call: handleQuestionIntent answer generation (default tier, plain text)
    vi.mocked(generateWithClaude).mockResolvedValueOnce(
      'Я помогаю создавать бренды за 30-40 минут.'
    );

    await routeIntent(ctx as any, 'Как это работает?');
    expect(ctx.reply).toHaveBeenCalled();
  });

  it('malformed Claude JSON → falls back gracefully without throwing', async () => {
    vi.mocked(generateWithClaude).mockResolvedValueOnce('not valid json');
    await expect(routeIntent(ctx as any, 'Непонятный текст')).resolves.not.toThrow();
  });
});
