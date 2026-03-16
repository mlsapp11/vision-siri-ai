# vision-siri-ai

`vision-siri-ai` is a Cloudflare Worker project intended to help an iPhone user with vision impairment access AI answers through a voice-first Siri workflow.

The goal is to keep the experience simple and familiar. Instead of asking the user to learn a new app or a more complex mobile interface, this project aims to let Siri trigger a routine request that reaches an AI service and returns a useful response with as little friction as possible.

## Project purpose

This project is being built for a real accessibility need.

The intended user already relies on Siri as the primary way to use the iPhone and is not comfortable navigating broader iPhone features. The Worker in this repository is meant to act as a lightweight server-side broker between a Siri-triggered request and an AI system, so spoken questions can lead to high-quality AI answers in a workflow that feels natural and repeatable.

## Current status

The repository currently contains a minimal Cloudflare Worker starter so local development, GitHub version control, and Cloudflare deployment are all set up in a clean way.

Right now the Worker returns a simple hello-world response. The next phase is to replace that placeholder behavior with an endpoint and request flow that can support the Siri-based AI use case.

## Development workflow

This project is developed locally in VS Code and deployed to Cloudflare with Wrangler.

Important tools:

- `npm` installs and manages project dependencies.
- `npx` runs project tools without requiring a separate global install.
- `wrangler` is Cloudflare's command-line tool for running and deploying Workers.

Common commands:

```bash
npm install
npm run dev
npm run deploy
```

What they do:

- `npm install` downloads the project dependencies.
- `npm run dev` starts the Worker locally for testing.
- `npm run deploy` publishes the Worker to Cloudflare.

## Git workflow

The GitHub repository is the source of truth for the codebase.

A normal development cycle looks like this:

```bash
git add .
git commit -m "Describe the change"
git push
```

This keeps the local code, the GitHub repo, and the deployed Cloudflare Worker aligned.

## Near-term direction

Near-term work will likely include:

- defining the HTTP interface Siri or iPhone shortcuts will call
- connecting the Worker to an AI provider
- shaping responses so they work well in a voice-first interaction
- handling authentication, privacy, and request limits carefully
- keeping the user experience simple enough for someone who depends on Siri for accessibility

## Accessibility note

This project should favor clarity, reliability, and low-friction interaction over feature breadth. A technically impressive workflow is less important than one that is easy to trigger, easy to trust, and easy to repeat by voice.
