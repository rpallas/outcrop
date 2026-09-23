# web

Front-end for {{service}}. `PlatformStaticSite` uploads `web/dist` to the site bucket and
invalidates CloudFront on deploy. Put your framework of choice here and make its build write to
`web/dist`; the placeholder `index.html` shows the wiring.

```sh
# example with a Vite project
npm create vite@latest . -- --template react-ts
npm run build          # outputs to dist/
```

In CI, build the front-end before `cdk deploy` (add the build to the `build-command` input of the
reusable workflows or as an extra step in `.github/workflows/preview.yml`).
