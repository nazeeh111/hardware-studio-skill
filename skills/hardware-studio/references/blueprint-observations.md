# Blueprint.io observations and useful boundaries

Public site sampled 22 October 2026: [home](https://www.blueprint.io/), [FAQ](https://www.blueprint.io/faq), [pricing](https://www.blueprint.io/pricing), and a [published 3D printer project](https://www.blueprint.io/s/4HKdHznzhy-I8Gfv61LL0FATpp_CxnKSKkiFw8hQCFw).

The public workflow presents prompt or image/sketch input, then a project with Info, Parts, Wiring, Mech and Instructions. The project example displayed named parts and estimated cost, a labeled wiring graph, a 3D viewer, and 26 build steps. The mechanical viewer warned that nine parts were not attached to the main assembly. This is evidence of the interface, not engineering validity.

The FAQ reports optional private projects, community publishing, CAD export, version history and paid ZIP export. It acknowledges wrong parts, prices, placement and supplier links. No public API is advertised. These facts may change: inspect the live site before relying on feature availability, plan terms or prices.

An unauthenticated REA capture of the public home page retained its shipped frontend code. Static request references in that version covered generation, images, project saves, sourcing, wiring-rail inference, CAD jobs, ZIP export, publishing and collaboration. Only the landing-page feature, statistics, trending and community requests were observed running. The static graph was partial, and neither a frontend reference nor a landing-page request proves that a private backend feature works. See [the analysis](https://github.com/nazeeh111/hardware-studio-skill/blob/main/BLUEPRINT_ANALYSIS.md) for the capture scope and evidence IDs.

A separate capture of the one published 3D printer project returned linked part nodes, electrical relationships, mechanical relationships and grouped instructions. Its electrical links had source and target part IDs, type and voltage; part nodes carried pin lists separately. This shape does not prove pin-to-pin correctness or physical fit. Keep electrical and mechanical links distinct in an original work package.

Transferable design lesson: keep every part, wire, mechanical object and instruction in one linked record; expose estimates and open review items. Do not transfer Blueprint's branding, content or unverified claims into another product.
