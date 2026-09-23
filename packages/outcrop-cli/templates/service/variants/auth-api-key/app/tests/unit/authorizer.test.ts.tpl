import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { mockClient } from "aws-sdk-client-mock";
import type { APIGatewayRequestAuthorizerEventV2, Context } from "aws-lambda";
import { handler } from "../../src/handlers/authorizer";

const secrets = mockClient(SecretsManagerClient);
const context = { awsRequestId: "req-1", functionName: "test" } as Context;

const event = (headers: Record<string, string>): APIGatewayRequestAuthorizerEventV2 =>
  ({ headers, routeKey: "GET /items", rawPath: "/items", requestContext: {} }) as unknown as APIGatewayRequestAuthorizerEventV2;

describe("api key authorizer", () => {
  beforeEach(() => {
    process.env["API_KEY_SECRET_ARN"] = "arn:aws:secretsmanager:eu-west-1:111111111111:secret:api-key-AbCdEf";
    secrets.reset();
    secrets.on(GetSecretValueCommand).resolves({ SecretString: "correct-key" });
  });

  it("accepts the right key and rejects others", async () => {
    await expect(handler(event({ "x-api-key": "correct-key" }), context, () => undefined)).resolves.toMatchObject({ isAuthorized: true });
    await expect(handler(event({ "x-api-key": "wrong" }), context, () => undefined)).resolves.toMatchObject({ isAuthorized: false });
    await expect(handler(event({}), context, () => undefined)).resolves.toMatchObject({ isAuthorized: false });
  });
});
