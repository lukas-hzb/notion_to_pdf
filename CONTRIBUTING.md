# Contributing

Thanks for taking the time to improve Notion to PDF. Bug reports and focused
feature proposals are welcome. Because the project is proprietary
source-available software, code contributions require prior written
authorization from the maintainer before creating a public fork or submitting a
pull request.

## Before opening an issue

1. Use Node.js 22.13 or newer; Node.js 24 is recommended.
2. Run `npm ci`, `npm run setup`, and `npm run build`.
3. Run `npm run export -- --doctor` and try the synthetic example with
   `npm run demo`.
4. Search existing issues and review the [support matrix](docs/SUPPORT.md).

Never attach a personal Notion export, generated report, or screenshot that may
contain private content. Reduce the problem to synthetic HTML or describe the
relevant markup without personal data.

## Development workflow

```sh
npm ci
npm run setup
npm run check
npm run test:pdf
```

Keep changes focused and add regression coverage for changed behavior. For
layout changes, include a synthetic fixture and inspect the generated PDF in
addition to relying on extracted text or geometry checks. The architecture and
test workflow are documented in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

Commit messages must be concise English
[Conventional Commits](https://www.conventionalcommits.org/) messages, for
example `fix: preserve roman list markers`.

## Pull requests

A pull request should explain:

- what changed and why;
- which source structures are affected;
- how the change was tested;
- known limitations or visual trade-offs.

By submitting a contribution, you agree to section 5 of [LICENSE](LICENSE),
including its contributor grant and representations. Third-party material must
be clearly identified and compatible with the project's distribution model.

## Security reports

Do not open public issues for vulnerabilities. Follow [SECURITY.md](SECURITY.md)
instead.
