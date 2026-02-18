# Supabase Edge Functions - AI Provider Configuration

Mythic runtime functions are locked to OpenAI. No AI keys are ever sent to the client.

Required secrets for Mythic:

```bash
npx supabase secrets set OPENAI_API_KEY="your_openai_key"
```

Optional model/base URL overrides:

```bash
npx supabase secrets set OPENAI_MODEL="gpt-4o-mini"
npx supabase secrets set OPENAI_BASE_URL="https://api.openai.com"
```

Deploy Mythic functions after updating secrets:

```bash
npx supabase functions deploy mythic-dungeon-master
npx supabase functions deploy mythic-create-character
npx supabase functions deploy mythic-field-generate
```

If `OPENAI_API_KEY` is missing, Mythic functions return `openai_not_configured`.
If OpenAI requests fail, Mythic functions return `openai_request_failed`.
