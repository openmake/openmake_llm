---
version: "1.0"
effective_date: "2026-05-24"
locale: en
---

# Privacy Policy (Draft)

> ⚠️ **This document is a Claude-generated draft.** Legal review required before production publication. Operators must obtain legal counsel prior to live deployment.

OpenMake LLM ("the Service") processes personal data as follows.

## 1. Personal Data Collected

During account registration and service use, the following data is collected.

| Item | Collection Point | Required |
|------|------------------|----------|
| Username | Registration | Required |
| Email address | Registration | Required |
| Password (one-way hash) | Registration | Required |
| IP address, User-Agent | Registration, login, consent events | Auto-collected |
| Conversation content, uploaded files | Service use | User-provided |
| External LLM API keys (user-registered) | User settings | Optional |

## 2. Purpose of Processing

- **Account identification and authentication**: username, email, password hash
- **Service provision**: conversation session management, model routing, per-user settings
- **Security and audit**: IP/User-Agent, `audit_logs` (admin action trail), `consent_logs` (GDPR Article 7 consent demonstrability)
- **Abuse prevention**: anomalous traffic blocking, rate limiting

## 3. Retention Period

- **Active account**: indefinite (deletion available upon user request)
- **Account deletion**: applies per "Data Handling on User Deletion" policy below
- **`audit_logs` / `message_feedback`**: user identifier anonymized; audit trail retained (separate retention period applies)
- **`consent_logs`**: deleted together with user (CASCADE)

## 4. Data Handling on User Deletion

The service classifies user data into three categories upon account deletion.

### (A) Immediately Deleted (CASCADE)
- Custom agents (`custom_agents`)
- Personal skills (`agent_skills`)
- Conversation sessions (`conversation_sessions`)
- User memories (`user_memories`)
- External API keys, OAuth connections (`external_connections`, `user_api_keys`)
- MCP server instances/registrations
- Push subscriptions (`push_subscriptions`)
- Consent history (`consent_logs`)

### (B) Author Anonymized, Content Retained (SET NULL)
- **Audit logs (`audit_logs`)** — required for admin action traceability
- **Message feedback (`message_feedback`)** — model evaluation data
- **Skill manifests (`skill_manifests`)** — the manifest itself is retained, but `created_by` is set to NULL and `is_public` is automatically set to false, ensuring **the manifest is no longer exposed to other users** (GDPR Phase A Fix 1 protection)

### (C) Reference-Protected (NO ACTION)
The following data is linked to other users' activities and requires separate cleanup before deletion.
- `agent_feedback`, `agent_installations`, `agent_marketplace.author_id`
- `agent_reviews`, `agent_usage_logs`, `canvas_documents`

If data remains in this category, account deletion may be temporarily blocked, and administrators will provide cleanup guidance.

## 5. Data Subject Rights (GDPR Articles 15–22)

Users may exercise the following rights.

- **Right of access (Article 15)**: view personal data held — Settings page "Data Export" (currently exports conversation sessions only; manifest/agents/memories inclusion planned)
- **Right to rectification (Article 16)**: edit email/username via Settings
- **Right to erasure (Article 17)**: account deletion — processed per §4 categories above
- **Right to restriction (Article 18)**: separate inquiry
- **Right to portability (Article 20)**: data export in JSON format
- **Right to object (Article 21)**: separate inquiry
- **Right not to be subject to automated decision-making (Article 22)**: no automated decision-making currently used

## 6. Consent (GDPR Article 7)

Explicit consent for this Policy and the Terms of Service is collected at registration. Consent records are retained with the following metadata:

- Consent timestamp
- Policy version (e.g., 1.0)
- User locale at consent time
- IP address, User-Agent

Withdrawal of consent is currently handled via separate inquiry (a self-service withdrawal feature in Settings is planned).

## 7. Third-Party Disclosure

Personal data is not disclosed to third parties as a rule, with the following exceptions:

- **LLM service calls**: User input is forwarded through LiteLLM proxy to the self-hosted vLLM backend. Calls to external LLM providers (Anthropic, OpenAI, Gemini, etc.) only occur when the user has registered their own API key; such calls are subject to the respective provider's policy.
- **Legal requirement**: lawful warrant or order from law enforcement / court

## 8. Security

- Password: bcrypt one-way hash
- Session: HttpOnly JWT cookies
- External API keys: AES-256-GCM encrypted at rest (`token-crypto.ts`)
- HTTPS recommended (operator infrastructure dependent)

## 9. Contact

For inquiries regarding this Policy, please contact the service administrator.

---

**Last updated**: 2026-05-24 (version 1.0)
