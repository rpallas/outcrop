import { CliError } from "../src/io";
import { oidcSubjectCommand } from "../src/commands/oidc-subject";
import { capture } from "./helpers";

const gh = (prefix: string) => ({
  ghApi: (path: string): string => {
    expect(path).toBe("repos/rpallas/useful/actions/oidc/customization/sub");
    return JSON.stringify({ use_default: true, sub_claim_prefix: prefix });
  },
});

describe("oidc-subject", () => {
  it("prints the ids for an immutable subject", () => {
    const io = capture();
    expect(
      oidcSubjectCommand(["rpallas/useful"], io, gh("repo:rpallas@819329/useful@1411053020")),
    ).toBe(0);
    const out = io.stdout.join("\n");
    expect(out).toContain("repo:rpallas@819329/useful@1411053020:environment:dev");
    expect(out).toContain(
      '{ owner: "rpallas", repo: "useful", ownerId: 819329, repoId: 1411053020 }',
    );
  });

  it("explains that name-based subjects need no ids", () => {
    const io = capture();
    oidcSubjectCommand(["rpallas/useful"], io, gh("repo:rpallas/useful"));
    expect(io.stdout.join("\n")).toContain("no ids are needed");
  });

  it("validates the argument and reports gh failures", () => {
    expect(() => oidcSubjectCommand(["useful"], capture(), gh(""))).toThrow(CliError);
    expect(() =>
      oidcSubjectCommand(["rpallas/useful"], capture(), {
        ghApi: () => {
          throw new Error("gh: command not found");
        },
      }),
    ).toThrow(/GitHub CLI \(gh\): gh: command not found/);
  });
});
