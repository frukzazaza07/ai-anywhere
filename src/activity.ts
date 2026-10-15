/**
 * Map provider events to fixed, human-readable activity labels.
 * Labels never include commands, file names or model text, which can contain private content.
 */

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function commandActivity(command: string): string {
  if (/\b(test|tests|pytest|jest|vitest|mocha|phpunit|rspec|ctest)\b/i.test(command)) return 'Running tests';
  if (/\b(npm (ci|install)|pnpm (i|install)|yarn install|pip install|bundle install|cargo fetch)\b/i.test(command)) return 'Installing dependencies';
  if (/\b(build|tsc|compile|make|gradle|mvn|webpack|lint|eslint)\b/i.test(command)) return 'Building or checking the project';
  if (/\bgit\b/i.test(command)) return 'Checking Git';
  if (/\b(rg|grep|cat|sed|head|tail|ls|find|fd|tree|wc|less|more|type|dir|Get-Content|Select-String|Get-ChildItem)\b/i.test(command)) return 'Reading files';
  return 'Running a command';
}

/** Codex `exec --json` events. */
export function codexActivity(event: unknown): string | undefined {
  const value = record(event);
  if (!value) return undefined;
  if (value.type === 'turn.started') return 'Started working';
  if (value.type !== 'item.started' && value.type !== 'item.updated') return undefined;
  const item = record(value.item);
  switch (item?.type) {
    case 'command_execution': return commandActivity(typeof item.command === 'string' ? item.command : '');
    case 'file_change': return 'Editing files';
    case 'reasoning': return 'Thinking';
    case 'agent_message': return 'Writing a response';
    case 'mcp_tool_call': return 'Using a tool';
    case 'web_search': return 'Searching the web';
    case 'todo_list': return 'Updating its plan';
    default: return undefined;
  }
}

/** Gemini CLI `--output-format stream-json` events. */
export function geminiActivity(event: unknown): string | undefined {
  const value = record(event);
  if (!value) return undefined;
  if (value.type === 'init') return 'Started working';
  if (value.type === 'message' && value.role === 'assistant') return 'Writing a response';
  if (value.type !== 'tool_use') return undefined;
  switch (value.tool_name) {
    case 'read_file': case 'read_many_files': return 'Reading files';
    case 'list_directory': case 'glob': return 'Listing files';
    case 'grep_search': case 'search_file_content': return 'Searching files';
    case 'replace': case 'write_file': return 'Editing files';
    default: return 'Using a tool';
  }
}
