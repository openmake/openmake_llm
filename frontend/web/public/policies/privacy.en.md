---
version: "1.0"
effective_date: "2026-05-24"
locale: en
---

# Privacy Policy (v2 Draft)

> ⚠️ **This document is a Claude-generated v2 draft.** Legal review required before production publication. Operators must obtain qualified legal counsel covering both GDPR (EU) and Republic of Korea data protection law prior to live deployment.

OpenMake LLM ("the Service") processes personal data in accordance with the EU General Data Protection Regulation (GDPR), the ePrivacy Directive, and applicable national data protection law (including the Republic of Korea Personal Information Protection Act where applicable).

## 1. Personal Data Collected

During account registration and service use, the following data is collected.

| Item | Collection Point | Required |
|------|------------------|----------|
| Username | Registration | Required |
| Email address | Registration | Required |
| Password (one-way hash) | Registration | Required |
| IP address, User-Agent | Registration, login, consent events | Auto-collected |
| Authentication cookie (HttpOnly JWT `auth_token`) | Post-login | Auto-generated |
| Conversation content, uploaded files | Service use | User-provided |
| External LLM API keys (user-registered) | User settings | Optional |

### 1-a. Automated Collection Devices (Cookies) and Refusal

- The Service uses an HttpOnly authentication cookie (`auth_token`) solely for session maintenance.
- No analytics, advertising, or tracking cookies are used.
- Refusal: Cookies can be blocked via browser settings. Blocking the authentication cookie will prevent logged-in use.
- Compliance: ePrivacy Directive — strictly necessary cookies do not require prior consent; analytics/tracking cookies, if introduced in the future, will require explicit opt-in.

## 2. Purposes of Processing

- **Account identification and authentication**: username, email, password hash, authentication cookie
- **Service provision**: conversation session management, model routing, per-user settings
- **Security and audit**: IP/User-Agent, `audit_logs` (admin action trail), `consent_logs` (GDPR Article 7 consent demonstrability)
- **Abuse prevention**: anomalous traffic blocking, rate limiting

## 3. Retention Periods

- **Active account**: retained until user-initiated deletion request
- **Inactive account isolation**: where applicable national law (e.g., Republic of Korea Information and Communications Network Act §29) requires, accounts inactive for one (1) year may be moved to separated storage (operational policy, subsequent implementation)
- **Account deletion**: handled per "Data Handling on User Deletion" policy below
- **`audit_logs` / `message_feedback`**: user identifier anonymized (`user_id → NULL`); content retained for audit obligations (default retention period subject to operator policy)
- **`consent_logs`**: deleted together with user account (CASCADE); PII (IP/User-Agent) automatically anonymized after 90 days (Phase C Fix 9)

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
- **Skill manifests (`skill_manifests`)** — the manifest itself is retained, but `created_by` is set to NULL and `is_public` is automatically set to false, ensuring **the manifest is no longer exposed to other users** (Phase A Fix 1 protection)

### (C) Reference-Protected (Manual Cleanup Required)
Data linked to other users' activities (reviews, marketplace listings, etc.) may require separate cleanup before deletion. If such data remains, account deletion may be temporarily blocked, and administrators will provide cleanup guidance.

## 5. Data Subject Rights

Users may exercise the following rights (GDPR Articles 15–22 + Korea PIPA §35-39 where applicable).

### How to Exercise
- **Online**: Settings page (`/settings.html`) provides direct exercise for:
  - Data export (access + portability) — "Export Data" button
  - Withdrawal of consent — "Consent Management" section
  - Email/username modification — Account settings
  - Account deletion request — separate inquiry (admin-handled at present; self-service deletion planned)
- **Email inquiry**: §11 Complaints Department or §10 Data Protection Officer (DPO)

### Rights Overview
- **Right of access (Article 15)**: view personal data held
- **Right to rectification (Article 16)**: correct inaccurate data
- **Right to erasure (Article 17)**: account deletion processed per §4 above
- **Right to restriction of processing (Article 18)**: separate inquiry
- **Right to data portability (Article 20)**: JSON export
- **Right to object (Article 21)**: separate inquiry
- **Right not to be subject to automated decision-making (Article 22)**: no automated decision-making currently used
- **Right to lodge a complaint with a supervisory authority (Article 77)**: see §11-a below

## 6. Consent (GDPR Article 7)

Explicit consent for this Policy and the Terms of Service is collected at registration.

- **Right to refuse**: Acceptance of the Policy and Terms is mandatory for registration — **refusal precludes account creation** (guest mode with limited features may be available separately).
- **Consequences of refusal**: personalized features (saved conversations, skill registration, etc.) are unavailable without an account.
- **Consent record metadata**: timestamp, policy version, locale, IP address, User-Agent.
- **Withdrawal**: available at any time via Settings → "Consent Management". Upon withdrawal, re-consent will be requested at next login.
- **Granular consent**: consent for the Privacy Policy and Terms of Service is recorded separately, allowing withdrawal of one without affecting the other.

## 7. Third-Party Disclosure and Processor Engagement

### 7-1. Third-Party Disclosure
Personal data is not disclosed to third parties as a rule, with the following exceptions:
- **Legal requirement**: lawful warrant or order from law enforcement / court of competent jurisdiction

### 7-2. Processor Engagement (GDPR Article 28)
The Service engages the following data processors (notified to users at consent collection):

| Processor | Processing Activity | Data Transferred |
|-----------|---------------------|------------------|
| External LLM providers (Anthropic, OpenAI, Google Gemini, etc.) | LLM inference for user-registered API keys | User input prompts (only when user explicitly registers external provider API keys) |
| Self-hosted vLLM / LiteLLM | Default LLM inference | User input prompts processed within operator infrastructure; no external transfer |

When external LLM providers are used, users should review the respective provider's privacy policy. International data transfers (if any) shall comply with GDPR Chapter V (e.g., Standard Contractual Clauses, adequacy decisions where applicable).

## 8. Security

- Password: bcrypt one-way hash
- Session: HttpOnly JWT cookies (SameSite, Secure attributes — HTTPS required in production)
- External API keys: AES-256-GCM encrypted at rest (`token-crypto.ts`)
- HTTPS: mandatory in production environments (e.g., via Caddy, Cloudflare Tunnel)
- Rate Limiting: per-IP and per-user request quotas

## 9. Changes to This Policy

Material changes (collection items, processing purposes, retention periods, or any change affecting data subject rights) will be:

- **Notified** via in-app modal (re-consent prompt) on first entry and via email (auxiliary)
- **Effective**: at least **30 days after notification** (consistent with EU consumer protection norms and Korea Electronic Commerce Act §15 where applicable)
- **Right to object**: users may terminate the account or request retention of the prior version (subject to negotiation) within the notification period

## 10. Data Controller and Data Protection Officer (DPO)

### 10-a. Data Controller
- **Legal entity name**: [Operator to provide — e.g., OpenMake Inc.]
- **Address**: [Operator to provide — registered business address]
- **Contact (email)**: [Operator to provide]
- **EU Representative (if applicable under GDPR Article 27)**: [Operator to provide if processing targets EU data subjects without establishment in the EU]

### 10-b. Data Protection Officer (DPO)
Designated under GDPR Article 37 (where required) and Korea PIPA §31:
- **Name**: [Operator to provide — actual value before publication]
- **Title**: [Operator to provide]
- **Contact (email)**: [Operator to provide — e.g., dpo@openmake.example]
- **Contact (phone)**: [Optional]

## 11. Complaints Department

For privacy-related complaints, exercise of data subject rights, or breach reports, contact:

- **Department**: [Operator to provide — e.g., OpenMake Privacy Team]
- **Email**: [Operator to provide]
- **Hours**: [Operator to provide — e.g., Monday-Friday 09:00-18:00 KST]

### 11-a. Supervisory Authorities (Right to Lodge a Complaint — GDPR Article 77)

Users have the right to lodge a complaint with a competent supervisory authority. Examples:

| Authority | Jurisdiction | Contact |
|-----------|--------------|---------|
| Personal Information Protection Commission (PIPC) | Republic of Korea | privacy.go.kr / 182 (toll-free) |
| Korea Internet & Security Agency (KISA) | Republic of Korea | privacy.kisa.or.kr / 118 (toll-free) |
| EU member state Data Protection Authorities | European Union | See edpb.europa.eu/about-edpb/about-edpb/members_en |
| (Other applicable national authority) | User's habitual residence | Per local law |

Users in the EU may lodge complaints with the Data Protection Authority of their member state of habitual residence, place of work, or where the alleged infringement occurred (Article 77 §1).

---

**Last updated**: 2026-05-24 (version 1.0, v2 draft)
