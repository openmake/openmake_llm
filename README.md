# OpenMake LLM

**Privacy-first, self-hosted AI assistant platform with multi-model orchestration.**

OpenMake LLM is a privacy-first AI platform based on multi-model orchestration that you can build and run directly on your local server or cloud environment. You can configure and utilize powerful AI agents while maintaining perfect control over your data.

## 🌟 Features Overview

### 🤖 Core AI
- **Smart Auto-Routing**: Analyzes queries (coding, math, general chat, vision, etc.) and automatically routes them to the optimal model.
- **7 Brand Model Profiles**: Provides various brand model profiles and pipeline execution strategies.
- **Agent-to-Agent (A2A)**: Synthesizes the optimal response through parallel generation across multiple models.
- **Discussion & Deep Research Mode**: Supports multi-model debates, cross-validation, and autonomous multi-step deep research agents.
- **Sequential Thinking**: Visualizes step-by-step cognitive reasoning processes.
- **Long-term Memory**: Distinct long-term memory system tailored for each user.

### 🛠️ Platform
- **MCP (Model Context Protocol) Support**: Dynamically toggle tools in Settings or control access separately via Free/Pro/Enterprise tiers.
- **Platform Integrations**: Google/GitHub OAuth, RBAC (Role-Based Access Control), Web Search integration, and PDF document text extraction/analysis.
- **Management & Operations**: Distributed Ollama node cluster management, token monitoring, activity audit logs, system alerts, and usage analytics.
- **Enhanced Developer Experience**: Supports 11 CLI tools (including `chat, ask, review, generate`) and provides auto-generated Swagger API documentation (`/api-docs`).

---

## 📸 System Screenshots

> See the images located in the `usermanual` directory for detailed guide and setup screens.

![Main UI](usermanual/main_ui.png)
![System Settings & Model Management](usermanual/settings_ui.png)
![Multi-Agent & MCP Tools Screen](usermanual/agent_tools.png)

*(Please check the `usermanual` directory in the repository for more diverse screenshots from the real production environment.)*

---

## 🚀 Installation

### Prerequisites
- **Node.js** ≥ 18
- **PostgreSQL** ≥ 14
- **Ollama** (For running local LLMs)

#### 💻 Test Hardware Specifications
- **Device**: Mac mini (M4)
- **CPU**: Apple M4 (10 Cores: 4 Performance, 6 Efficiency)
- **Memory**: 16 GB RAM

#### 🧠 Installed Ollama Models (Test Node)
- `nomic-embed-text:latest`
- `qwen3.5:397b-cloud` (qwen3.5:cloud)
- `glm-5:cloud`
- `gpt-oss:120b-cloud`
- `gemini-3-flash-preview:cloud`

### Step 1: Clone the repository and install packages
```bash
git clone https://github.com/openmake/openmake_llm.git
cd openmake_llm
npm install
```

### Step 2: Configure environment variables
```bash
cp .env.example .env
# Open the .env file and edit the settings (e.g., database connection) to suit your environment.
```

### Step 3: Setup database
```bash
createdb openmake_llm
# Tables will be automatically created upon the first launch.
```

### Step 4: Build and Start Server
```bash
# Build the entire source code
npm run build

# Start the server (Cluster mode operation)
node backend/api/dist/cli.js cluster --port 52416
```

---

## 📚 Detailed Documentation & Guide

For more details—such as API integration, cluster configuration, tier-based user management, and custom agent setups—after installation, please refer to the official website below.

🔗 **[OpenMake LLM Website & Development Info](http://rasplay.tplinkdns.com:33000/)**  
🔗 **[Detailed Operation Guide & API Docs](http://rasplay.tplinkdns.com:33000/docs/)**

> **Your AI. Your Server. Your Rules.**  
> Start building your very own AI server now while securely protecting your data!
