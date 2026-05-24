---
version: "1.0"
effective_date: "2026-05-24"
locale: en
---

# Terms of Service (v2 Draft)

> ⚠️ **This document is a Claude-generated v2 draft.** Legal review required before production publication.

## 1. Service Overview

OpenMake LLM ("the Service") is a self-hosted AI assistant platform providing multi-LLM model routing and user-defined agent/skill capabilities.

## 2. Accounts and Registration

- Provide accurate email and username at registration.
- Passwords must be at least 8 characters and include uppercase, lowercase, digit, and special character.
- You are responsible for safekeeping your account credentials.
- Account hijacking, automated bulk registration, and similar abuse are prohibited.

### 2-a. Minors (GDPR Article 8 + applicable national law)

- The Service does not knowingly permit registration by children below the applicable age of digital consent without verified parental authorization.
- **EU/EEA**: Under GDPR Article 8, the default age is 16; EU member states may lower this to 13 by national law. Users below the applicable age require verifiable parental consent.
- **Republic of Korea**: Under the Information and Communications Network Act §31 and PIPA §39-3, children under 14 require verifiable legal guardian consent.
- A self-service guardian consent flow is planned for future implementation; in the interim, please contact the operator for assisted registration.
- The operator must implement reasonable measures to verify users meet the applicable age threshold.

## 3. Use of Service

### 3.1 Permitted Use
- AI conversations for personal study, research, or work
- Creation and use of custom agents/skills
- External model calls using user-registered LLM API keys

### 3.2 Prohibited Use

The following are strictly prohibited (including but not limited to content prohibited under Republic of Korea Information and Communications Network Act §44-7 and equivalent EU/national prohibitions):

- Child sexual abuse material (CSAM) — zero tolerance, reported per applicable mandatory disclosure law
- Sexually explicit material involving non-consenting individuals
- Non-consensual intimate imagery (NCII) — creation, distribution, or facilitation
- Defamation, harassment, stalking, threats
- Content facilitating fraud, gambling, illicit drugs, or other criminal activity per applicable law
- Disclosure of state secrets or unauthorized classified information
- Content advocating violent extremism or terrorism
- Infringement of intellectual property rights (copyright, trademark, patent, design)
- Violation of others' rights (privacy, image, name, etc.)
- Unauthorized system intrusion, abuse, or excessive traffic generation
- Use of automation tools for high-volume calls (rate limit evasion)
- Exploitation of security vulnerabilities
- Discrimination or hateful content (gender, race, religion, origin, disability, etc.)
- Deliberate dissemination of disinformation
- Other content violating applicable law or public order and morals

Violations may result in account suspension or termination without prior notice, and the operator may comply with mandatory reporting obligations under applicable law.

## 4. Rate Limits and Usage Quotas

The Service applies the following limits for stable operation:

- Chat requests: hourly/weekly token quotas (`LLM_HOURLY_TOKEN_LIMIT`, `LLM_WEEKLY_TOKEN_LIMIT`)
- Separate quotas for management actions (API key management, MCP server registration, skill creation, etc.)
- Data export: per-user hourly limit, tiered by subscription (Free/Pro/Enterprise)
- Automatic reset after the quota window expires

## 5. Content Ownership and Intellectual Property

### 5-1. User Content
- Copyright in your prompts, uploaded files, and custom agents/skills **belongs to you**.
- Skill manifests you explicitly mark as public (`is_public=true`) may be shared with other users.
- Upon account deletion, manifests you authored are automatically set to non-public and are no longer shared (Privacy Policy §4).

### 5-2. AI-Generated Outputs
The copyright status of AI-generated outputs is **legally uncertain in many jurisdictions**; users should consider the following:
- Under Republic of Korea Copyright Act, copyright protection requires human authorship; pure AI outputs may not qualify for protection.
- Under U.S. Copyright Office guidance (March 2023), AI-only outputs are not eligible for copyright; user creative contribution (prompting, editing) may qualify.
- EU and other jurisdictions: positions vary; consult local counsel for commercial use.
- The operator makes no warranty as to the accuracy, completeness, or legality of AI outputs.
- Users are responsible for independent verification before use (distribution, commercial exploitation, etc.).

## 6. Disclaimers

- The Service is provided **"as is"** without warranty of fitness for a particular purpose.
- No warranty is given as to the accuracy, completeness, or legality of AI responses.
- The operator is not liable for service interruptions caused by external LLM providers (Anthropic, OpenAI, Gemini, etc.).
- The operator is not liable for service outages, data loss, or abuse-related damages absent willful misconduct or gross negligence.

### 6-a. Mandatory Rights Take Precedence
The following mandatory rights under applicable consumer protection law are not waived by this Agreement:

- **EU/EEA**: Mandatory rights under the EU Consumer Rights Directive (2011/83/EU), the Unfair Contract Terms Directive (93/13/EEC), and the Digital Services Act (2022/2065) — including, where applicable, the right of withdrawal, statutory warranties, and prohibition of unfair contract terms.
- **Republic of Korea**: Mandatory rights under the Consumer Fundamental Act, the Act on Standard Terms of Contract, the Electronic Commerce Act, and the Information and Communications Network Act.
- The operator's liability for willful misconduct or gross negligence cannot be excluded.
- Any clause of this Agreement found contrary to mandatory law is severable and shall be deemed unenforceable to the extent of such conflict; the remaining provisions remain in effect.

## 7. Changes to Terms

- The operator may modify these Terms in response to legal or operational changes.
- **Material changes** (adverse changes to user rights or obligations) will be **notified at least 30 days in advance** of effective date (Republic of Korea Electronic Commerce Act §15; equivalent EU consumer protection norms apply).
- **Minor changes** will be notified upon effect.
- Notification method: in-app modal on first entry (re-consent prompt) + email (auxiliary).
- Continued use of the Service after the notification period without objection constitutes acceptance. Users may terminate the account during the notification period if they do not consent.

## 8. Governing Law and Dispute Resolution

- These Terms are governed by the laws of the **Republic of Korea**, without prejudice to applicable mandatory consumer protection law of the user's jurisdiction.
- In the event of a dispute, users are encouraged first to contact the operator's complaints department (Privacy Policy §11) for amicable resolution.
- If amicable resolution fails:
  - **Republic of Korea consumers**: Korea Consumer Agency Consumer Dispute Mediation Committee (ccn.go.kr / 1372) or Korea Internet & Security Agency Electronic Transaction Dispute Mediation Committee (ecmc.or.kr).
  - **EU consumers**: ODR Platform (ec.europa.eu/consumers/odr) — Online Dispute Resolution.
- Unresolved disputes shall be submitted to the **competent court of the operator's principal place of business in the Republic of Korea**; consumers may also bring claims in their own court of habitual residence where applicable mandatory law (e.g., EU Regulation 1215/2012 Brussels I bis Article 18; Republic of Korea Civil Procedure Act §8) so provides.

## 9. Contact

For inquiries regarding these Terms, please contact the operator's complaints department (Privacy Policy §11).

---

**Last updated**: 2026-05-24 (version 1.0, v2 draft)
