/**
 * Integration tests run against a deployed stack. The preview workflow exports
 * stack outputs as environment variables prefixed with PREVIEW_ (for example
 * PREVIEW_ApiBaseUrl). Locally: `PREVIEW_ApiBaseUrl=https://... npm run test:integration`.
 */
const baseUrl = process.env["PREVIEW_ApiBaseUrl"] ?? process.env["API_BASE_URL"];

const describeIfDeployed = baseUrl ? describe : describe.skip;

describeIfDeployed("{{service}} api", () => {
  const url = (path: string) => `${baseUrl ?? ""}${path}`;

  it("GET /health responds", async () => {
    const response = await fetch(url("/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it("creates, reads and deletes an item", async () => {
    const created = await fetch(url("/items"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "integration" }),
    });
    expect(created.status).toBe(201);
    const item = (await created.json()) as { id: string };

    const read = await fetch(url(`/items/${item.id}`));
    expect(read.status).toBe(200);

    const deleted = await fetch(url(`/items/${item.id}`), { method: "DELETE" });
    expect(deleted.status).toBe(204);
  });
});
