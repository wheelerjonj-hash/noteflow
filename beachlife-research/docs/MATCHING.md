# Matching a listing to a parcel

## The problem

An OTA listing does not carry an address. It carries a title, a photo set, a
bedroom count, an amenity list, and a map pin that the platform has
deliberately displaced by a few hundred metres. The task is to decide which
physical parcel it is — or to decide, honestly, that you cannot tell.

That second outcome is the one most systems get wrong. Producing a confident
wrong address is worse than producing no address: it sends a mailer about
somebody's management problems to a neighbour who does not have any.

## What visual recognition can and cannot do here

**Interior photos are near-useless for geolocation.** Coastal rental interiors
converge on the same palette and the same layouts. A model can tell you two
interiors are the *same room* — that is genuinely useful — but not where the
room is.

**Exterior photos plus the pin can narrow to a handful of parcels.** A
distinctive Gulf-front house with a particular roofline, matched against aerial
and street imagery within the pin's radius, often resolves. A unit in a large
condo building does not, ever, because the units are indistinguishable from
outside. No model improvement changes that; the information is not in the image.

**The strongest photo signal is picture-to-picture, not picture-to-house.** The
same property listed on Airbnb, on VRBO, and on the management company's own
website almost always shares source images. A perceptual-hash collision against
a photo of *known* provenance — the PM site, where the image sits next to a
unit name that resolves to an address — is far stronger evidence than any
attempt to recognise a house from scratch. This is why crawling PM sites earns
its place in the pipeline.

## How the scorer works

Each signal in `src/match/signals.js` returns a **likelihood ratio**: how many
times more likely this evidence is if the candidate parcel *is* the listing
versus if it is not. Ratios above 1 support, below 1 oppose, exactly 1 is
uninformative. They compose by multiplication — addition in log space —
starting from a prior.

**The prior is 1/N**, where N is the number of candidate parcels. Before any
evidence, the listing is equally likely to be any of them. This single choice
is what makes the 40-unit condo building come out correctly: with N = 40 the
starting odds are low enough that signals every unit shares cannot rescue them.

| Signal | Notes |
|---|---|
| `geo` | **Saturates** inside the pin radius. A parcel 10m from a randomised pin is not better evidence than one 200m away, and rewarding it would be reading noise. |
| `bedrooms` | Matches often, but the island distribution is concentrated on 2–4BR, so a hit is worth less than it looks. |
| `bathrooms` | Weaker version of the same. |
| `pool` | Best cheap discriminator: roughly a third of AMI rentals have one and the appraiser records it independently. A listing advertising a private pool on a parcel with none is near-fatal. |
| `propertyType` | Condo vs single-family, with a compatibility allowance. |
| `size` | Square footage against advertised sleeps. Weak; breaks near-ties only. |
| `dbpr` | **Hard signal.** A vacation-rental licence at the parcel, held by the company the listing is attributed to. Pure public record. |
| `photo` | **Hard signal.** Perceptual-hash collision with a photo of known address provenance. |
| `unitName` | **Hard signal.** Listing title matches a published unit name that resolves to an address. |

## The three gates on auto-confirmation

A match is written as `confirmed` without a human only if **all three** hold:

1. **Posterior ≥ 0.92.**
2. **Margin ≥ 0.25 over the runner-up.** If the top two candidates are close,
   the score is actively penalised toward the middle. Two indistinguishable
   units both end up low, which is the truthful answer.
3. **At least one hard signal.** Geometry alone — pin, beds, baths, pool, type,
   all perfect — never auto-confirms. There is a test asserting exactly this.

Everything else goes to `candidate` status and the review queue
(`blr export review-queue`). Expect most listings to land there initially. That
is the system working: the queue shrinks as PM-site photo hashing and DBPR
attribution fill in, because those are the signals that carry addresses.

## What to build next

`listing_photo.phash` exists and `photoSignal()` reads it, but nothing populates
it yet. Hashing the crawled PM-site images and the OTA image sets, then
indexing by Hamming distance, is the highest-leverage remaining change: it turns
the PM-site crawl into cross-platform identity resolution and moves a large
fraction of the review queue into auto-confirm.
