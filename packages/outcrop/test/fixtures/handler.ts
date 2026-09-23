export const handler = (): Promise<{ statusCode: number; body: string }> =>
  Promise.resolve({ statusCode: 200, body: JSON.stringify({ ok: true }) });
