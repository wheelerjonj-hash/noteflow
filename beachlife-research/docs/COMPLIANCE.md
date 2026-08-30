# Compliance notes

Not legal advice — run the outreach plan past counsel before the first send.
What follows is the reasoning behind the gates that are built into the code, so
that nobody removes one without knowing what it was for.

## Direct mail is the low-risk channel. Use it.

Owner name and mailing address come from the county appraiser and are public
record under Ch. 119, F.S. Mailing to them is what every real-estate mailer in
Florida already does. There is no consent regime, no registry to scrub against,
and no per-piece statutory damages.

`exportMailList()` is therefore the default export and the one to build the
campaign on.

## Phone and text are a different legal universe

Three regimes stack on a cold call to an owner:

1. **TCPA** (federal) — restricts autodialled and prerecorded calls, and texts.
2. **National Do Not Call Registry** — telemarketing calls to registered numbers
   are prohibited absent an established business relationship or written consent.
3. **Florida Telephone Solicitation Act** (s. 501.059, F.S.) — Florida's
   mini-TCPA. It requires prior express written consent for sales calls and
   texts using an automated system for selecting or dialling numbers, and
   carries **$500–$1,500 per call or text**, including for unintentional
   violations. Florida is the most active venue in the country for these suits.

2025 amendments loosened what counts as consent — an affirmative act such as
checking a box or replying to a text campaign can satisfy the signature
requirement — and calls to someone with a prior or existing business
relationship are not "unsolicited". Neither exception helps with a cold list of
property owners you have never done business with.

There is also an unsettled question specific to this use case: whether an offer
to *provide a service to* (or buy from) a property owner is a "sales call" at
all. It is a grey area, and it is not one to resolve by guessing.

**What the code does about it.** `owner_contact` records `provenance` for every
contact point (`public_record` / `skip_trace` / `self_reported`) and a
`dnc_scrubbed_at` timestamp. `exportPhoneList()` emits only numbers that have a
recorded scrub, came back not-listed, and are not flagged `do_not_contact`. If
nothing qualifies it raises an error naming how many unscrubbed records exist —
it does not quietly return a short list.

Before any calling campaign: scrub against the federal DNC registry and
Florida's own list, keep the scrub evidence, honour opt-outs immediately, and
have counsel review the script.

## Skip-traced data

Phone numbers from data brokers are not public record. They are lawful to
purchase for a permissible business purpose, but they carry the vendor's
contract terms, and they are the input to the phone-channel risk above. Record
them with `provenance = 'skip_trace'` so an export can tell them apart from a
mailing address that came off the tax roll.

## Platform terms of service

Airbnb and VRBO prohibit scraping. This project does not scrape them; see
`docs/DATA_SOURCES.md`. If someone later adds a scraping adapter, that decision
should be made deliberately and with counsel, not inherited by accident from a
pipeline that already exists.

Management company websites are crawled, politely and within `robots.txt`. That
is ordinary and expected behaviour for public marketing pages, but set
`CRAWL_USER_AGENT` to a contact address you actually monitor so an operator who
objects can reach you rather than simply blocking you.

## Data hygiene

- **Homesteaded parcels are excluded from prospecting.** They are residences.
- **s. 119.071(4)(d), F.S.** exempts the home addresses of certain protected
  occupations from public disclosure. If the county suppressed a record, do not
  reconstruct it from another source.
- **Reviewer names** are stored as published (first name only). There is no
  reason to enrich them, and doing so would turn a market research database into
  something else.
- **Retention.** Decide how long skip-traced contact data lives and delete on
  schedule. Nothing in the schema expires it automatically.
