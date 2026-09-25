# Third-party notices

The [MIT License](LICENSE) covers project-owned code and documentation. It does not relicense
third-party dependencies, trademarks, provider data or user-supplied content.

## Software

[Complete production dependency notices](public/third-party-licenses.txt) are generated from the
locked, installed packages, including React/React DOM (MIT), Lucide (ISC and retained Feather MIT
notices), Fastify and its plugins (MIT), Prisma (Apache-2.0), parse5 (MIT), fflate (MIT) and their
transitive dependencies. Their original copyright notices are intentionally retained. These are
third-party legal attributions, not the repository owner's private contact information.

Run `npm ci` and `npm run licenses:generate` after dependency changes; inspect the result and commit
it. `npm run licenses:check` verifies freshness during validation. The browser distribution includes
`third-party-licenses.txt`, linked from Admin → Credits. Runtime images include the project license,
this notice and the dependency notices. Development-only tools are not bundled in the application;
their own notices remain in their packages. A package's metadata is evidence, not a legal warranty.

`abstract-logging@2.0.1` omits a license file from its package but links to
[the author's MIT grant](https://jsumners.mit-license.org/) in its README. A copy is retained in
`licenses/abstract-logging.txt` (retrieved 2026-09-24, with author attribution from package metadata).

Node.js, Alpine Linux and the optional Caddy/Cloudflare proxy have separate upstream licenses. Their
container distributions retain upstream notices; review the generated image SBOM for the exact
components. Do not strip their notices when redistributing images.

## Data, icons and trademarks

- Weather data is from [Open-Meteo](https://open-meteo.com/en/licence), licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The UI credits the provider and indicates
  rounding/summarization. The [free API terms](https://open-meteo.com/en/terms) and commercial service
  terms are separate from the data license; commercial operators must choose appropriate access.
- This product uses the TMDB API but is not endorsed or certified by TMDB. The bundled
  `public/tmdb-logo.svg` identifies TMDB and is excluded from this project's MIT grant. TMDB logos,
  posters and data remain governed by [TMDB attribution/API rules](https://developer.themoviedb.org/docs/faq).
  The owner must verify the bundled logo against the approved asset before public distribution;
  its exact source provenance is not recorded. Commercial API use requires appropriate permission.
- Service icons may be obtained at runtime from
  [Homarr dashboard-icons](https://github.com/homarr-labs/dashboard-icons), whose collection is
  Apache-2.0 licensed. Individual product marks retain their owners' rights. No endorsement is implied.
- Bundled ChatGPT and YouTube destination logos come from a pinned Homarr dashboard-icons revision.
  Exact sources, hashes, and owner attribution are in `public/logos/NOTICE.txt`; the collection license
  is retained in `public/logos/LICENSE.txt`. These product marks remain their owners’ property and are
  excluded from this project’s MIT grant. No affiliation or endorsement is implied.
- Google, ChatGPT, browser and integration names identify compatible external services. This project
  does not grant trademark rights or rights to redistribute provider content.
- Import only backgrounds and other content you have permission to use. User data and uploads are
  not included in the source license or distributed demo assets.

Before public release, maintainers must confirm rights to project contributions and the asset
provenance noted above. This inventory does not establish ownership of historical contributions.
