import test from 'node:test';
import assert from 'node:assert/strict';
import { commands, commandNames } from '../src/commands.js';
import { commandHelp, helpReply, helpText } from '../src/help.js';

test('help covers every registered command/subcommand and option with descriptions and examples', () => {
  const documented = new Map(commandHelp.map(entry => [entry.command, entry]));
  const registered: string[] = [];
  for (const definition of commands.map(command => command.toJSON())) {
    const actions = definition.options?.filter(option => option.type === 1) ?? [];
    const leaves = actions.length ? actions.map(action => ({ command: '/' + definition.name + ' ' + action.name, options: action.options }))
      : [{ command: '/' + definition.name, options: definition.options }];
    for (const leaf of leaves) {
      registered.push(leaf.command);
      const entry = documented.get(leaf.command);
      assert.ok(entry, 'Missing help for ' + leaf.command);
      assert.ok(entry.description.length > 20);
      assert.ok(entry.usage.startsWith(leaf.command));
      assert.ok(entry.example.startsWith(leaf.command));
      for (const option of leaf.options ?? []) assert.ok(entry.usage.includes(option.name + ':'),
        'Missing option ' + option.name + ' for ' + leaf.command);
    }
  }
  assert.deepEqual([...documented.keys()].sort(), registered.sort());
});

test('help schema provides optional guide topics without worker/provider/project selection', () => {
  assert.ok(commandNames.has('help'));
  const definition = commands.find(command => command.name === 'help')!.toJSON();
  assert.equal(definition.options?.length, 1);
  const option = definition.options![0]!;
  assert.ok(option.type === 3);
  assert.equal(option.name, 'topic');
  assert.ok(!option.required);
  assert.deepEqual(option.choices?.map(choice => choice.value), ['all', 'ai', 'admin']);
});

test('focused help guides explain the chosen family and important selection/schedule/admin semantics', () => {
  assert.match(helpText('ai'), /Choose profile OR provider, never both/);
  assert.match(helpText('ai'), /after:10m/);
  assert.match(helpText('ai'), /every:2 hours/);
  assert.match(helpText('ai'), /Bangkok/);
  assert.match(helpText('ai'), /cancel does not stop|Cancel does not stop/);
  assert.doesNotMatch(helpText('ai'), /\/ai-admin profile-set/);
  assert.match(helpText('admin'), /both ADMIN_USER_IDS and the ordinary user allowlist/);
  assert.match(helpText('admin'), /Usage: \/ai init \[project:NAME\] \[profile:NAME\]/);
  assert.match(helpText('admin'), /form asking for default project\/profile aliases/);
  assert.match(helpText('admin'), /tasks remain blocked until init completes/);
  assert.match(helpText('admin'), /Omit model or effort for the CLI default/);
  assert.match(helpText('admin'), /restoring a target does not automatically resume paused jobs/);
  assert.doesNotMatch(helpText('admin'), /Usage: \/ai run/);
});

test('long help stays within Discord content limits and carries a complete private guide with mentions disabled', () => {
  for (const topic of [null, 'all', 'ai', 'admin']) {
    const reply = helpReply(topic);
    assert.ok(reply.content.length <= 2000);
    assert.deepEqual(reply.allowedMentions, { parse: [] });
    assert.equal(reply.files.length, 1);
    assert.equal(reply.files[0]?.name, 'help.txt');
    assert.ok(Buffer.isBuffer(reply.files[0]?.attachment));
    const guide = (reply.files[0]!.attachment as Buffer).toString('utf8');
    assert.equal(guide, helpText((topic ?? 'all') as 'all' | 'ai' | 'admin'));
    assert.doesNotMatch(guide, /[A-Z]:[\\/]|DISCORD_TOKEN=/);
  }
  assert.throws(() => helpReply('unknown'), /AI_HELP_TOPIC/);
  assert.throws(() => helpReply('codex'), /AI_HELP_TOPIC/);
  assert.doesNotMatch(helpText(), /\/codex/);
  assert.doesNotMatch(helpReply().content, /\/codex|topic:codex/);
});
