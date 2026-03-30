export interface SessionData {
  active_project_id: string | null;
  current_module: number | null;
  module_state: string | null;
  briefing_step: number | null;
  awaiting_input: string | null;
}

export function initialSession(): SessionData {
  return {
    active_project_id: null,
    current_module: null,
    module_state: null,
    briefing_step: null,
    awaiting_input: null,
  };
}
