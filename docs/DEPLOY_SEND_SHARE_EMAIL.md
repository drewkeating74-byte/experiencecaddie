# Deploy send-share-email Edge Function – Step by Step

Plain-English guide to deploy the **send-share-email** function to your live Supabase project.

---

## 1. Confirm the function exists in the repo

**Exact path in the repo:**

```
apps/web/supabase/functions/send-share-email/index.ts
```

The folder `send-share-email` contains the Edge Function code. The main file is `index.ts`. You do not need to change any code to deploy; you only run the deploy command from the right directory.

---

## 2. Directory to open in the terminal

Open your terminal and go to the **web app folder** (where the Supabase config for this project lives). From the **root of the repo** run:

```bash
cd apps/web
```

So your current directory should be `apps/web` (the one that contains the `supabase` folder). All Supabase deploy commands for this project are run from here.

---

## 3. Deploy command to run

With your terminal still in `apps/web`, run:

```bash
npx supabase functions deploy send-share-email
```

- **If you have the Supabase CLI installed globally** and the command `supabase` works, you can use:
  ```bash
  supabase functions deploy send-share-email
  ```
- **If you get “command not found” for `supabase`**, use the first form with `npx supabase`.

After it runs, you should see a line like “Deployed Function send-share-email” or similar. If you see an error about “not linked” or “project”, do step 4 first.

---

## 4. Do you need to be linked to a Supabase project first?

**Yes.** The Supabase CLI must be linked to your **live** Supabase project before deploy will work.

**Check if you are already linked**

- In the same terminal, from `apps/web`, run:
  ```bash
  npx supabase status
  ```
- If it prints project details and no “linked” error, you are linked.

**If you are not linked (or you want to link to the live project)**

1. Get your **Project ID** from the Supabase Dashboard: open your project → **Settings** → **General** → **Reference ID** (or the ID in the project URL).
2. From `apps/web`, run:
   ```bash
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```
   Replace `YOUR_PROJECT_REF` with that project ID (e.g. `dieuiwbrnlxobmsvipza` if that is your live project).
3. When prompted, log in to Supabase (browser or access token) if needed.
4. After “Linked successfully” (or similar), run the deploy command again from step 3.

---

## 5. How to verify it deployed successfully (plain English)

1. **In the terminal**  
   After running the deploy command, you should see a success message such as “Deployed Function send-share-email” (wording may vary). No red error text usually means the deploy succeeded.

2. **In the Supabase Dashboard**  
   - Go to [Supabase Dashboard](https://supabase.com/dashboard).  
   - Open your **live** project.  
   - In the left sidebar, click **Edge Functions**.  
   - You should see **send-share-email** in the list.  
   - Clicking it should show details (e.g. logs, invocations).  

3. **From your app**  
   - Open your live site (e.g. on Vercel).  
   - Open an itinerary and click **Share via email**.  
   - Enter a real email address and click **Send**.  
   - If the function is deployed and secrets are set (see step 6), you should see a success message and receive the email. If secrets are missing, you may see a “Server misconfiguration” type error instead of “Failed to fetch”.

---

## 6. Secrets required for the function to work

The **send-share-email** function needs **two** secrets set in Supabase:

| Secret name       | What it is                          | Why it’s needed                                      |
|-------------------|-------------------------------------|------------------------------------------------------|
| **RESEND_API_KEY**| API key from your Resend account    | Used to send the email via Resend’s API              |
| **FROM_EMAIL**    | The sender email address (e.g. `noreply@yourdomain.com`) | Shown as “From” in the share email; must be verified in Resend |

**Where to set them**

- Supabase Dashboard → your project → **Project Settings** (gear icon) → **Edge Functions** → **Secrets** (or “Manage secrets”).  
- Add (or update) **RESEND_API_KEY** and **FROM_EMAIL** with the correct values.  
- Resend: [resend.com](https://resend.com) – get the API key there and add/verify the domain used in **FROM_EMAIL**.

If either secret is missing, the function will respond with a 500 and a message like “Server misconfiguration: RESEND_API_KEY or FROM_EMAIL not set”.

---

## 7. Where those secrets are used in the function code

In **`apps/web/supabase/functions/send-share-email/index.ts`**:

**Around lines 55–60 (reading the secrets):**

```ts
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL");
if (!RESEND_API_KEY || !FROM_EMAIL) {
  return new Response(
    JSON.stringify({ error: "Server misconfiguration: RESEND_API_KEY or FROM_EMAIL not set" }),
    ...
  );
}
```

So the function reads **RESEND_API_KEY** and **FROM_EMAIL** from the environment. If either is missing, it returns the “Server misconfiguration” error and does not call Resend.

**Around lines 112–120 (using them to send the email):**

```ts
const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${RESEND_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: FROM_EMAIL,
    to: recipientEmails,
    subject: "Check out this golf + concert weekend",
    html,
  }),
});
```

- **RESEND_API_KEY** is sent in the `Authorization` header to Resend.  
- **FROM_EMAIL** is sent in the request body as `from`.

You do not need to change this code when deploying; you only need to set the two secrets in the Supabase Dashboard for your project.

---

## Quick checklist

- [ ] Terminal is in **`apps/web`** (from repo root: `cd apps/web`).
- [ ] Project is linked: `npx supabase link --project-ref YOUR_PROJECT_REF` (if needed).
- [ ] Deploy run: `npx supabase functions deploy send-share-email`.
- [ ] Success message in terminal and **send-share-email** appears under Edge Functions in the Dashboard.
- [ ] **RESEND_API_KEY** and **FROM_EMAIL** are set in Supabase → Project Settings → Edge Functions → Secrets.
- [ ] Test from the live site: Share via email → enter email → Send; success message and/or email received.
