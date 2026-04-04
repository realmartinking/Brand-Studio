import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock all brandDna dependencies ────────────────────────────────────────────

vi.mock('../ai/gateway', () => ({
  generateWithClaude: vi.fn().mockResolvedValue('Generated text from AI'),
  REVISION_SYSTEM_PREFIX: '',
}));

vi.mock('../db/briefs', () => ({
  getActiveBrief: vi.fn(),
  getUploadedDocumentsContext: vi.fn().mockResolvedValue(''),
}));

vi.mock('../db/artifacts', () => ({
  getLatestArtifact: vi.fn().mockResolvedValue(null),
  getApprovedArtifact: vi.fn().mockResolvedValue(null),
  getAllArtifactsOfType: vi.fn().mockResolvedValue([]),
  saveArtifact: vi.fn().mockResolvedValue({ id: 'artifact-1', version: 1 }),
  approveArtifact: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db/moduleRuns', () => ({
  getLatestModuleRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
}));

vi.mock('../db/projects', () => ({
  updateCurrentModule: vi.fn().mockResolvedValue(undefined),
  updateProjectStatus: vi.fn().mockResolvedValue(undefined),
  getStyleGuide: vi.fn().mockResolvedValue(null),
}));

vi.mock('../utils/telegram', () => ({
  sendLongMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../prompts/styleGuide', () => ({
  getStyleGuide: vi.fn().mockResolvedValue(''),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { runBrandDna, handleDnaApprove } from '../modules/brandDna';
import { generateWithClaude } from '../ai/gateway';
import { getActiveBrief } from '../db/briefs';
import { approveArtifact } from '../db/artifacts';
import { updateCurrentModule } from '../db/projects';

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
  };
}

// ── brandDna module tests ─────────────────────────────────────────────────────

describe('runBrandDna', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('with empty brief (null) → shows error to user, does not call generateWithClaude', async () => {
    vi.mocked(getActiveBrief).mockResolvedValue(undefined);

    const ctx = createMockCtx({ active_project_id: 'project-1' });
    await runBrandDna(ctx as any);

    expect(ctx.reply).toHaveBeenCalled();
    expect(vi.mocked(generateWithClaude)).not.toHaveBeenCalled();
  });

  it('with brief that has no content → shows error, does not call generateWithClaude', async () => {
    vi.mocked(getActiveBrief).mockResolvedValue({
      id: 'brief-1',
      projectId: 'project-1',
      status: 'in_progress',
      summary: null,
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const ctx = createMockCtx({ active_project_id: 'project-1' });
    await runBrandDna(ctx as any);

    expect(ctx.reply).toHaveBeenCalled();
    expect(vi.mocked(generateWithClaude)).not.toHaveBeenCalled();
  });

  it('with valid brief content → calls generateWithClaude and sends result', async () => {
    vi.mocked(getActiveBrief).mockResolvedValue({
      id: 'brief-1',
      projectId: 'project-1',
      status: 'complete',
      summary: 'This is a brand brief with enough content to generate from.',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const ctx = createMockCtx({ active_project_id: 'project-1' });
    await runBrandDna(ctx as any);

    expect(vi.mocked(generateWithClaude)).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalled();
  });
});

describe('handleDnaApprove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates current_module to 3 in DB and session', async () => {
    const ctx = createMockCtx({ active_project_id: 'project-1' });
    await handleDnaApprove(ctx as any, 'artifact-123');

    expect(vi.mocked(approveArtifact)).toHaveBeenCalledWith('artifact-123');
    expect(vi.mocked(updateCurrentModule)).toHaveBeenCalledWith('project-1', 3);
    expect(ctx.session.current_module).toBe(3);
    expect(ctx.reply).toHaveBeenCalled();
  });

  it('does nothing if no active project', async () => {
    const ctx = createMockCtx({ active_project_id: null });
    await handleDnaApprove(ctx as any, 'artifact-123');

    expect(vi.mocked(updateCurrentModule)).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

// ── gateway empty message guard ───────────────────────────────────────────────

describe('generateWithClaude empty message guard', () => {
  it('throws before calling API when userMessage is empty', async () => {
    // Use the real gateway implementation — vi.importActual bypasses the mock
    // withStyleGuide short-circuits on undefined projectId, so no DB calls happen
    const actual = await vi.importActual<typeof import('../ai/gateway')>('../ai/gateway');
    await expect(actual.generateWithClaude('system prompt', '', {}))
      .rejects
      .toThrow('Cannot call AI with empty user message');
  });
});
