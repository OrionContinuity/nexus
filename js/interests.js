/* ════════════════════════════════════════════════════════════════════
   NEXUS INTERESTS — Trajan's knowledge base of human hobbies
   v18.9 (May 2026)
   ════════════════════════════════════════════════════════════════════

   WHAT THIS IS

   Each NEXUS user has an "interests" tag list (admin-assigned + an
   optional auto-learned set). This module provides:

     1. The CANONICAL list of recognized interests with human labels
        and emoji glyphs.
     2. A KNOWLEDGE BASE for each interest — facts, quotes, quips —
        accurate, sourced where possible, never made up.
     3. The API Trajan calls to pick a phrase relevant to a person:
        getRandomFor(user, 'fact' | 'quote' | 'quip').
     4. Hooks for habits.js to record implicit interest signals over
        time, so Trajan learns each person's likes even without admin
        tagging everything.

   STORAGE

     nexus_users.interests          → jsonb array of strings, set by admin
                                       e.g. ["wine", "japan_history", "roman_history"]
     nexus_users.inferred_interests → jsonb object of learned interests
                                       { "coffee": { evidence: 4, weight: 0.6,
                                                     first_seen: "...", last_seen: "..." }}

   RPCs (in habits-interests-migration.sql):
     set_user_interests(p_id int, p_interests jsonb) → bool
     add_inferred_interest(p_id int, p_key text, p_evidence_inc int) → jsonb

   CONTENT PRINCIPLES

     • Real facts only. Anything that's myth or contested gets a "(by
       legend)" or "(disputed)" tag in the text.
     • Quotes attributed accurately. Authorship in source.
     • Quips are voice-of-Trajan original — terse, warm, slightly dry.
       Not surveillance, not generic.
     • Bilingual content uses NX.tr.auto on render; we author English.

   ════════════════════════════════════════════════════════════════════ */

(function(){
  if (!window.NX) window.NX = {};

  // ─── CANONICAL INTEREST CATALOG ────────────────────────────────────
  // Each interest has a `key` (machine), `label` (human), `glyph`
  // (emoji or icon), and `aliases` (admin-typed variations that map
  // to the canonical key).
  const CATALOG = {
    // ─── Drink ────────────────────────────────────────────────────
    wine: {
      label: 'Wine',
      glyph: '🍷',
      aliases: ['wine-lover', 'sommelier', 'oenophile', 'vino'],
      category: 'drink',
    },
    bourbon: {
      label: 'Bourbon / Whiskey',
      glyph: '🥃',
      aliases: ['whiskey', 'whisky', 'scotch', 'rye'],
      category: 'drink',
    },
    coffee: {
      label: 'Coffee',
      glyph: '☕',
      aliases: ['espresso', 'barista', 'pour-over'],
      category: 'drink',
    },
    tea: {
      label: 'Tea',
      glyph: '🍵',
      aliases: ['matcha', 'chai', 'sencha', 'pu-erh'],
      category: 'drink',
    },
    cocktails: {
      label: 'Cocktails',
      glyph: '🍸',
      aliases: ['mixology', 'craft-cocktails', 'martini'],
      category: 'drink',
    },

    // ─── Food ─────────────────────────────────────────────────────
    cooking: {
      label: 'Cooking',
      glyph: '🍳',
      aliases: ['chef', 'culinary', 'home-cook'],
      category: 'food',
    },
    bbq: {
      label: 'BBQ / Smoke',
      glyph: '🔥',
      aliases: ['texas-bbq', 'brisket', 'smoke'],
      category: 'food',
    },
    pizza: {
      label: 'Pizza',
      glyph: '🍕',
      aliases: ['pizza-nerd', 'neapolitan'],
      category: 'food',
    },
    sushi: {
      label: 'Sushi',
      glyph: '🍣',
      aliases: ['omakase', 'nigiri'],
      category: 'food',
    },

    // ─── History ──────────────────────────────────────────────────
    roman_history: {
      label: 'Roman History',
      glyph: '🏛️',
      aliases: ['rome', 'caesar', 'trajan', 'marcus-aurelius'],
      category: 'history',
    },
    japan_history: {
      label: 'Japan History',
      glyph: '⛩️',
      aliases: ['samurai', 'shogun', 'edo', 'japan', 'sengoku', 'bushido'],
      category: 'history',
    },
    greek_history: {
      label: 'Greek History',
      glyph: '🏺',
      aliases: ['ancient-greece', 'athens', 'sparta', 'alexander'],
      category: 'history',
    },
    medieval_history: {
      label: 'Medieval History',
      glyph: '⚔️',
      aliases: ['middle-ages', 'knights', 'crusades'],
      category: 'history',
    },
    military_history: {
      label: 'Military History',
      glyph: '🪖',
      aliases: ['war-history', 'strategy'],
      category: 'history',
    },

    // ─── Mind ─────────────────────────────────────────────────────
    philosophy_stoic: {
      label: 'Stoic Philosophy',
      glyph: '🧘',
      aliases: ['stoicism', 'marcus-aurelius', 'seneca', 'epictetus'],
      category: 'mind',
    },
    chess: {
      label: 'Chess',
      glyph: '♟️',
      aliases: ['kasparov', 'fischer', 'magnus'],
      category: 'mind',
    },
    reading: {
      label: 'Reading',
      glyph: '📚',
      aliases: ['books', 'bookworm', 'literature'],
      category: 'mind',
    },

    // ─── Operations (admin-pro) ───────────────────────────────────
    admin_pro: {
      label: 'Operations / Admin',
      glyph: '⚙️',
      aliases: ['operations', 'management', 'drucker', 'deming', 'leadership'],
      category: 'work',
    },

    // ─── Movement ─────────────────────────────────────────────────
    cycling: {
      label: 'Cycling',
      glyph: '🚴',
      aliases: ['bike', 'tour-de-france', 'gravel'],
      category: 'movement',
    },
    running: {
      label: 'Running',
      glyph: '🏃',
      aliases: ['marathon', 'trail-running', '5k'],
      category: 'movement',
    },
    yoga: {
      label: 'Yoga',
      glyph: '🧘‍♀️',
      aliases: ['vinyasa', 'ashtanga'],
      category: 'movement',
    },

    // ─── Sound ────────────────────────────────────────────────────
    music_classical: {
      label: 'Classical Music',
      glyph: '🎻',
      aliases: ['classical', 'bach', 'beethoven', 'mozart'],
      category: 'sound',
    },
    music_jazz: {
      label: 'Jazz',
      glyph: '🎷',
      aliases: ['miles-davis', 'coltrane', 'bebop'],
      category: 'sound',
    },
    vinyl: {
      label: 'Vinyl Records',
      glyph: '💿',
      aliases: ['records', 'collector'],
      category: 'sound',
    },

    // ─── Things ───────────────────────────────────────────────────
    cars_classic: {
      label: 'Classic Cars',
      glyph: '🚗',
      aliases: ['vintage-cars', 'porsche', 'ferrari'],
      category: 'things',
    },
    watches: {
      label: 'Watches',
      glyph: '⌚',
      aliases: ['horology', 'rolex', 'timepieces'],
      category: 'things',
    },
    gardening: {
      label: 'Gardening',
      glyph: '🌿',
      aliases: ['garden', 'plants', 'bonsai'],
      category: 'things',
    },
    photography: {
      label: 'Photography',
      glyph: '📷',
      aliases: ['photo', 'leica', 'film-photo'],
      category: 'things',
    },
    woodworking: {
      label: 'Woodworking',
      glyph: '🪵',
      aliases: ['carpentry', 'craft'],
      category: 'things',
    },
  };

  // ─── KNOWLEDGE BASE ────────────────────────────────────────────────
  // For each interest, three pools: facts (verifiable trivia), quotes
  // (attributed to source), quips (Trajan's own voice — terse,
  // warm-dry observations that fit the persona).
  const KB = {

    // ════════════════════════════════════════════════════════════════
    // WINE — 30 entries
    // ════════════════════════════════════════════════════════════════
    wine: {
      facts: [
        "Burgundy was Charlemagne's favorite — there's a Grand Cru vineyard still named for him.",
        "Champagne can only be called Champagne if it's from the Champagne region in northeastern France.",
        "The oldest unopened bottle of wine on earth is the Speyer wine bottle, ~1,700 years old, found in a Roman tomb.",
        "Tannins come mostly from grape skins, seeds, and stems — and from oak barrels.",
        "Malolactic fermentation converts sharp malic acid into softer lactic acid; it's why Chardonnay can taste buttery.",
        "The shape of a wine glass changes how aromas are perceived — narrower for whites, wider for reds.",
        "The 1855 Bordeaux Classification of Médoc châteaux into five growths still holds today, with one promotion in 120+ years.",
        "Eiswein (ice wine) is harvested while grapes are still frozen on the vine — usually below -7°C.",
        "Pinot Noir is one of the oldest grape varieties cultivated for wine — Romans were drinking it 2,000 years ago.",
        "Sulfites in wine are mostly naturally occurring from fermentation; only a small amount is added as preservative.",
        "Phylloxera, a tiny aphid, destroyed most of Europe's vineyards in the 1860s-70s. Most European vines today are grafted onto American rootstock.",
        "Red wine gets its color from grape skins. White wine can be made from red grapes (e.g., Champagne uses Pinot Noir).",
        "The 'legs' on a wine glass are the Marangoni effect — alcohol evaporates faster than water, creating surface tension.",
        "Decanting works because oxygen breaks down sulfites and opens up aromas. Young tannic reds benefit most.",
        "Riesling can be bone dry or syrupy sweet — the same grape, the same region. The Mosel cellar tells the story.",
        "Sherry from Jerez ages under a layer of yeast called flor — gives it that nutty, briny character.",
        "Port wine got its strength from English merchants adding brandy mid-fermentation to survive the sea voyage.",
        "A magnum (1.5L) ages more slowly than a regular bottle because the wine-to-air ratio is more favorable.",
        "Most California wines list grape varietal; most French wines list the place. Same wine, different storytelling.",
        "The 'Judgment of Paris' in 1976 — California wines beat French wines blind. It rewrote the wine map.",
      ],
      quotes: [
        '"In water one sees one\'s own face; but in wine one beholds the heart of another." — French proverb',
        '"Wine is sunlight, held together by water." — Galileo Galilei',
        '"Age is just a number. It\'s irrelevant unless you happen to be a bottle of wine." — Joan Collins',
        '"Wine makes daily living easier, less hurried, with fewer tensions and more tolerance." — Benjamin Franklin',
        '"Either give me more wine or leave me alone." — Rumi',
        '"Wine is bottled poetry." — Robert Louis Stevenson',
        '"A meal without wine is like a day without sunshine." — Anthelme Brillat-Savarin',
      ],
      quips: [
        "wine doesn't keep secrets. that's its job.",
        "an open bottle has an opinion. pour it.",
        "the best wine is the one in front of you with someone you like.",
      ],
    },

    // ════════════════════════════════════════════════════════════════
    // JAPAN HISTORY — 28 entries (per Orion's request, deep dive)
    // ════════════════════════════════════════════════════════════════
    japan_history: {
      facts: [
        "The Edo period (1603-1868) was Japan's longest era of peace — 265 years without major civil war.",
        "Samurai weren't only warriors. During peace they were poets, scholars, and bureaucrats. Sword and brush.",
        "The Meiji Restoration in 1868 took Japan from feudal society to industrial power in about 25 years.",
        "Oda Nobunaga, Toyotomi Hideyoshi, and Tokugawa Ieyasu — Japan's 'Three Great Unifiers.' Nobunaga ground the rice, Hideyoshi shaped it, Ieyasu ate the cake.",
        "Tea ceremony was perfected by Sen no Rikyū in the 16th century. He died by his own hand after a disagreement with Hideyoshi.",
        "The shogun ruled from Edo (modern Tokyo); the emperor remained in Kyoto. Two capitals, one country.",
        "Bushidō — the way of the warrior — was codified during the relatively peaceful Edo period, looking back on a warring past.",
        "The katana's curve comes from differential hardening: the edge cools fast and hardens, the spine cools slow and stays flexible.",
        "Japan was largely closed to outsiders for over 200 years — sakoku, 1639 to 1853. Only Dutch and Chinese traders had limited access.",
        "Sengoku Jidai — the Warring States period — ran roughly 1467 to 1615. Every man for himself, with castles.",
        "The 47 rōnin in 1703: their lord was forced to commit seppuku; they waited a year then avenged him, then committed seppuku themselves. Still revered today.",
        "Miyamoto Musashi was undefeated in over 60 duels. He wrote The Book of Five Rings in a cave near the end of his life.",
        "Japanese castles are built without nails — interlocking joinery. Himeji Castle has survived earthquakes and bombs since 1333.",
        "Ukiyo-e ('pictures of the floating world') woodblock prints flourished in Edo. Hokusai and Hiroshige influenced Van Gogh and Monet.",
        "The samurai class was abolished by edict in 1876. Carrying swords in public became illegal that year.",
        "Kintsugi — repairing pottery with gold — turns breakage into beauty. The flaw becomes part of the history.",
        "The Tokugawa shogunate ranked samurai families into sankin-kōtai — alternating attendance in Edo to keep them broke and controlled.",
        "The longest reign in Japanese history was Emperor Hirohito (Showa) — 62 years (1926-1989).",
        "Commodore Perry's black ships forced Japan open in 1853. Within 15 years the shogunate fell.",
        "Mount Fuji last erupted in 1707. The Hōei eruption rained ash on Edo for days.",
      ],
      quotes: [
        '"Even if my head should be suddenly cut off, I should still be able to do one more action with certainty." — Miyamoto Musashi',
        '"The way of the samurai is found in death." — Yamamoto Tsunetomo, Hagakure',
        '"There is nothing outside of yourself that can enable you to get better, stronger, richer, quicker, or smarter." — Miyamoto Musashi',
        '"Fall seven times, stand up eight." — Japanese proverb (七転び八起き)',
        '"The bamboo that bends is stronger than the oak that resists." — Japanese proverb',
        '"Vision without action is a daydream. Action without vision is a nightmare." — Japanese proverb',
      ],
      quips: [
        "Musashi won 60 duels. wrote his book in a cave. cave guys are something else.",
        "the empire wasn't built in a day. neither was Edo.",
        "kintsugi makes the crack part of the bowl. worth thinking about.",
      ],
    },

    // ════════════════════════════════════════════════════════════════
    // ROMAN HISTORY — 25 entries (Trajan's home turf)
    // ════════════════════════════════════════════════════════════════
    roman_history: {
      facts: [
        "The Roman Empire at its peak under Trajan (117 CE) covered 5 million km² — biggest it would ever be.",
        "Trajan's Column in Rome documents the Dacian Wars in 155 carved scenes, climbing the spiral like a comic strip.",
        "Roman concrete used volcanic ash from Pozzuoli. Modern research shows it self-heals — gets stronger over centuries.",
        "The Pax Romana lasted about 200 years (27 BCE - 180 CE). Probably the longest period of relative peace in Western history.",
        "Latin survived as the language of science, law, and the church for 1,500 years after Rome's fall.",
        "Julius Caesar was never emperor — he was assassinated before that. Augustus, his grand-nephew, was Rome's first.",
        "Roman engineers built aqueducts that delivered water across hundreds of kilometers using only gravity. Some still flow.",
        "The Roman road network was over 400,000 km long. Some sections are still drivable today.",
        "Marcus Aurelius wrote his Meditations as a private journal — never intended for publication. Lucky us.",
        "Roman legions could march 30+ km a day in full armor, then build a fortified camp every night.",
        "The Colosseum's hypogeum had elevators and trapdoors. Spectators saw gladiators, animals, and scenery appear from below.",
        "Augustus was 18 when he started building the empire. He ruled for 41 years.",
        "Roman bath culture — caldarium, tepidarium, frigidarium — wasn't just hygiene. It was where business got done.",
        "The Roman calendar gave us July (Julius) and August (Augustus). Every emperor wanted a month; only those two stuck.",
        "Latin 'salarium' meant a soldier's salt allowance — origin of the word 'salary.'",
        "Hadrian's Wall in northern England wasn't really to keep barbarians out. It was a customs and surveillance line.",
        "Constantine moved the empire's capital to Byzantium in 330 CE. He renamed it after himself; it's why we call it Constantinople.",
        "The fall of Rome wasn't one event. The Western Empire fell in 476 CE; the Eastern (Byzantine) lasted until 1453.",
        "Emperor Trajan was born in Hispania — first emperor born outside Italy. The empire was already cosmopolitan.",
        "Cicero, Cato, Caesar, Cleopatra — they all knew each other personally. Late Republic Rome was a small social circle.",
      ],
      quotes: [
        '"I came, I saw, I conquered." — Julius Caesar',
        '"What we do now echoes in eternity." — Marcus Aurelius',
        '"The empire long divided must unite." — (often attributed to Rome via Sun Tzu — careful, but it captures the rhythm)',
        '"If you want to be loved, love." — Seneca',
        '"He who fears death will never do anything worthy of a man in life." — Seneca',
        '"Festina lente — make haste slowly." — Augustus (his personal motto)',
        '"Memento mori — remember you must die." — Stoic refrain, kept whispered to victorious generals',
        '"You have power over your mind, not outside events. Realize this and you will find strength." — Marcus Aurelius',
      ],
      quips: [
        "the empire wasn't built in a day. don't try to fix everything tonight.",
        "Augustus took 41 years. you have today.",
        "Marcus wrote his journal at night, by candle, while running an empire. perspective.",
      ],
    },

    // ════════════════════════════════════════════════════════════════
    // ADMIN / OPERATIONS — 22 entries
    // ════════════════════════════════════════════════════════════════
    admin_pro: {
      facts: [
        "Peter Drucker coined the term 'knowledge worker' in 1959 — sixty years before remote work became normal.",
        "W. Edwards Deming taught Toyota the production methods that became the Toyota Production System. Quality came from a statistician.",
        "Eisenhower's matrix — urgent vs important — predates productivity software by 50 years.",
        "Andy Grove's 'OKRs' at Intel became Google's operating system. John Doerr brought them over.",
        "The Pareto principle (80/20) was named for the Italian economist who noticed 80% of Italy's land was owned by 20% of people.",
        "Parkinson's Law: work expands to fill the time available. The fix is constraints, not effort.",
        "Pixar runs 'braintrust' meetings — peer-led, candid, no hierarchy in the room. Catmull says it's their best practice.",
        "The 'two-pizza team' rule (Bezos): a team shouldn't be larger than two pizzas can feed. ~6-8 people.",
        "Hofstadter's Law: it always takes longer than you expect, even when you take Hofstadter's Law into account.",
        "Deming's 14 Points end with this: 'It's not enough to do your best. You must know what to do, then do your best.'",
      ],
      quotes: [
        '"Plans are nothing; planning is everything." — Dwight D. Eisenhower',
        '"What gets measured gets managed." — Peter Drucker',
        '"It is not enough to do your best; you must know what to do, then do your best." — W. Edwards Deming',
        '"The best way to predict the future is to create it." — Peter Drucker',
        '"Excellence is an art won by training and habituation." — Aristotle',
        '"Discipline equals freedom." — Jocko Willink',
        '"Slow is smooth, smooth is fast." — Navy SEAL maxim',
        '"Culture eats strategy for breakfast." — Peter Drucker (commonly attributed)',
        '"Make it work, make it right, make it fast — in that order." — Kent Beck',
        '"The single most important thing you can do is to have the courage to make a decision." — Andy Grove',
        '"If you can\'t describe what you are doing as a process, you don\'t know what you\'re doing." — W. Edwards Deming',
        '"Hire slow, fire fast." — Reid Hoffman',
      ],
      quips: [
        "one decision at a time, in order. the rest waits.",
        "if it's worth doing twice it's worth automating once.",
        "the to-do list is a snapshot. you're not behind. you're in motion.",
      ],
    },

    // ════════════════════════════════════════════════════════════════
    // BOURBON / WHISKEY — 18 entries
    // ════════════════════════════════════════════════════════════════
    bourbon: {
      facts: [
        "Bourbon must be made in the USA, with at least 51% corn, aged in new charred oak barrels.",
        "Scotch must be aged at least 3 years; bourbon has no minimum age (though 'straight bourbon' requires 2+).",
        "The 'angel's share' — whiskey lost to evaporation during aging — is about 2% per year in Kentucky's humid heat.",
        "Tennessee whiskey requires the Lincoln County Process: charcoal filtering before aging. Jack Daniel's signature step.",
        "Mash bill = the grain recipe. Most bourbons are 70-80% corn, with rye or wheat for the flavor backbone.",
        "Wheated bourbons (Pappy Van Winkle, Maker's Mark) use wheat as the secondary grain — softer, sweeter.",
        "High-rye bourbons (Bulleit, Four Roses Single Barrel) have more spice and pepper character.",
        "Scotch whisky regions — Highland, Speyside, Islay, Lowland, Campbeltown — each have distinct character. Islay = peat.",
        "Single malt = one distillery, malted barley only. Blended = malt + grain whisky from multiple distilleries.",
        "Japanese whisky borrowed Scottish methods. Masataka Taketsuru studied in Scotland, came home, started Nikka.",
        "The 'finger of whiskey' as a measurement isn't standardized. A finger is roughly 1.5 oz on most glassware.",
        "Rye whiskey was America's whiskey before prohibition. Bourbon dominated after; rye is making a comeback.",
        "A whiskey 'expression' = a particular bottling/cask/release. The Macallan 18 is one expression of Macallan.",
      ],
      quotes: [
        '"Too much of anything is bad, but too much good whiskey is barely enough." — Mark Twain',
        '"The light music of whiskey falling into glasses made an agreeable interlude." — James Joyce',
        '"There is no bad whiskey. There are only some whiskeys that aren\'t as good as others." — Raymond Chandler',
      ],
      quips: [
        "two fingers of bourbon and a long view. that's a Tuesday.",
        "a charred oak barrel turns corn into time.",
      ],
    },

    // ════════════════════════════════════════════════════════════════
    // COFFEE — 16 entries
    // ════════════════════════════════════════════════════════════════
    coffee: {
      facts: [
        "Espresso isn't a roast — it's a brewing method. Any bean can be 'espresso.'",
        "The crema on espresso is emulsified CO2 and oils, formed under 9 bars of pressure.",
        "Coffee 'beans' are seeds of a cherry-like fruit. The fruit is sometimes used too — cascara tea.",
        "Arabica is ~60-70% of world production; Robusta is the rest. Robusta has more caffeine but rougher flavor.",
        "Optimal extraction temperature is 195-205°F. Below that → sour. Above → bitter.",
        "Coffee tastes most balanced with a 1:16 brew ratio (1 gram coffee : 16 grams water) for most pour-over methods.",
        "Cold brew isn't iced coffee — it's coffee steeped in cold water 12-24 hours. Lower acidity, sweeter, smoother.",
        "The world's most expensive coffee, Kopi Luwak, is harvested from civet droppings. The processing happens in the animal's gut.",
        "Italian espresso bars are mostly stand-up — sit-down service costs extra. Quick shot, then back to work.",
        "Coffee was banned in Mecca in 1511 because clerics worried it stimulated radical thinking. Spoiler: it does.",
        "The world's first webcam (1991) was pointed at a coffee pot at Cambridge. Distance-monitoring of caffeine availability.",
        "A standard espresso shot is 25-30ml extracted over 25-30 seconds. Beyond 30s, you're overextracting.",
      ],
      quotes: [
        '"I never drink coffee at lunch. I find it keeps me awake for the afternoon." — Ronald Reagan',
        '"Coffee is a way of stealing time that should by rights belong to your older self." — Terry Pratchett',
        '"As long as there was coffee in the world, how bad could things be?" — Cassandra Clare',
      ],
      quips: [
        "the morning starts when the kettle does.",
        "good coffee is patience plus 9 bars of pressure.",
      ],
    },

    // ════════════════════════════════════════════════════════════════
    // TEA — 12 entries
    // ════════════════════════════════════════════════════════════════
    tea: {
      facts: [
        "All tea — black, green, white, oolong, pu-erh — comes from the same plant: Camellia sinensis. The processing differs.",
        "Matcha is whole tea leaf powder, not steeped — you drink the leaf. That's why the caffeine + L-theanine hit is different.",
        "Japanese tea ceremony (chadō) takes years to master. The host's every movement is choreographed.",
        "Pu-erh from Yunnan is the only tea that improves with age. Some bricks are aged decades.",
        "British 'high tea' is a hearty evening meal. 'Afternoon tea' is the fancy little-sandwiches one. Americans usually mix them up.",
        "Earl Grey is black tea flavored with bergamot oil. Named for the 19th-century British prime minister, though the story's hazy.",
        "Green tea is fired or steamed to stop oxidation. Black tea is fully oxidized. The leaves are the same.",
        "Sencha is the everyday Japanese green tea — ~80% of Japan's production. Brewed below boiling, never long.",
      ],
      quotes: [
        '"Tea is a moment of pause in a busy world." — Japanese saying',
        '"Each cup of tea represents an imaginary voyage." — Catherine Douzel',
        '"Where there is tea, there is hope." — Arthur Wing Pinero',
      ],
      quips: [
        "tea slows the clock. that's the trick.",
      ],
    },

    // ════════════════════════════════════════════════════════════════
    // BBQ — 14 entries (Texas-focused since Austin)
    // ════════════════════════════════════════════════════════════════
    bbq: {
      facts: [
        "Central Texas BBQ uses post oak as the traditional wood. Mild smoke, no overpowering flavor.",
        "Brisket smoked low and slow takes 12-16 hours. The 'stall' around 165°F internal temp can last hours — moisture evaporating cools the meat.",
        "Salt and pepper only — that's the Central Texas tradition. Sometimes called 'Dalmatian rub.'",
        "Franklin Barbecue in Austin opens at 11am. People used to line up at 7am. He sold the joint to staff before slowing down.",
        "The 'bark' on brisket is the crust formed by smoke, spice, fat, and the Maillard reaction. The whole point.",
        "Texas BBQ traditions: Central (post oak, beef), East (sauce-heavy, pork), South (cabrito/goat), West (mesquite).",
        "Kansas City BBQ is sauce-forward; Memphis is dry-rub pork ribs; Carolina is pulled pork with vinegar (or mustard) sauce.",
        "Brisket has two muscles: the flat (lean) and the point (fatty). Together they're a 'packer brisket.' Most pros separate them.",
        "The internal temperature for done brisket isn't a number — it's tenderness. A probe slides in like room-temp butter, ~203°F.",
        "Smoking takes patience. There's a saying: 'it's done when it's done.' Time is a guideline, not a rule.",
      ],
      quotes: [
        '"You can\'t rush good barbecue." — Aaron Franklin',
        '"Anyone who tells you barbecue isn\'t worth waiting in line for is lying or lazy." — Anthony Bourdain',
      ],
      quips: [
        "12 hours of smoke and one bite tells the whole story.",
        "post oak doesn't shout. that's why it works.",
        "patience and pepper. that's most of the recipe.",
      ],
    },

    // ════════════════════════════════════════════════════════════════
    // COOKING — 12 entries
    // ════════════════════════════════════════════════════════════════
    cooking: {
      facts: [
        "The Maillard reaction — what makes seared meat brown — happens above ~280°F. Below that, you're steaming.",
        "Salt in pasta water should taste like the sea. About 1 tablespoon per quart. Pasta cooked in fresh water tastes flat.",
        "Resting meat after cooking lets juices redistribute. Cut too early and they pour onto the cutting board.",
        "Mise en place — 'everything in its place' — is half of professional cooking. Prep first, cook second.",
        "Acid (lemon, vinegar) brightens almost everything. Most home dishes are under-acidic.",
        "A knife's edge dulls from being misused, not from being used. Cutting boards matter. Use wood or plastic, not stone or glass.",
        "Carryover cooking continues for 5-10 minutes after meat leaves the heat. Pull it 5°F early.",
        "Caramelization (sugar browning) and Maillard (proteins) are different reactions. Both deepen flavor.",
        "Béchamel + cheese = Mornay. Béchamel is the mother sauce, Mornay the variation. French sauce architecture.",
        "Salting in stages — onion, then meat, then sauce — develops layers. Salt at the end alone is flat.",
      ],
      quotes: [
        '"To cook well one must love and respect food." — Julia Child',
        '"The only real stumbling block is fear of failure. In cooking you\'ve got to have a what-the-hell attitude." — Julia Child',
        '"Cooking is the most ancient of arts." — Auguste Escoffier',
        '"Tell me what you eat, and I\'ll tell you what you are." — Brillat-Savarin',
      ],
      quips: [
        "salt earlier than you think. acid later than you think.",
        "the recipe is a map, not the road.",
      ],
    },

    // ════════════════════════════════════════════════════════════════
    // STOIC PHILOSOPHY — 18 entries
    // ════════════════════════════════════════════════════════════════
    philosophy_stoic: {
      facts: [
        "The Big Three Roman Stoics: Seneca (statesman), Epictetus (slave-turned-teacher), Marcus Aurelius (emperor).",
        "Stoicism started in Athens around 300 BCE with Zeno of Citium. The name comes from the stoa (porch) where he taught.",
        "Marcus Aurelius wrote Meditations as a private journal — never meant for anyone to read.",
        "Epictetus was born a slave, became one of the most influential philosophers in history, walked with a limp from being beaten.",
        "The 'dichotomy of control' is the central Stoic idea: some things are in our control (judgment, action), some aren't (other people, weather, fortune).",
        "Memento mori — remember you will die — wasn't morbid to Stoics. It was clarifying.",
        "Premeditatio malorum — premeditating misfortune — is the practice of imagining loss to appreciate what you have.",
        "Seneca tutored Nero. It didn't go well. Nero eventually ordered him to commit suicide.",
        "Modern CBT (cognitive behavioral therapy) borrows heavily from Stoicism — Albert Ellis explicitly credited Epictetus.",
      ],
      quotes: [
        '"You have power over your mind — not outside events. Realize this, and you will find strength." — Marcus Aurelius',
        '"It is not what happens to you, but how you react that matters." — Epictetus',
        '"We suffer more often in imagination than in reality." — Seneca',
        '"Waste no more time arguing what a good man should be. Be one." — Marcus Aurelius',
        '"He who fears death will never do anything worthy of a man in life." — Seneca',
        '"Wealth consists not in having great possessions, but in having few wants." — Epictetus',
        '"The happiness of your life depends upon the quality of your thoughts." — Marcus Aurelius',
        '"Difficulties strengthen the mind, as labor does the body." — Seneca',
      ],
      quips: [
        "control what's yours. the rest is weather.",
        "you'll dread the thing more than you'll live it.",
        "the obstacle is the way — not a slogan. it's geometry.",
      ],
    },

    // ════════════════════════════════════════════════════════════════
    // GREEK HISTORY — 12 entries
    // ════════════════════════════════════════════════════════════════
    greek_history: {
      facts: [
        "Athenian democracy gave votes to ~10-20% of the population — free men born in Athens. Women, slaves, foreigners: excluded.",
        "Sparta's full-citizen population was tiny — maybe 8-10,000 Spartiates ruling helots who outnumbered them ten to one.",
        "Alexander the Great never lost a battle. By 30 he ruled from Greece to India. By 32 he was dead.",
        "The Battle of Thermopylae (480 BCE): 300 Spartans plus several thousand other Greeks held a pass for three days against the Persian army.",
        "The Parthenon was built in 9 years (447-438 BCE). It survived 2,000 years until a Venetian shell hit Ottoman gunpowder stored inside in 1687.",
        "Pythagoras founded a religious cult. The mathematical theorem named after him was almost certainly discovered earlier elsewhere.",
        "Olympic Games started in 776 BCE. Athletes competed naked. Married women weren't allowed to watch.",
        "Greek fire — a Byzantine incendiary weapon — burned even on water. The recipe was lost to history.",
        "Socrates wrote nothing. Everything we know about him comes from Plato and Xenophon, who knew him.",
      ],
      quotes: [
        '"The unexamined life is not worth living." — Socrates',
        '"The whole is greater than the sum of its parts." — Aristotle',
        '"Know thyself." — inscribed at the Temple of Apollo, Delphi',
        '"Nothing in excess." — second Delphic maxim',
        '"There is nothing permanent except change." — Heraclitus',
      ],
      quips: [
        "the Greeks knew: know yourself. then act.",
      ],
    },

    // ════════════════════════════════════════════════════════════════
    // CHESS — 12 entries
    // ════════════════════════════════════════════════════════════════
    chess: {
      facts: [
        "Chess as we know it crystallized in Europe around 1475 — the queen and bishop got their modern long-range moves.",
        "The number of possible chess games exceeds the number of atoms in the observable universe.",
        "Garry Kasparov was world champion for 15 years (1985-2000). Magnus Carlsen reigned from 2013 to 2023, then declined to defend.",
        "AlphaZero learned chess from scratch in 4 hours and beat the strongest engine of its day.",
        "The 'Immortal Game' (1851, Anderssen vs Kieseritzky) is taught to this day. Anderssen sacrificed everything — queen, both rooks, a bishop — and won.",
        "Bobby Fischer beat Boris Spassky in 1972, breaking 24 years of Soviet dominance. Cold War on a board.",
        "Chess clocks were introduced in 1883. Before that, players could think as long as they wanted. Games sometimes lasted days.",
      ],
      quotes: [
        '"Chess is life in miniature. Chess is a struggle, chess is battles." — Garry Kasparov',
        '"Every chess master was once a beginner." — Irving Chernev',
        '"When you see a good move, look for a better one." — Emanuel Lasker',
      ],
      quips: [
        "think three moves ahead. all of life works like that.",
      ],
    },

    // ════════════════════════════════════════════════════════════════
    // READING — 10 entries
    // ════════════════════════════════════════════════════════════════
    reading: {
      facts: [
        "The average person reads ~250 words per minute. Speed-readers claim 1,000+ but comprehension drops sharply past 400.",
        "The Library of Alexandria, before it was destroyed, may have held 400,000 to 700,000 scrolls. We lost most of what humanity wrote.",
        "Bookshelves arranged by color look pretty but make finding anything impossible. Stoics would not approve.",
        "Stefan Zweig's collection ran to 30,000 books. He's not even the record. Umberto Eco kept ~30,000 too — said his unread books were the important ones.",
      ],
      quotes: [
        '"A reader lives a thousand lives before he dies. The man who never reads lives only one." — George R.R. Martin',
        '"I have always imagined that Paradise will be a kind of library." — Jorge Luis Borges',
        '"There is no friend as loyal as a book." — Ernest Hemingway',
        '"The man who does not read has no advantage over the man who cannot read." — Mark Twain',
      ],
      quips: [
        "a book is a portable mind.",
      ],
    },

    // ════════════════════════════════════════════════════════════════
    // RUNNING — 10 entries
    // ════════════════════════════════════════════════════════════════
    running: {
      facts: [
        "The marathon distance — 26.2 miles / 42.195 km — was set at the 1908 London Olympics. The legend of Pheidippides is older but unrelated to the distance.",
        "Humans are persistence hunters by evolution. Few animals can keep running through midday heat the way we can.",
        "Eliud Kipchoge ran the first sub-2-hour marathon in 2019 (not an official race — ineligible for the world record, but it happened).",
        "Heart rate zones: Zone 2 (60-70% of max) is the metabolic-building sweet spot. Most runs should be slow.",
        "Couch-to-5K plans work because they build mileage slowly enough that tendons and bones can adapt. Most injuries come from too much, too soon.",
      ],
      quotes: [
        '"It does not matter how slowly you go as long as you do not stop." — Confucius',
        '"Running is the greatest metaphor for life, because you get out of it what you put into it." — Oprah Winfrey',
        '"Pain is inevitable. Suffering is optional." — Haruki Murakami',
      ],
      quips: [
        "the first mile is always a liar.",
      ],
    },

    // ════════════════════════════════════════════════════════════════
    // CYCLING — 10 entries
    // ════════════════════════════════════════════════════════════════
    cycling: {
      facts: [
        "The Tour de France was started in 1903 as a stunt to sell newspapers. It worked.",
        "A modern peloton can save up to 40% of energy by drafting compared to riding alone in the wind.",
        "Eddy Merckx is widely considered the greatest cyclist ever — won every major race multiple times.",
        "Bicycles are the most energy-efficient form of human transport ever invented. More efficient than walking, swimming, or running.",
      ],
      quotes: [
        '"It never gets easier, you just go faster." — Greg LeMond',
        '"Life is like riding a bicycle. To keep your balance, you must keep moving." — Albert Einstein',
      ],
      quips: [
        "two wheels and silence. that's the whole sport.",
      ],
    },

    // ════════════════════════════════════════════════════════════════
    // CLASSICAL MUSIC — 12 entries
    // ════════════════════════════════════════════════════════════════
    music_classical: {
      facts: [
        "Bach was largely forgotten for decades after his death. Mendelssohn rescued him with the 1829 performance of the St. Matthew Passion.",
        "Mozart wrote ~600 works in 35 years. He started composing at five.",
        "Beethoven went deaf gradually. He composed the Ninth Symphony unable to hear it. He conducted the premiere but couldn't hear the applause.",
        "Stradivarius violins (1700s) are still the gold standard. Modern science can't fully explain why.",
        "A symphony orchestra has ~80-100 musicians. The conductor controls them with gestures alone — a silent choreographer.",
      ],
      quotes: [
        '"Music gives a soul to the universe, wings to the mind, flight to the imagination." — Plato',
        '"Without music, life would be a mistake." — Friedrich Nietzsche',
        '"Music is the silence between the notes." — Claude Debussy',
      ],
      quips: [
        "Bach was forgotten for 80 years. so was a lot of good work.",
      ],
    },

    // ════════════════════════════════════════════════════════════════
    // JAZZ — 10 entries
    // ════════════════════════════════════════════════════════════════
    music_jazz: {
      facts: [
        "Miles Davis's Kind of Blue (1959) is the best-selling jazz album of all time. He recorded it in two sessions, mostly first takes.",
        "John Coltrane practiced 12+ hours a day for years. Genius is sometimes just terrifying work ethic.",
        "Bebop in the 1940s (Parker, Gillespie) was a musicians' rebellion against swing — too fast and complex to dance to.",
        "Cool jazz emerged on the West Coast in the late 1940s as a reaction to bebop's intensity. Same musicians, calmer mood.",
      ],
      quotes: [
        '"Don\'t play what\'s there. Play what\'s not there." — Miles Davis',
        '"Music is a higher revelation than all wisdom and philosophy." — Ludwig van Beethoven',
        '"In jazz, you go for it, you go for the moment." — Sonny Rollins',
      ],
      quips: [
        "jazz is what happens between the notes.",
      ],
    },

    // ════════════════════════════════════════════════════════════════
    // CARS_CLASSIC — 10 entries
    // ════════════════════════════════════════════════════════════════
    cars_classic: {
      facts: [
        "The Porsche 911 has kept its rear-engine layout since 1963 — everyone said it was wrong; they kept it anyway.",
        "Enzo Ferrari only made road cars to fund his racing team. Road cars were the side gig.",
        "The Jaguar E-Type, when launched in 1961, was the fastest production car in the world. Enzo Ferrari called it the most beautiful car ever made.",
        "Toyota's 2000GT (1967-70) is the only Toyota that Sean Connery drove as Bond. Only 351 were made.",
        "The Citroën DS, launched in 1955, was so advanced it had hydraulic self-leveling suspension. People thought it was a UFO.",
      ],
      quotes: [
        '"The car is the closest thing we will ever create to something that is alive." — Sir William Lyons (Jaguar founder)',
        '"I have always thought of the Porsche 911 as a living thing." — Patrick Long',
      ],
      quips: [
        "a good car wears its decades well.",
      ],
    },

    // ════════════════════════════════════════════════════════════════
    // Other lighter categories — short pools
    // ════════════════════════════════════════════════════════════════
    cocktails: {
      facts: [
        "The Old Fashioned predates the cocktail glass — it's literally how the word 'cocktail' was first defined in 1806.",
        "The Martini went from sweet to bone-dry over a century. Original 1880s recipes used equal parts gin and sweet vermouth.",
        "Tiki cocktails (Mai Tai, Zombie) come from California in the 1930s — Don Beach and Trader Vic invented an entire genre.",
      ],
      quotes: [
        '"I drink to make other people more interesting." — Ernest Hemingway',
        '"One martini is alright, two is too many, three is not enough." — James Thurber',
      ],
      quips: [
        "a good cocktail has three ingredients and one purpose.",
      ],
    },
    pizza: {
      facts: [
        "Pizza Margherita was created in Naples in 1889 for Queen Margherita — tomato, mozzarella, basil = Italian flag.",
        "Neapolitan pizza is officially regulated. Real Pizza Napoletana cooks in 60-90 seconds at 905°F.",
        "New York-style pizza only existed once pizzerias hit America in the early 1900s — Lombardi's in 1905 was the first.",
      ],
      quotes: [
        '"Pizza makes anything possible." — Henry Rollins',
      ],
      quips: [
        "pizza is geometry plus joy.",
      ],
    },
    sushi: {
      facts: [
        "Nigiri sushi was invented in Edo (Tokyo) in the early 1800s as fast food — a snack for busy workers.",
        "The fish in sushi is graded by sushi-ya themselves. The best tuna goes through the Toyosu Market in Tokyo before dawn.",
        "Wasabi outside Japan is almost always horseradish dyed green. Real wasabi is rare and expensive — grated fresh from rhizome.",
      ],
      quotes: [
        '"Once you decide on your occupation, you must immerse yourself in your work." — Jiro Ono',
      ],
      quips: [
        "Jiro is in his 90s and still going. mastery has no finish line.",
      ],
    },
    medieval_history: {
      facts: [
        "The 'Dark Ages' wasn't really dark. Charlemagne, Islamic Spain, and Byzantine were thriving while Western Europe rebuilt.",
        "Medieval knights took ~$3-5 million in modern money to fully equip. They were the F-22 of their day.",
        "The Black Death (1347-1352) killed 30-60% of Europe's population. Took 200 years for populations to recover.",
        "Castles were defensive, but more importantly they were tax collection points. Lord controls the road = lord controls the tolls.",
      ],
      quotes: [
        '"Honor is the gift a man gives himself." — Medieval Spanish proverb',
      ],
      quips: [
        "castles weren't fortresses first. they were tollbooths.",
      ],
    },
    military_history: {
      facts: [
        "Sun Tzu's Art of War is ~2,500 years old and still on military reading lists.",
        "Napoleon's Grande Armée at peak: ~700,000 men. After Russia: 27,000.",
        "World War I ended on 11/11/1918 at 11:00. The war that 'ended all wars' didn't.",
      ],
      quotes: [
        '"Know yourself, know your enemy. A thousand battles, a thousand victories." — Sun Tzu',
        '"In preparing for battle I have always found that plans are useless, but planning is indispensable." — Eisenhower',
        '"No battle plan survives contact with the enemy." — Helmuth von Moltke',
      ],
      quips: [
        "Sun Tzu: know yourself first. that's most of it.",
      ],
    },
    yoga: {
      facts: [
        "Modern yoga as exercise — Hatha-derived posture flow — is barely 100 years old. Older yoga was mostly meditation and breath.",
        "Patanjali's Yoga Sutras (~2nd century BCE) describe the 'eight limbs' of yoga. Postures are just one limb of eight.",
      ],
      quotes: [
        '"Yoga is the journey of the self, through the self, to the self." — Bhagavad Gita',
      ],
      quips: [
        "the breath is the lever. that's the whole thing.",
      ],
    },
    vinyl: {
      facts: [
        "Vinyl LPs were introduced in 1948. They were displaced by CDs in the 1980s. They came back. They're not going anywhere.",
        "The groove on a record is a continuous spiral about 500 meters long on one side of an LP.",
      ],
      quotes: [
        '"Vinyl just has a soul. The pops, the crackles — it\'s the medium being alive." — Jack White',
      ],
      quips: [
        "needle drop, deep breath, side A.",
      ],
    },
    watches: {
      facts: [
        "A mechanical watch has ~130 parts. The escapement — the heart — ticks ~28,800 times per hour in a modern movement.",
        "The Rolex Submariner debuted in 1953. Mostly the same design 70 years later.",
        "Quartz watches (1969 onward) are technically more accurate than mechanical. People buy mechanical because mechanical is alive.",
      ],
      quotes: [
        '"A watch is something you wear. A timepiece is something you collect." — anon',
      ],
      quips: [
        "mechanical watches are accurate enough. they're not really about time.",
      ],
    },
    gardening: {
      facts: [
        "A handful of healthy soil contains more microorganisms than there are humans on Earth.",
        "Companion planting works: basil near tomatoes really does help. Plants communicate via volatile chemicals.",
        "Bonsai isn't a species of tree — it's a technique. Any tree can be bonsai with patience and the right pot.",
      ],
      quotes: [
        '"To plant a garden is to believe in tomorrow." — Audrey Hepburn',
      ],
      quips: [
        "gardens teach the long view.",
      ],
    },
    photography: {
      facts: [
        "Henri Cartier-Bresson coined the 'decisive moment' — that fraction of a second when geometry and meaning align.",
        "Leica's M-series rangefinders have looked nearly identical since 1954. Working photographers prefer it that way.",
        "Ansel Adams's Zone System (1939) is still how working photographers think about exposure — divide tonal range into 11 zones.",
      ],
      quotes: [
        '"The decisive moment is the instant when all elements come together to form a meaningful image." — Henri Cartier-Bresson',
        '"You don\'t take a photograph, you make it." — Ansel Adams',
      ],
      quips: [
        "the photo is made before the shutter clicks.",
      ],
    },
    woodworking: {
      facts: [
        "A Japanese pull saw cuts on the pull stroke; Western saws cut on push. Pull gives thinner kerfs and more control.",
        "Hide glue (animal-based, dates to ancient Egypt) is reversible with heat and water. Antique restorers love it.",
        "The Stradivari workshop used spruce for tops and maple for backs. Modern luthiers haven't found a better combo in 300 years.",
      ],
      quotes: [
        '"Measure twice, cut once." — woodworking proverb',
      ],
      quips: [
        "the wood was here before you. it has opinions.",
      ],
    },
  };

  // ─── ALIAS RESOLUTION ──────────────────────────────────────────────
  // Build a reverse map: alias string → canonical key.
  const ALIAS_TO_KEY = {};
  for (const key in CATALOG) {
    ALIAS_TO_KEY[key] = key;
    const aliases = CATALOG[key].aliases || [];
    for (const a of aliases) {
      ALIAS_TO_KEY[a.toLowerCase()] = key;
    }
  }
  function canonicalize(input) {
    if (!input) return null;
    const k = String(input).trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
    if (CATALOG[k]) return k;
    // Try alias
    const alias = ALIAS_TO_KEY[String(input).trim().toLowerCase()];
    return alias || null;
  }

  // ─── QUERY API ─────────────────────────────────────────────────────
  function listAll() {
    return Object.keys(CATALOG).map(key => ({
      key, label: CATALOG[key].label, glyph: CATALOG[key].glyph,
      category: CATALOG[key].category,
    }));
  }
  function listByCategory() {
    const groups = {};
    for (const key in CATALOG) {
      const cat = CATALOG[key].category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push({ key, label: CATALOG[key].label, glyph: CATALOG[key].glyph });
    }
    return groups;
  }
  function labelFor(key) {
    const k = canonicalize(key);
    return k ? CATALOG[k].label : key;
  }
  function glyphFor(key) {
    const k = canonicalize(key);
    return k ? CATALOG[k].glyph : '✦';
  }
  function knowledgeFor(key) {
    const k = canonicalize(key);
    return (k && KB[k]) || null;
  }
  function pickFact(key) { return _pick(knowledgeFor(key)?.facts); }
  function pickQuote(key) { return _pick(knowledgeFor(key)?.quotes); }
  function pickQuip(key) { return _pick(knowledgeFor(key)?.quips); }
  function _pick(arr) {
    if (!arr || !arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ─── USER-CENTRIC PICKERS ──────────────────────────────────────────
  // Given the user's interest list, return a random piece of content.
  // Weighted: admin-assigned interests are weight 1.0; learned ones
  // can be passed in with their own weights.
  function pickForUser(user, kind) {
    if (!user) return null;
    const all = collectUserInterests(user);
    if (!all.length) return null;
    // Weighted random selection
    const total = all.reduce((s, x) => s + x.weight, 0);
    let r = Math.random() * total;
    let pick = all[0];
    for (const item of all) {
      r -= item.weight;
      if (r <= 0) { pick = item; break; }
    }
    if (kind === 'fact')  return pickFact(pick.key);
    if (kind === 'quote') return pickQuote(pick.key);
    if (kind === 'quip')  return pickQuip(pick.key);
    // Default: pick from any of fact/quote/quip
    const order = ['fact', 'quote', 'quip'];
    for (let i = 0; i < 3; i++) {
      const k = order[Math.floor(Math.random() * 3)];
      const text = (k === 'fact') ? pickFact(pick.key)
                 : (k === 'quote') ? pickQuote(pick.key)
                 : pickQuip(pick.key);
      if (text) return { kind: k, text, interest: pick.key, label: labelFor(pick.key), glyph: glyphFor(pick.key) };
    }
    return null;
  }

  // Returns [{key, weight, source}] for all of a user's interests
  // (admin-assigned + inferred).
  function collectUserInterests(user) {
    if (!user) return [];
    const out = [];
    // Admin-assigned (weight 1.0)
    const interests = Array.isArray(user.interests) ? user.interests : [];
    for (const raw of interests) {
      const k = canonicalize(raw);
      if (!k) continue;
      out.push({ key: k, weight: 1.0, source: 'admin' });
    }
    // Inferred (weight from the inferred record, max 0.7 to keep admin priority)
    const inf = user.inferred_interests || {};
    for (const raw in inf) {
      const k = canonicalize(raw);
      if (!k) continue;
      // Skip if already in admin list
      if (out.some(o => o.key === k)) continue;
      const weight = Math.min(0.7, (inf[raw].weight || 0));
      if (weight > 0.2) {
        out.push({ key: k, weight, source: 'inferred' });
      }
    }
    return out;
  }

  // ─── LEARNING API ─────────────────────────────────────────────────
  // habits.js calls this when it sees a signal that suggests an
  // interest. The RPC merges evidence + recomputes weight server-side.
  async function recordSignal(userId, interestKey, evidenceInc) {
    if (!userId || !interestKey || !NX.sb) return;
    const canon = canonicalize(interestKey);
    if (!canon) return;
    try {
      await NX.sb.rpc('add_inferred_interest', {
        p_id: userId,
        p_key: canon,
        p_evidence_inc: evidenceInc || 1,
      });
    } catch (e) {
      console.warn('[interests] recordSignal failed (RPC may be missing):', e?.message || e);
    }
  }

  // ─── ADMIN PERSISTENCE ────────────────────────────────────────────
  async function setUserInterests(userId, interestArray) {
    if (!userId || !NX.sb) return false;
    const cleaned = Array.from(new Set(
      (interestArray || []).map(canonicalize).filter(Boolean)
    ));
    try {
      // Try RPC first (security definer, preferred under Phase B lockdown)
      const { error: rpcErr } = await NX.sb.rpc('set_user_interests', {
        p_id: userId, p_interests: cleaned,
      });
      if (!rpcErr) return true;
      // Fallback: direct update (works if RLS permits)
      const { error: updErr } = await NX.sb.from('nexus_users')
        .update({ interests: cleaned }).eq('id', userId);
      return !updErr;
    } catch (e) {
      console.warn('[interests] setUserInterests failed:', e?.message || e);
      return false;
    }
  }

  // ─── PUBLIC API ───────────────────────────────────────────────────
  NX.interests = {
    listAll,
    listByCategory,
    labelFor,
    glyphFor,
    canonicalize,
    knowledgeFor,
    pickFact, pickQuote, pickQuip,
    pickForUser,
    collectUserInterests,
    recordSignal,
    setUserInterests,
  };

  console.log('[interests] v18.9 ready — ' + Object.keys(CATALOG).length
    + ' interests catalogued, ' + Object.keys(KB).length + ' with knowledge.');
})();
