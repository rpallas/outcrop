import { clearCaches } from "@aws-lambda-powertools/parameters";
import { GetParameterCommand, GetParametersByPathCommand, SSMClient } from "@aws-sdk/client-ssm";
import { mockClient } from "aws-sdk-client-mock";
import { getParameter, getParameters, platformParams } from "../src/params";
import { restoreEnv, setEnv, snapshotEnv } from "./helpers";

const ssmMock = mockClient(SSMClient);

describe("params", () => {
  let client: SSMClient;

  beforeEach(() => {
    snapshotEnv();
    ssmMock.reset();
    clearCaches();
    client = new SSMClient({ region: "eu-west-1" });
  });

  afterEach(() => {
    restoreEnv();
  });

  describe("getParameter", () => {
    it("returns the value and caches it", async () => {
      ssmMock
        .on(GetParameterCommand, { Name: "/platform/account/id" })
        .resolves({ Parameter: { Value: "111111111111" } });

      expect(await getParameter("/platform/account/id", { client })).toBe("111111111111");
      expect(await getParameter("/platform/account/id", { client })).toBe("111111111111");
      expect(ssmMock.commandCalls(GetParameterCommand)).toHaveLength(1);
    });

    it("passes decrypt through and works with the default provider", async () => {
      ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: "s3cret" } });
      expect(await getParameter("/platform/config/token", { decrypt: true })).toBe("s3cret");
      const input = ssmMock.commandCalls(GetParameterCommand)[0]!.args[0].input;
      expect(input).toEqual({ Name: "/platform/config/token", WithDecryption: true });
    });

    it("throws a clear error when the value is missing", async () => {
      ssmMock.on(GetParameterCommand).resolves({ Parameter: {} });
      await expect(getParameter("/platform/missing", { client })).rejects.toThrow(
        'SSM parameter "/platform/missing" was not found',
      );
    });
  });

  describe("getParameters", () => {
    it("returns values keyed by relative path", async () => {
      ssmMock.on(GetParametersByPathCommand).resolves({
        Parameters: [
          { Name: "/platform/config/a", Value: "1" },
          { Name: "/platform/config/nested/b", Value: "2" },
        ],
      });
      const values = await getParameters("/platform/config", { client });
      expect(values).toEqual({ a: "1", "nested/b": "2" });
      const input = ssmMock.commandCalls(GetParametersByPathCommand)[0]!.args[0].input;
      expect(input).toMatchObject({ Path: "/platform/config", Recursive: true });
    });
  });

  describe("platformParams", () => {
    it("resolves account and environment values", async () => {
      setEnv({ PLATFORM_ENV: "dev" });
      ssmMock
        .on(GetParameterCommand, { Name: "/platform/account/id" })
        .resolves({ Parameter: { Value: "111111111111" } })
        .on(GetParameterCommand, { Name: "/platform/account/deploy/role-arn/org/repo" })
        .resolves({ Parameter: { Value: "arn:aws:iam::111111111111:role/deploy" } })
        .on(GetParameterCommand, { Name: "/platform/env/dev/events/bus-name" })
        .resolves({ Parameter: { Value: "platform-dev" } })
        .on(GetParameterCommand, { Name: "/platform/env/prod/alerts/topic-arn/critical" })
        .resolves({ Parameter: { Value: "arn:aws:sns:eu-west-1:111111111111:critical" } });

      const params = platformParams({ client });
      expect(params.paths.root).toBe("/platform");
      expect(await params.account.id()).toBe("111111111111");
      expect(await params.account.deployRoleArn("org/repo")).toBe(
        "arn:aws:iam::111111111111:role/deploy",
      );
      expect(await params.env().eventBusName()).toBe("platform-dev");
      expect(await params.env("prod").alertTopicArn("critical")).toBe(
        "arn:aws:sns:eu-west-1:111111111111:critical",
      );
    });

    it("resolves config, secret arn and service values under a custom root", async () => {
      ssmMock.on(GetParameterCommand).callsFake((input: { Name: string }) => ({
        Parameter: { Value: `value:${input.Name}` },
      }));

      const params = platformParams({ client, rootPrefix: "/acme" });
      expect(await params.config("flag")).toBe("value:/acme/config/flag");
      expect(await params.secretArn("db")).toBe("value:/acme/secrets/db/arn");
      expect(await params.service("billing", "api-url")).toBe(
        "value:/acme/services/billing/api-url",
      );
      expect(await params.get("/acme/anything")).toBe("value:/acme/anything");
    });

    it("uses PLATFORM_SSM_ROOT and requires PLATFORM_ENV for env()", () => {
      setEnv({ PLATFORM_SSM_ROOT: "/custom", PLATFORM_ENV: undefined });
      const params = platformParams({ client });
      expect(params.paths.root).toBe("/custom");
      expect(() => params.env()).toThrow(/PLATFORM_ENV/);
      expect(platformParams({ client, env: "staging" }).env().name).toBeDefined();
    });
  });
});
