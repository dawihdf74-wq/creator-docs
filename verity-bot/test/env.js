// Imported first by the dry run: ESM evaluates imports before any other
// module-level code, so these have to be set from a module of their own.
process.env.DISCORD_TOKEN ||= 'dry-run';
process.env.DISCORD_CLIENT_ID ||= 'dry-run';
process.env.VERITY_DATA_DIR ||= 'data/test';
