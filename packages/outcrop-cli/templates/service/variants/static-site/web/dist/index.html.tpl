<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{service}}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 4rem auto; max-width: 40rem; padding: 0 1rem; }
      code { background: #f4f4f4; padding: 0.1rem 0.3rem; }
    </style>
  </head>
  <body>
    <h1>{{service}}</h1>
    <p>Static site served by CloudFront. Replace <code>web/dist</code> with your build output.</p>
    {{#if hasHttpApi}}
    <p>API requests to <code>/api/*</code> are routed to the HTTP API in the same stack.</p>
    <pre id="health">loading /api/health...</pre>
    <script>
      fetch("/api/health").then((r) => r.json()).then((body) => {
        document.getElementById("health").textContent = JSON.stringify(body, null, 2);
      }).catch((error) => { document.getElementById("health").textContent = String(error); });
    </script>
    {{/if}}
  </body>
</html>
