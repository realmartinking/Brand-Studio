export interface SessionData {
  active_project_id: string | null;
  current_module: number | null;
  module_state: string | null;
  briefing_step: number | null;
  awaiting_input: string | null;
  figma_file_key: string | null;
  role: string | null;
  pending_doc_analysis: string | null;
  pending_doc_filename: string | null;
  pending_selection: string | null;
  pending_figma_text: string | null;
}

export function initialSession(): SessionData {
  return {
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
  };
}
