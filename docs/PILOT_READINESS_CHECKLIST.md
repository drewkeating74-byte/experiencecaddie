# Experience Caddie — Test Results Template

Use this template when manually running scenario tests. Fill in each scenario row as you go. At the end, complete the master summary and pilot decision.

**Test date:** _______________  
**Tester:** _______________  
**Environment:** ☐ Production  ☐ Staging  ☐ Local

---

## Master Summary (fill after running scenarios)

*Note recurring issues that showed up across multiple scenarios. Use this to prioritize fixes.*

| Issue | Scenarios affected | Severity | Status |
|-------|--------------------|----------|--------|
| | | | |
| | | | |
| | | | |

**Top 3 issues to fix before pilot:**

1. _______________________________________
2. _______________________________________
3. _______________________________________

---

## Final Decision: Ready for Small Pilot?

**Criteria (all must be true):**

- [ ] No P0 issues remaining
- [ ] At least 10/15 scenarios Pass or Thin but acceptable
- [ ] Share link works in incognito
- [ ] All three outbound links (Tickets, hotel, golf) open correctly when logged in
- [ ] No private golf courses in Silver/Gold
- [ ] Gold package always has golf

**Decision:** ☐ **Yes — ready for pilot**  ☐ **No — block pilot**  ☐ **Conditional — pilot with caveats**

**Notes:** _______________________________________

---

## Scenario Results

*Copy the template below for each scenario. Status options: Pass | Thin but acceptable | Fail*

### Template (copy per scenario)

| Field | Your response |
|-------|---------------|
| **Scenario name** | |
| **Market strength** | Strong / Medium / Weak |
| **Entry flow** | A: I know who I want to see / B: Best upcoming shows / C: I'm flexible |
| **Expected result** | |
| **Actual result** | |
| **Status** | Pass / Thin but acceptable / Fail |
| **Event quality notes** | |
| **Golf quality notes** | |
| **Lodging quality notes** | |
| **Trust/UX notes** | |
| **Outbound link notes** | |
| **Click tracking verified?** | Yes / No |
| **If something's wrong — likely component** | *(optional, for devs)* |
| **Fix priority** | P0 / P1 / P2 / N/A |

---

### Scenario 1: Artist + major market

| Field | Your response |
|-------|---------------|
| Scenario name | Artist + major market |
| Market strength | Strong |
| Entry flow | A: I know who I want to see |
| City / Artist / Dates | e.g. Nashville, Luke Combs, next 6 months |
| Expected result | 3 tiers, real events, golf, hotels. All links work. |
| Actual result | |
| Status | Pass / Thin but acceptable / Fail |
| Event quality notes | |
| Golf quality notes | |
| Lodging quality notes | |
| Trust/UX notes | |
| Outbound link notes | |
| Click tracking verified? | Yes / No |
| Likely component if wrong | search, generate-itinerary |
| Fix priority | P0 / P1 / P2 / N/A |

---

### Scenario 2: Artist + medium market

| Field | Your response |
|-------|---------------|
| Scenario name | Artist + medium market |
| Market strength | Medium |
| Entry flow | A: I know who I want to see |
| City / Artist / Dates | e.g. Rogers AR or Thackerville OK |
| Expected result | Itinerary builds. Fewer options OK. No blank tiers. |
| Actual result | |
| Status | Pass / Thin but acceptable / Fail |
| Event quality notes | |
| Golf quality notes | |
| Lodging quality notes | |
| Trust/UX notes | |
| Outbound link notes | |
| Click tracking verified? | Yes / No |
| Likely component if wrong | search, generate-itinerary |
| Fix priority | P0 / P1 / P2 / N/A |

---

### Scenario 3: Artist + weak market

| Field | Your response |
|-------|---------------|
| Scenario name | Artist + weak market |
| Market strength | Weak |
| Entry flow | A: I know who I want to see |
| City / Artist / Dates | Small town, any artist |
| Expected result | Mock data or "no results". No endless loading. |
| Actual result | |
| Status | Pass / Thin but acceptable / Fail |
| Event quality notes | |
| Golf quality notes | |
| Lodging quality notes | |
| Trust/UX notes | |
| Outbound link notes | |
| Click tracking verified? | Yes / No |
| Likely component if wrong | search, fallback logic |
| Fix priority | P0 / P1 / P2 / N/A |

---

### Scenario 4: Discover — best shows

| Field | Your response |
|-------|---------------|
| Scenario name | Discover — best shows |
| Market strength | Strong |
| Entry flow | B: Best upcoming shows |
| City / Genres / Dates | e.g. Nashville, Country, next 3 months |
| Expected result | 3 concert options → pick one → full itinerary matches. |
| Actual result | |
| Status | Pass / Thin but acceptable / Fail |
| Event quality notes | |
| Golf quality notes | |
| Lodging quality notes | |
| Trust/UX notes | |
| Outbound link notes | |
| Click tracking verified? | Yes / No |
| Likely component if wrong | generate-itinerary (discover_concerts) |
| Fix priority | P0 / P1 / P2 / N/A |

---

### Scenario 5: Discover — flexible

| Field | Your response |
|-------|---------------|
| Scenario name | Discover — flexible |
| Market strength | — |
| Entry flow | C: I'm flexible |
| City / Genres / Dates | Flexible city, any genres |
| Expected result | 3 options across US cities. Pick one → itinerary in that city. |
| Actual result | |
| Status | Pass / Thin but acceptable / Fail |
| Event quality notes | |
| Golf quality notes | |
| Lodging quality notes | |
| Trust/UX notes | |
| Outbound link notes | |
| Click tracking verified? | Yes / No |
| Likely component if wrong | generate-itinerary (discover) |
| Fix priority | P0 / P1 / P2 / N/A |

---

### Scenario 6: Discover — flexible city

| Field | Your response |
|-------|---------------|
| Scenario name | Discover — flexible city |
| Market strength | Strong |
| Entry flow | B or C |
| City / Genres / Dates | Austin, Rock, next 2 months |
| Expected result | 3 Austin-area options. Itinerary focused on Austin. |
| Actual result | |
| Status | Pass / Thin but acceptable / Fail |
| Event quality notes | |
| Golf quality notes | |
| Lodging quality notes | |
| Trust/UX notes | |
| Outbound link notes | |
| Click tracking verified? | Yes / No |
| Likely component if wrong | generate-itinerary |
| Fix priority | P0 / P1 / P2 / N/A |

---

### Scenario 7: Discover — no results

| Field | Your response |
|-------|---------------|
| Scenario name | Discover — no results |
| Market strength | Weak |
| Entry flow | B or C |
| City / Dates | Very small city, narrow dates |
| Expected result | "No concerts found" + retry options. No crash. |
| Actual result | |
| Status | Pass / Thin but acceptable / Fail |
| Event quality notes | |
| Golf quality notes | |
| Lodging quality notes | |
| Trust/UX notes | |
| Outbound link notes | |
| Click tracking verified? | Yes / No / N/A |
| Likely component if wrong | generate-itinerary, ExperienceBuilder |
| Fix priority | P0 / P1 / P2 / N/A |

---

### Scenario 8: Artist — no tour dates

| Field | Your response |
|-------|---------------|
| Scenario name | Artist — no tour dates |
| Market strength | — |
| Entry flow | A |
| City / Artist / Dates | Austin, obscure artist, next 6 months |
| Expected result | Thin or mock result. Clear messaging. No broken UI. |
| Actual result | |
| Status | Pass / Thin but acceptable / Fail |
| Event quality notes | |
| Golf quality notes | |
| Lodging quality notes | |
| Trust/UX notes | |
| Outbound link notes | |
| Click tracking verified? | Yes / No |
| Likely component if wrong | search, fallback |
| Fix priority | P0 / P1 / P2 / N/A |

---

### Scenario 9: Flexible location + dates

| Field | Your response |
|-------|---------------|
| Scenario name | Flexible location + dates |
| Market strength | — |
| Entry flow | A, B, or C |
| City / Dates | Both flexible |
| Expected result | Uses Austin fallback. Itinerary builds. |
| Actual result | |
| Status | Pass / Thin but acceptable / Fail |
| Event quality notes | |
| Golf quality notes | |
| Lodging quality notes | |
| Trust/UX notes | |
| Outbound link notes | |
| Click tracking verified? | Yes / No |
| Likely component if wrong | search, ExperienceBuilder |
| Fix priority | P0 / P1 / P2 / N/A |

---

### Scenario 10: Share link (incognito)

| Field | Your response |
|-------|---------------|
| Scenario name | Share link — incognito |
| Market strength | — |
| Entry flow | — |
| Steps | Copy share link → open in incognito window |
| Expected result | Link loads. Full content. Login prompt on Save/link click. |
| Actual result | |
| Status | Pass / Thin but acceptable / Fail |
| Event quality notes | |
| Golf quality notes | |
| Lodging quality notes | |
| Trust/UX notes | |
| Outbound link notes | |
| Click tracking verified? | Yes / No / N/A |
| Likely component if wrong | SharedItinerary, ItineraryResults |
| Fix priority | P0 / P1 / P2 / N/A |

---

### Scenario 11: Login redirect

| Field | Your response |
|-------|---------------|
| Scenario name | Login redirect |
| Market strength | — |
| Entry flow | — |
| Steps | Open itinerary logged out → click Tickets or Save |
| Expected result | Redirect to login → after login, back to same itinerary. track-click works. |
| Actual result | |
| Status | Pass / Thin but acceptable / Fail |
| Event quality notes | |
| Golf quality notes | |
| Lodging quality notes | |
| Trust/UX notes | |
| Outbound link notes | |
| Click tracking verified? | Yes / No |
| Likely component if wrong | Auth, ItineraryResults |
| Fix priority | P0 / P1 / P2 / N/A |

---

### Scenario 12: All three outbound links

| Field | Your response |
|-------|---------------|
| Scenario name | All three outbound links |
| Market strength | — |
| Entry flow | — |
| Steps | Logged in. Click Tickets, hotel link, golf link. |
| Expected result | Each opens correct site. track-click 200 for each. |
| Actual result | |
| Status | Pass / Thin but acceptable / Fail |
| Event quality notes | |
| Golf quality notes | |
| Lodging quality notes | |
| Trust/UX notes | |
| Outbound link notes | |
| Click tracking verified? | Yes / No |
| Likely component if wrong | ItineraryResults, track-click, outbound-link |
| Fix priority | P0 / P1 / P2 / N/A |

---

### Scenario 13: Gold golf fallback

| Field | Your response |
|-------|---------------|
| Scenario name | Gold golf fallback |
| Market strength | Medium |
| Entry flow | A |
| City / Dates | Medium market with few gold courses |
| Expected result | Gold package still has golf. No empty golf section. |
| Actual result | |
| Status | Pass / Thin but acceptable / Fail |
| Event quality notes | |
| Golf quality notes | |
| Lodging quality notes | |
| Trust/UX notes | |
| Outbound link notes | |
| Click tracking verified? | Yes / No |
| Likely component if wrong | generate-itinerary (gold fallback) |
| Fix priority | P0 / P1 / P2 / N/A |

---

### Scenario 14: Private golf filter

| Field | Your response |
|-------|---------------|
| Scenario name | Private golf filter |
| Market strength | Any |
| Entry flow | A |
| City / Dates | City with mixed public/private courses |
| Expected result | All tiers show only public-access courses. No "Country Club" or members-only. |
| Actual result | |
| Status | Pass / Thin but acceptable / Fail |
| Event quality notes | |
| Golf quality notes | |
| Lodging quality notes | |
| Trust/UX notes | |
| Outbound link notes | |
| Click tracking verified? | Yes / No |
| Likely component if wrong | generate-itinerary (isLikelyPrivateGolf), search |
| Fix priority | P0 / P1 / P2 / N/A |

---

### Scenario 15: Save & My Trips

| Field | Your response |
|-------|---------------|
| Scenario name | Save & My Trips |
| Market strength | — |
| Entry flow | — |
| Steps | Save tier → go to My Trips → re-open. Check share link. |
| Expected result | Bookmark shows saved. My Trips lists it. Re-open shows same tier saved. |
| Actual result | |
| Status | Pass / Thin but acceptable / Fail |
| Event quality notes | |
| Golf quality notes | |
| Lodging quality notes | |
| Trust/UX notes | |
| Outbound link notes | |
| Click tracking verified? | Yes / No / N/A |
| Likely component if wrong | ItineraryResults, user_saved_packages |
| Fix priority | P0 / P1 / P2 / N/A |

---

## Quick Reference

**Entry flows:**  
- **A** = I already know who I want to see  
- **B** = Show me the best upcoming shows  
- **C** = I'm flexible — show me something great  

**Status meanings:**  
- **Pass** = Met expectations  
- **Thin but acceptable** = Fewer options than ideal but usable; no blockers  
- **Fail** = Something broken or misleading; fix before pilot  

**Fix priority:**  
- **P0** = Blocks pilot  
- **P1** = Fix before pilot if possible  
- **P2** = Nice to fix; can defer  

**Market strength:**  
- **Strong** = Nashville, Austin, Phoenix, Las Vegas, Denver, Dallas, Atlanta  
- **Medium** = Thackerville OK, Rogers AR, Bend OR  
- **Weak** = Small towns, no Ticketmaster coverage  

---

## Non-Developer Version (plain language)

*Use this if you're not technical. Skip "Likely component" and "Fix priority" — those are for the dev team.*

### Simple checklist per scenario

- [ ] **Scenario:** _______________________________________
- [ ] **What I tried:** City ______, Artist/flow ______, Dates ______
- [ ] **What I expected:** _______________________________________
- [ ] **What actually happened:** _______________________________________
- [ ] **Result:** ☐ Pass  ☐ Thin but OK  ☐ Fail
- [ ] **Concerts:** Good / OK / Bad / None — notes: _______________
- [ ] **Golf:** Good / OK / Bad / None — notes: _______________
- [ ] **Hotels:** Good / OK / Bad / None — notes: _______________
- [ ] **Page feel:** Clear / Confusing — notes: _______________
- [ ] **Links:** All worked? ☐ Yes  ☐ No — which broke? _______________
- [ ] **When I clicked Tickets/hotel/golf, did it track?** ☐ Yes  ☐ No  ☐ Didn't check

*Repeat for each scenario. Share your notes with the dev team.*

---

*Last updated: March 2025.*
