import path from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "../io";
import { copyTemplateDir, skillsRoot } from "../scaffold/files";

export const SYNC_SKILLS_HELP = `Usage: platform-cdk sync-skills [--dir <path>] [--force]

Copies the agent skills bundled with this CLI version into <dir> (default
./.agents/skills) so coding agents in your repository follow the platform
conventions. Existing skill files are overwritten because they are owned by
the CLI; add your own skills in separate folders.`;

export const syncSkillsCommand = (argv: string[], io: Io): number => {
  const { values } = parseArgs({
    args: argv,
    options: {
      dir: { type: "string", default: path.join(".agents", "skills") },
      force: { type: "boolean", default: true },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });
  if (values.help) {
    io.out(SYNC_SKILLS_HELP);
    return 0;
  }
  const target = path.resolve(process.cwd(), values.dir);
  const result = copyTemplateDir(skillsRoot(), target, {}, { force: values.force });
  for (const file of result.written) io.out(`synced  ${path.relative(process.cwd(), file)}`);
  io.out(
    `${result.written.length} skill file(s) synced to ${path.relative(process.cwd(), target)}`,
  );
  return 0;
};
