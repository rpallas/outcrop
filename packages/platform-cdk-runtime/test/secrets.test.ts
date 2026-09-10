import { clearCaches } from "@aws-lambda-powertools/parameters";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { mockClient } from "aws-sdk-client-mock";
import { getConfig, getSecret, getSecretJson } from "../src/secrets";
import { restoreEnv, snapshotEnv } from "./helpers";

const secretsMock = mockClient(SecretsManagerClient);
const ssmMock = mockClient(SSMClient);

const SECRET_ARN = "arn:aws:secretsmanager:eu-west-1:111111111111:secret:database-AbCdEf";

describe("secrets", () => {
  let client: SecretsManagerClient;
  let ssmClient: SSMClient;

  beforeEach(() => {
    snapshotEnv();
    secretsMock.reset();
    ssmMock.reset();
    clearCaches();
    client = new SecretsManagerClient({ region: "eu-west-1" });
    ssmClient = new SSMClient({ region: "eu-west-1" });
  });

  afterEach(() => {
    restoreEnv();
  });

  it("reads a secret by ARN without touching SSM", async () => {
    secretsMock.on(GetSecretValueCommand, { SecretId: SECRET_ARN }).resolves({
      SecretString: "hunter2",
    });
    expect(await getSecret(SECRET_ARN, { client })).toBe("hunter2");
    expect(ssmMock.commandCalls(GetParameterCommand)).toHaveLength(0);
  });

  it("resolves a short name via the SSM contract path", async () => {
    ssmMock
      .on(GetParameterCommand, { Name: "/platform/secrets/database/arn" })
      .resolves({ Parameter: { Value: SECRET_ARN } });
    secretsMock.on(GetSecretValueCommand, { SecretId: SECRET_ARN }).resolves({
      SecretString: "hunter2",
    });

    expect(await getSecret("database", { client, ssmClient })).toBe("hunter2");
    expect(ssmMock.commandCalls(GetParameterCommand)).toHaveLength(1);
  });

  it("decodes binary secrets and reports missing values", async () => {
    secretsMock
      .on(GetSecretValueCommand, { SecretId: "arn:bin" })
      .resolves({ SecretBinary: Buffer.from("binary-value") })
      .on(GetSecretValueCommand, { SecretId: "arn:none" })
      .resolves({});

    expect(await getSecret("arn:bin", { client })).toBe("binary-value");
    await expect(getSecret("arn:none", { client })).rejects.toThrow(
      'Secret "arn:none" was not found',
    );
  });

  it("parses JSON secrets and applies the parse function", async () => {
    secretsMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({ user: "app", password: "pw" }),
    });

    const raw = await getSecretJson("arn:db", { client });
    expect(raw).toEqual({ user: "app", password: "pw" });

    const parse = jest.fn((value: unknown) => {
      const record = value as { user: string };
      return { username: record.user.toUpperCase() };
    });
    expect(await getSecretJson("arn:db", { client, parse })).toEqual({ username: "APP" });
    expect(parse).toHaveBeenCalledWith({ user: "app", password: "pw" });
  });

  it("rejects secrets that are not JSON", async () => {
    secretsMock.on(GetSecretValueCommand).resolves({ SecretString: "not json" });
    await expect(getSecretJson("arn:text", { client })).rejects.toThrow(
      /Secret "arn:text" does not contain valid JSON/,
    );
  });

  it("getConfig reads /platform/config/{key}", async () => {
    ssmMock
      .on(GetParameterCommand, { Name: "/platform/config/feature" })
      .resolves({ Parameter: { Value: "on" } });
    expect(await getConfig("feature", { client: ssmClient })).toBe("on");
  });
});
