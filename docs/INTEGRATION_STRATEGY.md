# Integration strategy

> **Design only. No integration exists in this build.** No channel, payment or provider is claimed to work. Where credentials are unavailable, the integration interface will ship with a clearly labelled *sandbox* mode that is never confused with production behaviour.

## Framework (planned, Phase 2+)
- `integrations` (per-org connection: provider, status, scopes, owner, last sync, error), `integration_credentials` (encrypted with envelope encryption; keys from a secret manager, never in code or client bundles), `webhooks` + `webhook_deliveries` (signed HMAC, replay protection, retries with backoff, delivery log).
- Provider adapters implement a small contract: `connect` (OAuth2 where supported), `refresh`, `sync` (cursor-based, idempotent), `send`, `handleWebhook`, `disconnect/revoke`.
- Field mapping configuration per integration; sync status and error reporting surfaced to admins.
- Disconnect revokes tokens at the provider and stops all jobs (to be tested: a revoked integration cannot continue operating).
- Integration permissions are separate from user permissions; an integration acts as a restricted service identity.

## Priority order and prerequisites
| Area | First targets | Needs from you |
|---|---|---|
| Email + calendar | Google Workspace, Microsoft 365 (OAuth) | OAuth app registrations, consent screen review |
| Messaging | WhatsApp Business Cloud API, SMS (India DLT-compliant provider) | Meta business verification, approved templates, DLT registration |
| Payments | Razorpay, Stripe | Merchant accounts, webhook secrets |
| Accounting | Zoho Books, Tally bridge, QuickBooks | API access |
| E-commerce | Shopify, WooCommerce | App credentials |
| Telephony | Exotel / Twilio | Accounts, number provisioning |

## Compliance guardrails
Consent records and channel-specific policies (WhatsApp template approval, TRAI/DLT for SMS, unsubscribe handling) are enforced **before** any outbound send. No message, payment or delivery is ever reported as successful unless the provider confirmed it.

## Developer platform (Phase 7)
Public REST API with API keys/OAuth clients, webhooks for outbound events, OpenAPI docs, and a marketplace listing model with scoped permissions and review.
