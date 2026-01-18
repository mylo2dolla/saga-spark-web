# Supabase Edge Functions - AI Provider Configuration

These functions call Groq directly from the server. No AI keys are ever sent to the client.

Required secrets:

```
npx supabase secrets set GROQ_API_KEY="your_groq_key"
```

Optional base URL override (defaults to `https://api.groq.com/openai`):

```
npx supabase secrets set GROQ_BASE_URL="https://api.groq.com/openai"
```

Deploy functions after updating secrets:

```
npx supabase functions deploy generate-class
npx supabase functions deploy world-generator
npx supabase functions deploy dungeon-master
```
