<a id="readme-top"></a>

# Open Notebook - Fork Overview

This branch extends [Open Notebook](https://github.com/lfnovo/open-notebook) with a source-reading workbench and documents a private, single-server workflow for two computers. The upstream project README follows below with minor wording and English-label adjustments.

> **Release status:** This branch uses PDF.js 6.4.299. Its Liberation Sans 1.07.4 modified-font distribution terms remain under review, and the two bundled QuickJS MIT notices have not yet been added to the deployed assets. Do not publish or newly deploy the workbench until the review is complete. The instructions below document access to an existing installation.

## What's Different in This Fork

- **PDF reading workspace:** View an available original PDF with page navigation and zoom. Select text to quote it with a page reference, translate it, or ask for an explanation.
- **Source conversations:** Compare two source-chat sessions and use a separate translation and terminology assistant. Model selection and reasoning controls depend on the configured provider and model.
- **Optional local reader memory:** Preview selected Mei memory before use and create review candidates. The bridge is restricted to local access; it does not automatically share personal agent memory with a remote browser.
- **Safer local configuration:** Ignore rules cover common local secrets, database files, deployment files, and agent configuration. Git still tracks files that were already added, so review the staged changes before every commit.
- **Private remote-access guide:** The procedure below uses one existing host and an optional, separately licensed Tailscale installation. The app does not depend on a GitHub repository for data synchronization.

## One Server, Two Windows PCs

Computer **A** runs Open Notebook, its database, the background worker, and Tailscale. Computer **B** runs Tailscale and a web browser; it does not need a second Open Notebook installation or a copy of this branch. Both browsers use the same server-side notebooks, uploaded files, model configuration, and saved conversations. Refresh the other browser after a completed change; live collaborative editing and in-progress task synchronization are not guaranteed.

This is remote access to one instance, **not** offline replication or a backup. A must stay awake, online, and running the app and Tailscale. Browser login state, unsent drafts, UI preferences, other agents' local files, and the local-only Mei reader-memory bridge are not automatically shared. Separate-device access and bidirectional upload/session behavior still need an end-to-end test.

### Before You Begin

- Use a private tailnet and a strong Open Notebook password. Serve is available to devices and identities permitted by your tailnet access policy; do not use Tailscale Funnel or expose the database to the public internet. Review the [security guide](docs/5-CONFIGURATION/security.md).
- The [Tailscale Personal plan](https://tailscale.com/pricing) is intended for non-commercial personal use. Check current terms and plan limits; AI provider usage and other services can have separate charges.
- This walkthrough references Tailscale **1.104.4**, the version checked for this setup. Tailscale is optional third-party software obtained directly from its publisher; review its [terms](https://tailscale.com/terms), update settings, and security advisories for your own use. Do not redistribute the installer with this repository.
- Back up the database, uploaded files, and existing encryption key separately. Do not change an existing encryption key without a recovery plan. Keep passwords, keys, private URLs, and machine-specific settings out of Git.
- B receives data displayed or downloaded in its browser, and the browser stores the application password locally. External AI providers receive any prompts and context sent to them. Use trusted devices and providers.

### Computer A: Prepare the Host

If A is already configured and its private HTTPS URL works, leave the existing configuration in place and continue with Computer B.

1. Install and sign in to Tailscale on A using the same Windows installer and sign-in steps below. Keep the Tailscale tray icon connected.
2. Open the [Tailscale DNS admin page](https://console.tailscale.com/admin/dns). Enable **MagicDNS** and, if needed, **HTTPS Certificates**. A Serve setup prompt may also guide you to enable HTTPS. Issuing a certificate records the machine's full DNS name in public Certificate Transparency logs; choose a machine name that contains no sensitive information before enabling it. The service itself remains subject to tailnet access controls. See [Tailscale's HTTPS documentation](https://tailscale.com/docs/how-to/set-up-https-certificates).
3. On the [Machines page](https://console.tailscale.com/admin/machines), find A's full Tailscale DNS name. Use your own name wherever this guide shows `<a-machine>.<tailnet>.ts.net`; do not commit it or credentials to the repository.
4. Configure the existing installation's API process with a strong `OPEN_NOTEBOOK_PASSWORD` or `OPEN_NOTEBOOK_PASSWORD_FILE`. Configure the **frontend process** with the private HTTPS URL, without an `/api` suffix. Use your local startup environment or secret manager; do not put the real values in tracked files. For Next.js development, frontend variables can be placed in the ignored `frontend/.env.local` file:

   ```dotenv
   API_URL=https://<a-machine>.<tailnet>.ts.net
   ```

   If a Next.js development server blocks the remote host, also set `NEXT_ALLOWED_DEV_ORIGINS` to the hostname only. The frontend forwards `/api/*` to `INTERNAL_API_URL`, normally `http://localhost:5055`. After current tasks finish, restart the affected processes to apply the new environment. See the [environment reference](docs/5-CONFIGURATION/environment-reference.md) and [reverse-proxy guide](docs/5-CONFIGURATION/reverse-proxy.md).
5. Start the database, API, worker, and frontend on A using your existing local startup method. The source-development defaults use frontend port `3000`, API port `5055`, and database port `8000`; see [development setup](docs/7-DEVELOPMENT/development-setup.md). Keep the API and database on loopback where possible. Machine-specific startup scripts are not included in the repository.
6. In PowerShell on A, check the existing Serve configuration. If `tailscale.exe` is not on `PATH`, replace the placeholder with the full path to your installed `tailscale.exe`:

   ```powershell
   & "<path-to-tailscale.exe>" serve status
   ```

   Only if it is not already configured for the local frontend, set up private HTTPS forwarding. The command can replace an existing Serve mapping on the same port, so inspect the status first:

   ```powershell
   & "<path-to-tailscale.exe>" serve --bg http://127.0.0.1:3000
   & "<path-to-tailscale.exe>" serve status
   ```

   If prompted, open the displayed Tailscale link and complete the Serve/HTTPS enablement. Copy the private `https://...ts.net` URL from the status output; do not use Funnel. See the official [Serve examples](https://tailscale.com/docs/reference/examples/serve).
7. On A, open that HTTPS URL and sign in to Open Notebook. Confirm the notebooks page loads and the API connects before trying B.

### Computer B: One-Download Windows Installation

1. On B, download the [official Tailscale 1.104.4 Windows installer](https://pkgs.tailscale.com/stable/tailscale-setup-1.104.4.exe). Windows 10 or later is required. This is a one-click download, but installation still requires running the downloaded installer and accepting any Windows administrator prompt.
2. Run the installer and finish its prompts. Find the Tailscale icon in the system tray; if it is hidden, select the tray's up arrow. Choose **Log in** and use the **same account and sign-in provider** as A. Confirm the tray says **Connected**. If device approval is required, approve it in the Tailscale admin console.
3. Check the installed version and update preferences in the Tailscale tray menu. New devices may inherit automatic-update settings from the tailnet. Review updates and their terms according to your policy, and do not defer important security updates indefinitely. See [Tailscale update settings](https://tailscale.com/kb/1067/update/).
4. Open A's private HTTPS URL in B's browser and enter the **Open Notebook application password**, not a GitHub credential. Share the URL and password through a trusted channel, not a public issue or commit. Do not bypass certificate warnings.
5. Test with a non-sensitive notebook, upload, or conversation on one computer; refresh the other computer to confirm the saved result appears, then repeat in the opposite direction. A model request can incur provider charges. Do not assume two simultaneous tasks or browser-local drafts are synchronized.

### Troubleshooting

- **`DNS_PROBE_FINISHED_NXDOMAIN`:** Check that both devices are connected to the same tailnet, MagicDNS is enabled, B accepts Tailscale DNS, and the full hostname is correct. A browser's explicitly selected Secure DNS provider can bypass the system resolver. If you choose to change it, open Chrome `chrome://settings/security` and, under **Use secure DNS**, choose **Operating system default (if available)** or **Current service provider**, depending on the Chrome version. Leave Secure DNS enabled. This change affects browser-wide DNS behavior and may permit fallback to unencrypted DNS; see [Chrome's Secure DNS guidance](https://support.google.com/chrome/answer/10468685?co=GENIE.Platform%3DDesktop&hl=en).
- **Login page opens but the API is unreachable:** Confirm A's API and worker are running, `API_URL` is the private HTTPS URL without `/api`, the frontend can reach its internal API, and any configured `CORS_ORIGINS` includes the browser origin. See [reverse-proxy troubleshooting](docs/5-CONFIGURATION/reverse-proxy.md).
- **The page is unavailable:** Confirm A is awake, the app and Tailscale are running, `serve status` shows the intended private mapping, and the tailnet policy permits B. Do not open database ports or enable Funnel as a shortcut.
- **Mei memory is unavailable on B:** The reader-memory bridge is intentionally local-only in this branch. It does not provide remote access to A's personal agent memory; do not disable its loopback checks to work around this limitation.

---

## Upstream Open Notebook README

<!-- [![Contributors][contributors-shield]][contributors-url] -->
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]
<!-- [![LinkedIn][linkedin-shield]][linkedin-url] -->


<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/lfnovo/open-notebook">
    <img src="docs/assets/hero.svg" alt="Logo">
  </a>

  <h3 align="center">Open Notebook</h3>

  <p align="center">
    An open source, privacy-focused alternative to Google's Notebook LM!
    <br /><strong>Join our <a href="https://discord.gg/37XJPXfz2w">Discord server</a> for help, to share workflow ideas, and suggest features!</strong>
    <br />
    <a href="https://www.open-notebook.ai"><strong>Checkout our website »</strong></a>
    <br />
    Follow <a href="https://x.com/lfnovo">@lfnovo on X</a> for updates
    <br />
    <br />
    <a href="docs/0-START-HERE/index.md">📚 Get Started</a>
    ·
    <a href="docs/3-USER-GUIDE/index.md">📖 User Guide</a>
    ·
    <a href="docs/2-CORE-CONCEPTS/index.md">✨ Features</a>
    ·
    <a href="docs/1-INSTALLATION/index.md">🚀 Deploy</a>
  </p>
</div>

<p align="center">
<a href="https://trendshift.io/repositories/14536" target="_blank"><img src="https://trendshift.io/api/badge/repositories/14536" alt="lfnovo%2Fopen-notebook | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<div align="center">
  <!-- Keep these links. Translations will automatically update with the README. -->
  <a href="https://zdoc.app/de/lfnovo/open-notebook">German</a> |
  <a href="https://zdoc.app/es/lfnovo/open-notebook">Spanish</a> |
  <a href="https://zdoc.app/fr/lfnovo/open-notebook">French</a> |
  <a href="https://zdoc.app/ja/lfnovo/open-notebook">Japanese</a> |
  <a href="https://zdoc.app/ko/lfnovo/open-notebook">Korean</a> |
  <a href="https://zdoc.app/pt/lfnovo/open-notebook">Portuguese</a> |
  <a href="https://zdoc.app/ru/lfnovo/open-notebook">Russian</a> |
  <a href="https://zdoc.app/zh/lfnovo/open-notebook">Chinese</a>
</div>

## A private, multi-model, 100% local, full-featured alternative to Notebook LM

![New Notebook](docs/assets/asset_list.png)

In a world dominated by Artificial Intelligence, having the ability to think 🧠 and acquire new knowledge 💡, is a skill that should not be a privilege for a few, nor restricted to a single provider.

**Open Notebook empowers you to:**
- 🔒 **Control your data** - Keep your research private and secure
- 🤖 **Choose your AI models** - 20+ providers including OpenAI, Anthropic, Google, Mistral, Ollama and any OpenAI-compatible server (LM Studio, vLLM)
- 📚 **Organize multi-modal content** - PDFs, videos, audio, web pages, and more
- 🎙️ **Generate professional podcasts** - Advanced multi-speaker podcast generation
- 🔍 **Search intelligently** - Full-text and vector search across all your content
- 💬 **Chat with context** - AI conversations powered by your research
- 🌐 **Multi-language UI** - English, Bengali, Catalan, Chinese (Simplified & Traditional), French, German, Italian, Japanese, Polish, Portuguese, Russian, Spanish and Turkish

Learn more about our project at [https://www.open-notebook.ai](https://www.open-notebook.ai)

---

## 🆚 Open Notebook vs Google Notebook LM

| Feature | Open Notebook | Google Notebook LM | Advantage |
|---------|---------------|--------------------|-----------|
| **Privacy & Control** | Self-hosted, your data | Google cloud only | Complete data sovereignty |
| **AI Provider Choice** | 20+ providers, cloud or local (OpenAI, Anthropic, Google, Ollama, LM Studio, etc.) | Google models only | Flexibility and cost optimization |
| **Podcast Speakers** | 1-4 speakers with custom profiles | 2 speakers only | Extreme flexibility |
| **Content Transformations** | Custom and built-in | Limited options | Unlimited processing power |
| **API Access** | Full REST API | No API | Complete automation |
| **Deployment** | Docker, cloud, or local | Google hosted only | Deploy anywhere |
| **Citations** | Answers cite the sources, notes and insights they used | Comprehensive with sources | Research integrity |
| **Customization** | Open source, fully customizable | Closed system | Unlimited extensibility |
| **Cost** | Pay only for AI usage | Free tier + Monthly subscription | Transparent and controllable |

**Why Choose Open Notebook?**
- 🔒 **Privacy First**: Your sensitive research stays completely private
- 💰 **Cost Control**: Choose cheaper AI providers or run locally with Ollama
- 🎙️ **Better Podcasts**: Full script control and multi-speaker flexibility vs limited 2-speaker deep-dive format
- 🔧 **Unlimited Customization**: Modify, extend, and integrate as needed
- 🌐 **No Vendor Lock-in**: Switch providers, deploy anywhere, own your data

### Built With

[![Python][Python]][Python-url] [![Next.js][Next.js]][Next-url] [![React][React]][React-url] [![SurrealDB][SurrealDB]][SurrealDB-url] [![LangChain][LangChain]][LangChain-url]

## 🚀 Quick Start

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (macOS, Windows) or Docker Engine with the Compose plugin (Linux)
- An API key from an AI provider, or a local model server such as Ollama. You add it in the UI, not in config files.

### Step 1: Download docker-compose.yml
```bash
mkdir open-notebook && cd open-notebook
curl -o docker-compose.yml https://raw.githubusercontent.com/lfnovo/open-notebook/main/docker-compose.yml
```

This is the official [docker-compose.yml](docker-compose.yml) from this repository. It runs two services: `surrealdb` (the database) and `open_notebook` (UI, API and background worker).

### Step 2: Set your encryption key
Edit `docker-compose.yml` and change this line:
```yaml
- OPEN_NOTEBOOK_ENCRYPTION_KEY=change-me-to-a-secret-string
```
to a long random secret you generate yourself (for example with `openssl rand -hex 32`; [other options](docs/1-INSTALLATION/docker-compose.md#step-2-set-your-encryption-key)). It encrypts the API keys you store; keep it.

> **Shared network or server?** The UI (`8502`) and API (`5055`) are published on all network interfaces and there is no password by default. If other devices can reach this machine, change those two port lines to `"127.0.0.1:8502:8502"` and `"127.0.0.1:5055:5055"`, or add `- OPEN_NOTEBOOK_PASSWORD=your-password` to the `environment:` block, before starting.

### Step 3: Start services
```bash
docker compose up -d
```

Wait about 30 seconds, then open: **http://localhost:8502**

### Step 4: Connect an AI provider
1. In the sidebar, open **Models** (under Manage).
2. Find your provider (OpenAI, Anthropic, Google, etc.) and click **Add Configuration**.
3. Enter a name and your API key (local providers such as Ollama need a **Base URL** instead), then click **Add Configuration**.
4. Click **Test** on the new configuration to check the connection.
5. Click **Models**, choose a **Model Type**, tick the models to add and click **Add**. Add at least one **Language** model and one **Embedding** model.
6. Under **Default Model Assignments**, click **Auto-assign Defaults** (or pick the models yourself).

Done! Create a notebook, add a source and start chatting. Full walkthrough: [Connect a provider](docs/4-AI-PROVIDERS/index.md#connect-a-provider).

> **Need an API key?** Get one from:
> [OpenAI](https://platform.openai.com/api-keys) · [Anthropic](https://console.anthropic.com/settings/keys) · [Google](https://aistudio.google.com/app/apikey) · [Groq](https://console.groq.com/keys)
>
> Anthropic and Groq have no embedding models; pair them with a provider that does (see the [matrix](#provider-support-matrix)).

> **Want free local AI?** See the [Local Quick Start](docs/0-START-HERE/quick-start-local.md) (Ollama in Docker).

---

### 📚 More Installation Options

- **[Local AI with Ollama](docs/0-START-HERE/quick-start-local.md)** - Run models locally without API costs
- **[Docker Compose guide](docs/1-INSTALLATION/docker-compose.md)** - Settings, backups, updates, remote access
- **[From Source (Developers)](docs/1-INSTALLATION/from-source.md)** - For development and contributions
- **[Complete Installation Guide](docs/1-INSTALLATION/index.md)** - All deployment scenarios

---

### 📖 Need Help?

- **🤖 AI Installation Assistant**: [CustomGPT to help you install](https://chatgpt.com/g/g-68776e2765b48191bd1bae3f30212631-open-notebook-installation-assistant)
- **🆘 Troubleshooting**: [5-minute troubleshooting guide](docs/6-TROUBLESHOOTING/quick-fixes.md)
- **💬 Community Support**: [Discord Server](https://discord.gg/37XJPXfz2w)
- **🐛 Report Issues**: [GitHub Issues](https://github.com/lfnovo/open-notebook/issues)

---

## Star History

[![Star History Chart](https://star-history.dera.page/svg?repos=lfnovo/open-notebook&type=date&legend=top-left)](https://star-history.dera.page/#lfnovo/open-notebook&type=date&legend=top-left)


## Provider Support Matrix

Thanks to the [Esperanto](https://github.com/lfnovo/esperanto) library, we support these providers out of the box. The columns show the model types each provider offers; what you can use depends on your account.

| Provider     | LLM Support | Embedding Support | Speech-to-Text | Text-to-Speech |
|--------------|-------------|------------------|----------------|----------------|
| OpenAI       | ✅          | ✅               | ✅             | ✅             |
| Anthropic    | ✅          | ❌               | ❌             | ❌             |
| Google (GenAI) | ✅          | ✅               | ✅             | ✅             |
| Groq         | ✅          | ❌               | ✅             | ❌             |
| Mistral      | ✅          | ✅               | ✅             | ✅             |
| DeepSeek     | ✅          | ❌               | ❌             | ❌             |
| xAI          | ✅          | ❌               | ❌             | ✅             |
| OpenRouter   | ✅          | ✅               | ✅             | ✅             |
| DashScope (Qwen) | ✅          | ❌               | ❌             | ❌             |
| MiniMax      | ✅          | ❌               | ❌             | ✅             |
| Novita       | ✅          | ❌               | ❌             | ❌             |
| SiliconFlow  | ✅          | ❌               | ❌             | ❌             |
| Z.ai         | ✅          | ❌               | ❌             | ❌             |
| PayPerQ (PPQ) | ✅          | ✅               | ✅             | ✅             |
| Cohere       | ✅          | ✅               | ❌             | ❌             |
| Voyage       | ❌          | ✅               | ❌             | ❌             |
| ElevenLabs   | ❌          | ❌               | ✅             | ✅             |
| Deepgram     | ❌          | ❌               | ✅             | ✅             |
| Ollama       | ✅          | ✅               | ❌             | ❌             |
| oMLX         | ✅          | ✅               | ❌             | ❌             |
| Azure OpenAI | ✅          | ✅               | ✅             | ✅             |
| Vertex AI    | ✅          | ✅               | ❌             | ✅             |
| OpenAI Compatible* | ✅          | ✅               | ✅             | ✅             |
| Anthropic Compatible | ✅          | ❌               | ❌             | ❌             |

*Supports LM Studio and any OpenAI-compatible endpoint. Prefer the native **oMLX** provider for [oMLX](https://omlx.ai/) (Apple Silicon); see [docs/5-CONFIGURATION/omlx.md](docs/5-CONFIGURATION/omlx.md).

## ✨ Key Features

### Core Capabilities
- **🔒 Privacy-First**: Self-host your data and use local models to avoid sending model requests to external AI providers; review other configured services and connections
- **🎯 Multi-Notebook Organization**: Manage multiple research projects seamlessly
- **📚 Universal Content Support**: PDFs, videos, audio, web pages, Office docs, and more
- **🤖 Multi-Model AI Support**: 20+ providers including OpenAI, Anthropic, Ollama, Google, LM Studio, and more
- **🎙️ Professional Podcast Generation**: Advanced multi-speaker podcasts with Episode Profiles
- **🔍 Intelligent Search**: Full-text and vector search across all your content
- **💬 Context-Aware Chat**: AI conversations powered by your research materials
- **📝 AI-Assisted Notes**: Generate insights or write notes manually

### Advanced Features
- **⚡ Reasoning Model Support**: Full support for thinking models like DeepSeek-R1 and Qwen3
- **🔧 Content Transformations**: Powerful customizable actions to summarize and extract insights
- **🌐 Comprehensive REST API**: Full programmatic access for custom integrations [![API Docs](https://img.shields.io/badge/API-Documentation-blue?style=flat-square)](http://localhost:5055/docs)
- **🔐 Optional Password Protection**: Add a password and review the security guide before exposing any service
- **📊 Fine-Grained Context Control**: Choose exactly what to share with AI models
- **📎 Citations**: Get answers with proper source citations


## Podcast Feature

[![Check out our podcast sample](https://img.youtube.com/vi/D-760MlGwaI/0.jpg)](https://www.youtube.com/watch?v=D-760MlGwaI)

## 📚 Documentation

### Getting Started
- **[📖 Introduction](docs/0-START-HERE/index.md)** - Learn what Open Notebook offers
- **[⚡ Quick Start with a Cloud Provider](docs/0-START-HERE/quick-start-cloud.md)** - OpenAI, Anthropic, Google and more in 5 minutes
- **[🔧 Installation](docs/1-INSTALLATION/index.md)** - Comprehensive setup guide
- **[🎯 Run It Fully Local](docs/0-START-HERE/quick-start-local.md)** - Ollama/LM Studio, completely private

### User Guide
- **[📱 Interface Overview](docs/3-USER-GUIDE/interface-overview.md)** - Understanding the layout
- **[📚 Notebooks, Sources & Notes](docs/2-CORE-CONCEPTS/notebooks-sources-notes.md)** - Organizing your research
- **[📄 Adding Sources](docs/3-USER-GUIDE/adding-sources.md)** - Managing content types
- **[📝 Working with Notes](docs/3-USER-GUIDE/working-with-notes.md)** - Creating and managing notes
- **[💬 Chatting Effectively](docs/3-USER-GUIDE/chat-effectively.md)** - AI conversations
- **[🔍 Search](docs/3-USER-GUIDE/search.md)** - Finding information

### Advanced Topics
- **[🎙️ Podcast Generation](docs/2-CORE-CONCEPTS/podcasts-explained.md)** - Create professional podcasts
- **[🔧 Content Transformations](docs/3-USER-GUIDE/transformations.md)** - Customize content processing
- **[🤖 AI Providers](docs/4-AI-PROVIDERS/index.md)** - Connect providers and set default models
- **[🔌 MCP Integration](docs/5-CONFIGURATION/mcp-integration.md)** - Connect with Claude Desktop, VS Code and other MCP clients
- **[🔧 REST API Reference](docs/7-DEVELOPMENT/api-reference.md)** - Complete API documentation
- **[🔐 Security](docs/5-CONFIGURATION/security.md)** - Password protection and privacy
- **[🚀 Deployment](docs/1-INSTALLATION/index.md)** - Complete deployment guides for all scenarios
- **[🧭 Vision & Principles](VISION.md)** - What Open Notebook is, and where it's going
- **[🛠️ Developer Docs](docs/7-DEVELOPMENT/index.md)** - Architecture, setup, contributing, decision records

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## 🗺️ Where We're Going

Right now the focus is on making the core experience (sources, chat, search, notes, podcasts) solid across every provider and deployment, before adding new product surfaces. The bigger directions under consideration, such as multi-user support, new output formats and agents operating Open Notebook through MCP, are described in the **Horizon** section of [VISION.md](VISION.md#horizon). They are directions, not dated promises.

Explore [GitHub Discussions](https://github.com/lfnovo/open-notebook/discussions/categories/ideas) for proposed features and product ideas, and [open Issues](https://github.com/lfnovo/open-notebook/issues) for known bugs and approved work. Recent changes are in the [CHANGELOG](CHANGELOG.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>


## 📖 Need Help?
- **🤖 AI Installation Assistant**: We have a [CustomGPT built to help you install Open Notebook](https://chatgpt.com/g/g-68776e2765b48191bd1bae3f30212631-open-notebook-installation-assistant) - it will guide you through each step!
- **New to Open Notebook?** Start with our [Getting Started Guide](docs/0-START-HERE/index.md)
- **Need installation help?** Check our [Installation Guide](docs/1-INSTALLATION/index.md)
- **Want to see it in action?** Try our [Quick Start Tutorial](docs/0-START-HERE/index.md)

## 🤝 Community & Contributing

### Join the Community
- 💬 **[Discord Server](https://discord.gg/37XJPXfz2w)** - Get help, share ideas, and connect with other users
- 𝕏 **[Follow @lfnovo on X](https://x.com/lfnovo)** - Project updates and news from the maintainer
- 💡 **[GitHub Discussions](https://github.com/lfnovo/open-notebook/discussions)** - Ask questions and shape features, product direction, design, and architecture
- 🐛 **[GitHub Issues](https://github.com/lfnovo/open-notebook/issues)** - Report reproducible bugs and find approved work
- ⭐ **Star this repo** - Show your support and help others discover Open Notebook

### Contributing
We welcome contributions! We're especially looking for help with:
- **Frontend Development**: Help improve our modern Next.js/React UI
- **Testing & Bug Fixes**: Make Open Notebook more robust
- **Feature Development**: Build the coolest research tool together
- **Documentation**: Improve guides and tutorials

**Current Tech Stack**: Python, FastAPI, Next.js, React, SurrealDB

See our [Contributing Guide](CONTRIBUTING.md) for detailed information on how to get started, including our guidelines for [AI-assisted contributions](docs/7-DEVELOPMENT/contributing.md#ai-assisted-and-agent-generated-prs). To understand what we're building (and what we'll say no to), read [VISION.md](VISION.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>


## 📄 License

Open Notebook is MIT licensed. See the [LICENSE](LICENSE) file for details.


**Community Support**:
- 💬 [Discord Server](https://discord.gg/37XJPXfz2w) - Get help, share ideas, and connect with users
- 𝕏 [Follow @lfnovo on X](https://x.com/lfnovo) - Project updates and news from the maintainer
- 💡 [GitHub Discussions](https://github.com/lfnovo/open-notebook/discussions) - Ask questions and shape ideas
- 🐛 [GitHub Issues](https://github.com/lfnovo/open-notebook/issues) - Report reproducible bugs and find approved work
- 🌐 [Website](https://www.open-notebook.ai) - Learn more about the project

<p align="right">(<a href="#readme-top">back to top</a>)</p>


<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->
[contributors-shield]: https://img.shields.io/github/contributors/lfnovo/open-notebook.svg?style=for-the-badge
[contributors-url]: https://github.com/lfnovo/open-notebook/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/lfnovo/open-notebook.svg?style=for-the-badge
[forks-url]: https://github.com/lfnovo/open-notebook/network/members
[stars-shield]: https://img.shields.io/github/stars/lfnovo/open-notebook.svg?style=for-the-badge
[stars-url]: https://github.com/lfnovo/open-notebook/stargazers
[issues-shield]: https://img.shields.io/github/issues/lfnovo/open-notebook.svg?style=for-the-badge
[issues-url]: https://github.com/lfnovo/open-notebook/issues
[license-shield]: https://img.shields.io/github/license/lfnovo/open-notebook.svg?style=for-the-badge
[license-url]: https://github.com/lfnovo/open-notebook/blob/main/LICENSE
[linkedin-shield]: https://img.shields.io/badge/-LinkedIn-black.svg?style=for-the-badge&logo=linkedin&colorB=555
[linkedin-url]: https://linkedin.com/in/lfnovo
[Next.js]: https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white
[Next-url]: https://nextjs.org/
[React]: https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black
[React-url]: https://reactjs.org/
[Python]: https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white
[Python-url]: https://www.python.org/
[LangChain]: https://img.shields.io/badge/LangChain-3A3A3A?style=for-the-badge&logo=chainlink&logoColor=white
[LangChain-url]: https://www.langchain.com/
[SurrealDB]: https://img.shields.io/badge/SurrealDB-FF5E00?style=for-the-badge&logo=databricks&logoColor=white
[SurrealDB-url]: https://surrealdb.com/
