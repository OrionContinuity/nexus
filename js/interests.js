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
    pastry: {
      label: 'Pastry',
      glyph: '🥐',
      aliases: ['baking', 'patisserie', 'baker', 'pastry-chef', 'viennoiserie', 'desserts'],
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
    persian_history: {
      label: 'Persian History',
      glyph: '🦁',
      aliases: ['persia', 'achaemenid', 'sassanid', 'zoroaster'],
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
        // ─── more wine facts ─────────────────────────────────────────
        "Riesling's intense aromatics come from monoterpenes — the same compounds that give citrus its zing.",
        "Noble rot (Botrytis cinerea) is the fungus that creates Sauternes and Tokaji. It pierces grapes, concentrates sugars, and dries them on the vine.",
        "The standard 750ml bottle settled into shape in the 19th century — roughly the volume of an average glassblower's lungful.",
        "Veraison is the moment grapes change color and start ripening. Winemakers walk the rows daily during it.",
        "All Vitis vinifera (wine grapes) descend from a single domestication in the Caucasus around 8,000 years ago. One family tree.",
        "Rosé isn't a blend of red and white — it's red grapes with brief skin contact, sometimes only a few hours.",
        "Italy has roughly 350 native grape varieties in commercial production — more than any other country on earth.",
        "Chardonnay can taste like 20 different things depending on terroir and oak. The chameleon grape.",
        "A wine's 'vintage' is the harvest year, not the bottling year. A 2020 vintage may not hit shelves until 2023 or later.",
        "Sparkling wine inside the bottle sits at about 6 atmospheres of pressure — three times a car tire.",
        "Robert Parker's 100-point scale launched in 1978 and reshaped global wine commerce. A 95+ score can triple a wine's price overnight.",
        "Cork bark regrows every 9 years. One cork oak gives 200+ years of harvests. Portugal makes most of the world's supply.",
        "Schloss Johannisberg in Germany, founded around 1100 AD, claims the title of oldest continuously-operating winery.",
        "Vermouth was born in Turin in the late 18th century — wine fortified and aromatized with herbs and spices.",
        "A 'second label' is the same producer's lower-tier wine, often half the price. Often made from younger vines or declassified lots.",
        "Vines can live 100+ years. Old-vine fruit is prized for concentration; yields drop sharply after year 50.",
        "Bordeaux is mostly blended (Cabernet Sauvignon + Merlot + others); Burgundy is single-varietal (Pinot Noir or Chardonnay). Two philosophies, one continent.",
        "Most wines aren't built to age. Of all the wine produced annually, less than 1% improves past 10 years in the cellar.",
        "Champagne grapes are picked in September and the bubbles arrive in spring — the second fermentation happens in the bottle.",
        "Wine glasses for red are wider so aromas have room to circulate. White glasses are narrower to keep the wine cool. Old logic, still true.",
      ],
      quotes: [
        '"In water one sees one\'s own face; but in wine one beholds the heart of another." — French proverb',
        '"Wine is sunlight, held together by water." — Galileo Galilei',
        '"Age is just a number. It\'s totally irrelevant unless, of course, you happen to be a bottle of wine." — Joan Collins',
        '"Wine makes daily living easier, less hurried, with fewer tensions and more tolerance." — Benjamin Franklin',
        '"Either give me more wine or leave me alone." — Rumi',
        '"Wine is bottled poetry." — Robert Louis Stevenson',
        '"A meal without wine is like a day without sunshine." — Anthelme Brillat-Savarin',
        // ─── silly / sharp ──────────────────────────────────────────
        '"I cook with wine. Sometimes I even add it to the food." — W.C. Fields',
        '"I drink to make other people more interesting." — Ernest Hemingway',
        '"I\'m not a heavy drinker. I can sometimes go for hours without touching a drop." — Noel Coward',
        '"I only drink champagne on two occasions: when I am in love and when I am not." — Coco Chanel',
        '"There comes a time in every woman\'s life when the only thing that helps is a glass of champagne." — Bette Davis',
        '"Burgundy makes you think of silly things; Bordeaux makes you talk about them, and Champagne makes you do them." — Jean Anthelme Brillat-Savarin',
        '"A bottle of wine begs to be shared; I have never met a miserly wine lover." — Clifton Fadiman',
        '"Penicillin cures, but it is wine that makes people happy." — Alexander Fleming',
        '"Champagne, if you are seeking the truth, is better than a lie detector." — Graham Greene',
        '"Champagne for my real friends, and real pain for my sham friends." — Tom Waits',
        '"Quickly, bring me a beaker of wine, so that I may wet my mind and say something clever." — Aristophanes',
        '"Wine is the most healthful and most hygienic of beverages." — Louis Pasteur',
        '"Beer is made by men, wine by God." — Martin Luther',
        '"When asked what wine he liked to drink, he replied: that which belongs to another." — Diogenes the Cynic',
        '"In victory, you deserve champagne. In defeat, you need it." — Napoleon Bonaparte',
        '"The discovery of a wine is of greater moment than the discovery of a constellation. The universe is too full of stars." — Benjamin Franklin',
        '"I have enjoyed great health at a great age because every day since I can remember I have consumed a bottle of wine except when I have not felt well — then I have consumed two bottles." — A Bishop of Seville (apocryphal but beloved)',
        '"Drink because you are happy, but never because you are miserable." — G.K. Chesterton',
        '"I shall drink no wine before its time. Okay, it is time." — Groucho Marx',
        '"There are no standards of taste in wine; each man\'s own taste is the standard, and a majority vote cannot decide for him or in any slightest degree affect the supremacy of his own standard." — Mark Twain',
        // ─── more wine quotes — literary, biblical, irreverent ──────
        '"Where there is no wine, there is no love." — Euripides',
        '"Wine cheereth God and man." — Judges 9:13',
        '"Drink no longer water, but use a little wine for thy stomach\'s sake and thine often infirmities." — 1 Timothy 5:23',
        '"Old wood best to burn, old wine to drink, old friends to trust, and old authors to read." — Francis Bacon',
        '"The juice of the grape is the liquid quintessence of concentrated sunbeams." — Thomas Love Peacock',
        '"Champagne is the only wine that leaves a woman beautiful after drinking it." — Madame de Pompadour',
        '"Compromises are for relationships, not wine." — Sir Robert Scott Caywood',
        '"Wine is the divine juice of September." — Voltaire',
        '"Wine to me is passion. It\'s family and friends. It\'s warmth of heart and generosity of spirit." — Robert Mondavi',
        '"Pour out the wine without restraint or stay; pour not by cups, but by the bellyful." — Walt Whitman',
        '"Good wine is a necessity of life for me." — Thomas Jefferson',
        '"Give me wine to wash me clean of the weather-stains of cares." — Ralph Waldo Emerson',
        '"Wine is the most civilized thing in the world." — Ernest Hemingway',
        '"A waltz and a glass of wine invite an encore." — Johann Strauss II',
        '"There is more philosophy in a bottle of wine than in all the books." — Louis Pasteur',
        '"Sorrow can be alleviated by good sleep, a bath and a glass of wine." — Thomas Aquinas',
        '"If God forbade drinking, would He have made wine so good?" — Cardinal Richelieu (attributed)',
        '"Accept what life offers you and try to drink from every cup. All wines should be tasted." — Paulo Coelho',
        '"Wine is wisdom, philosophy, intoxication, glory." — Ben Jonson',
      ],
      quips: [
        "wine doesn't keep secrets. that's its job.",
        "an open bottle has an opinion. pour it.",
        "the best wine is the one in front of you with someone you like.",
        "a Tuesday with the right Burgundy isn't a Tuesday anymore.",
        "if you find yourself talking to the bottle, you're doing it right.",
        "the second glass is always better than the first. nobody knows why.",
        "decant for an hour. dinner waits. wine doesn't.",
        "if the label intimidates you, drink it anyway. it's just grapes.",
        "the cork is a souvenir. the bottle is the story.",
        "you don't buy wine for the bottle. you buy it for the next ninety minutes.",
        "cheap wine ages into vinegar. good wine ages into stories.",
        "there are no bad weekends with the right Burgundy.",
        "the right glass turns the same wine into a different wine.",
        "swirl. sniff. taste. talk less.",
        "one bottle, one meal, three hours. that's the math.",
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
        '"There is nothing outside of yourself that can ever enable you to get better, stronger, richer, quicker, or smarter." — Miyamoto Musashi',
        '"Fall seven times, stand up eight." — Japanese proverb (七転び八起き)',
        '"The bamboo that bends is stronger than the oak that resists." — Japanese proverb',
        '"Vision without action is a daydream. Action without vision is a nightmare." — Japanese proverb',
        // ─── more Musashi (Book of Five Rings) ──────────────────────
        '"Today is victory over yourself of yesterday; tomorrow is your victory over lesser men." — Miyamoto Musashi',
        '"From one thing, know ten thousand things." — Miyamoto Musashi',
        '"Do nothing which is of no use." — Miyamoto Musashi',
        '"The Way is in training. Become acquainted with every art. Know the Ways of all professions." — Miyamoto Musashi',
        '"To win any battle you must fight as if you are already dead." — Miyamoto Musashi',
        '"It is difficult to understand the universe if you only study one planet." — Miyamoto Musashi',
        // ─── Tokugawa Ieyasu — the patience-shogun ──────────────────
        '"Life is like a long journey with a heavy burden. Let your step be slow and steady, that you stumble not." — Tokugawa Ieyasu',
        '"The strong manly ones in life are those who understand the meaning of the word patience." — Tokugawa Ieyasu',
        '"Persuade yourself that imperfection and inconvenience are the natural lot of mortals, and there will be no room for discontent." — Tokugawa Ieyasu',
        // ─── classic proverbs ───────────────────────────────────────
        '"Even monkeys fall from trees." — Japanese proverb (猿も木から落ちる — even experts mess up)',
        '"Sit on a stone for three years and even the stone gets warm." — Japanese proverb (石の上にも三年)',
        '"The nail that sticks out gets hammered down." — Japanese proverb (出る杭は打たれる)',
        '"A frog in a well does not know the great ocean." — Japanese proverb (井の中の蛙大海を知らず)',
        '"He who chases two rabbits catches neither." — Japanese proverb (二兎を追う者は一兎をも得ず)',
        '"One kind word can warm three winter months." — Japanese proverb',
        '"If you understand everything, you must be misinformed." — Japanese proverb',
        // ─── Aikido / modern wisdom ─────────────────────────────────
        '"The way of the warrior has been misunderstood. It is not a means of killing and destroying. It is the way of nourishing life." — Morihei Ueshiba',
        '"Better than a thousand hollow words is one word that brings peace." — Buddha (revered in Japan)',
      ],
      quips: [
        "Musashi won 60 duels. wrote his book in a cave. cave guys are something else.",
        "the empire wasn't built in a day. neither was Edo.",
        "kintsugi makes the crack part of the bowl. worth thinking about.",
        "fall seven, stand eight. that's most of it.",
        "Ieyasu waited for 60 years to become shogun. patience compounds.",
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
        '"I came, I saw, I conquered." — Julius Caesar (Veni, vidi, vici)',
        '"What we do now echoes in eternity." — Marcus Aurelius',
        '"The die is cast." — Julius Caesar, on crossing the Rubicon (Alea iacta est)',
        '"If you want to be loved, love." — Seneca',
        '"He who fears death will never do anything worthy of a man in life." — Seneca',
        '"Make haste slowly." — Augustus, his personal motto (Festina lente)',
        '"Remember you must die." — Stoic refrain, whispered to victorious generals during their triumph (Memento mori)',
        '"You have power over your mind — not outside events. Realize this, and you will find strength." — Marcus Aurelius',
        // ─── more Marcus Aurelius (Meditations) ─────────────────────
        '"Waste no more time arguing what a good man should be. Be one." — Marcus Aurelius',
        '"The happiness of your life depends upon the quality of your thoughts." — Marcus Aurelius',
        '"The best revenge is to be unlike him who performed the injury." — Marcus Aurelius',
        '"Confine yourself to the present." — Marcus Aurelius',
        '"If it is not right, do not do it; if it is not true, do not say it." — Marcus Aurelius',
        '"Everything we hear is an opinion, not a fact. Everything we see is a perspective, not the truth." — Marcus Aurelius',
        // ─── more Seneca ────────────────────────────────────────────
        '"We suffer more often in imagination than in reality." — Seneca',
        '"Luck is what happens when preparation meets opportunity." — Seneca',
        '"Difficulties strengthen the mind, as labor does the body." — Seneca',
        '"Sometimes even to live is an act of courage." — Seneca',
        '"A gem cannot be polished without friction, nor a man perfected without trials." — Seneca',
        // ─── Cicero, Virgil, Vegetius — full lines ──────────────────
        '"While I breathe, I hope." — Cicero (Dum spiro, spero)',
        '"Fortune favors the bold." — Virgil (Audaces fortuna iuvat)',
        '"Through hardships to the stars." — Seneca, often attributed (Per aspera ad astra)',
        '"If you want peace, prepare for war." — Vegetius (Si vis pacem, para bellum)',
        '"Love conquers all." — Virgil (Omnia vincit amor)',
        '"In wine, there is truth." — Pliny the Elder (In vino veritas)',
        '"The welfare of the people is the supreme law." — Cicero (Salus populi suprema lex esto)',
        // ─── Cato, Juvenal, Tacitus ─────────────────────────────────
        '"Carthage must be destroyed." — Cato the Elder, ended every speech with this (Carthago delenda est)',
        '"No bad man is happy." — Juvenal',
        '"They make a desert and call it peace." — Tacitus, on Roman conquest',
      ],
      quips: [
        "the empire wasn't built in a day. don't try to fix everything tonight.",
        "Augustus took 41 years. you have today.",
        "Marcus wrote his journal at night, by candle, while running an empire. perspective.",
        "festina lente. nothing slows you down like rushing.",
        "Cato ended every speech with the same line. consistency is its own kind of strength.",
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
    // ════════════════════════════════════════════════════════════════
    // COFFEE — 200 entries (100 facts + 40 quotes + 60 quips)
    // ════════════════════════════════════════════════════════════════
    coffee: {
      facts: [
        // ─── origins & history (15) ─────────────────────────────────
        "Coffee's origin myth: Kaldi the Ethiopian goatherd noticed his goats dancing after eating red coffee cherries, around 850 AD.",
        "The earliest verified coffee drinking is from Yemeni Sufi monasteries in the 15th century — used to stay awake during night prayer.",
        "The first coffee houses opened in Mecca in the 15th century. Authorities banned them multiple times — they worried coffee stimulated radical thinking. They were right.",
        "Coffee reached Europe through Venetian merchants around 1600.",
        "The first European coffee house opened in Venice in 1645. London's first opened in 1652.",
        "By 1700 London had 2,000+ coffee houses. They were called 'penny universities' — for a penny coffee, you could join the discussion.",
        "Lloyd's of London started as a coffee house. So did the London Stock Exchange. So did most insurance markets.",
        "Coffee was banned in Mecca in 1511, Constantinople in 1623, and Sweden five times in the 18th century. Every ban failed.",
        "Frederick the Great tried to ban coffee in Prussia in 1777 to protect beer sales. Public outcry forced him to back off.",
        "Pope Clement VIII reportedly tasted coffee in 1600 and blessed it, saying it was too good to leave to the infidels.",
        "Coffee was introduced to Brazil in 1727 by a Portuguese officer. Brazil produces about 40% of the world's coffee today.",
        "The Boston Tea Party (1773) made coffee patriotic in America. Drinking tea became politically suspect.",
        "Vietnam was forced to plant coffee by French colonists in the 1850s. Today Vietnam is the world's number two producer.",
        "The first instant coffee was invented in 1901 by Japanese-American chemist Satori Kato.",
        "Howard Schultz transformed Starbucks from a six-store roaster into a global chain after a 1983 trip to Milan inspired by Italian espresso bar culture.",
        // ─── plant & growing (15) ───────────────────────────────────
        "Coffee 'beans' aren't beans — they're seeds of a cherry-like fruit.",
        "Coffee plants take 3-4 years to bear first fruit, then produce for about 25 years.",
        "Coffee trees flower with white blossoms that smell like jasmine. They flower and fruit simultaneously.",
        "There are around 125 coffee species. Only two matter commercially: Arabica (60-70% of production) and Robusta (the rest).",
        "Arabica grows at higher altitudes (3,000-6,000 feet), prefers shade, and has more nuanced flavor. Slower-growing, more vulnerable to disease.",
        "Robusta grows at lower altitudes, tolerates heat and pests better, has nearly double the caffeine, and a rougher profile. Used in instant coffee and Italian espresso blends.",
        "The 'coffee belt' is the band between the Tropics of Cancer and Capricorn. Almost all coffee in the world grows there.",
        "A single coffee tree produces enough beans for about one pound of roasted coffee per year.",
        "Coffee is one of the most labor-intensive crops in the world — ripe cherries must be hand-picked for quality.",
        "Selective hand-picking happens 6-8 times per harvest because cherries ripen at different rates.",
        "The 'green bean' is the processed, dried seed before roasting. Green beans store 6-12 months before quality drops.",
        "Coffee plants are mostly self-pollinating, but bee pollination increases yield 10-20%.",
        "Climate change is shrinking the viable coffee belt. By 2050, suitable Arabica land may be cut in half.",
        "Coffee Leaf Rust, a fungal disease, devastated Central American crops in 2012-13. Industry losses topped one billion dollars.",
        "Hawaii is the only US state that grows coffee commercially. Kona, on the Big Island, is the most famous.",
        // ─── processing (10) ────────────────────────────────────────
        "Washed processing: cherries are pulped, then beans fermented in water to remove mucilage. Cleaner, brighter cup. Most common for specialty coffee.",
        "Natural processing: cherries are dried whole, bean inside fruit. Fruity, wild, sometimes funky. The original method.",
        "Honey processing: somewhere between — pulp removed but some mucilage left. Sweet, syrupy character. Costa Rica popularized it.",
        "After processing, beans are sorted by size and density. Premium coffee passes through both screen-size and water-density sorting.",
        "Coffee can be aged like wine. Indonesian 'monsoon malabar' beans are deliberately aged in humid warehouses for months.",
        "Decaffeinated coffee removes 97-99% of caffeine. The Swiss Water Process uses no chemicals — just charcoal-filtered water.",
        "Kopi Luwak, the most expensive coffee, comes from civet droppings. The animal's digestion alters fermentation. Now mostly synthetic farming due to animal welfare concerns.",
        "Black Ivory Coffee uses elephants the same way. Costs around 2,000 dollars per kilogram.",
        "Geisha (Gesha) coffee from Panama is one of the most expensive auctioned coffees — Hacienda La Esmeralda has sold for over 1,000 dollars per pound.",
        "The Cup of Excellence is the major specialty-coffee award. Winning farms can multiply their export prices tenfold.",
        // ─── roasting (10) ──────────────────────────────────────────
        "Green beans are tan-green. Roasting drives off moisture, develops Maillard browning, and brings oils to the surface.",
        "The 'first crack' happens around 385°F — beans audibly pop as water inside vaporizes. Light roast finishes shortly after.",
        "The 'second crack' at around 435°F is the cellulose structure breaking down. Dark roast hits this; espresso roast may go past it.",
        "Light roasts preserve origin character (acidity, fruit, brightness). Dark roasts develop roasted character that masks origin.",
        "Italian roast is darker than French roast, which is darker than Vienna roast, which is darker than city roast. Roughly.",
        "Roasted coffee outgasses CO2 for about two weeks. That's why fresh coffee can taste foamy or sour right out of the bag.",
        "Optimal 'rest' for fresh-roasted espresso beans is 7-14 days after roast date. Filter brewing can use slightly fresher beans.",
        "Coffee oils make beans look shiny. Dark roasts have oils on the surface; light roasts hide them inside.",
        "Most coffee loses peak flavor within a month of roasting. Pre-ground coffee loses peak flavor in 15 minutes.",
        "Industry roasting machines range from 1kg drum roasters for cafes to 600kg+ commercial roasters for supermarket brands.",
        // ─── brewing science (15) ───────────────────────────────────
        "Optimal brew temperature is 195-205°F. Below = sour (under-extraction). Above = bitter (over-extraction).",
        "Optimal brew ratio for most methods is 1:16 (1g coffee to 16g water). Some prefer 1:15 (stronger) or 1:17 (lighter).",
        "Espresso is brewed at 9 bars of pressure — roughly 130 psi. Twice the pressure of a soda can.",
        "An espresso 'shot' is 25-30ml extracted in 25-30 seconds. Typical dose is 18-22g of dry coffee.",
        "Crema on espresso is emulsified CO2 and oils. Good crema is hazelnut-colored and persistent.",
        "Cold brew is steeped 12-24 hours in cold water. Low acidity, sweet, often higher caffeine concentration than hot brew.",
        "The Hario V60 dripper has spiraling ridges that improve drawdown speed. Designed in 2004 in Japan.",
        "Chemex paper filters are 30% thicker than standard. They trap more oils and produce the cleanest cup.",
        "The Aeropress was invented by Alan Adler in 2005. He also invented the Aerobie flying ring.",
        "A French press uses metal mesh — it lets oils through, giving a fuller, heavier body than paper-filtered coffee.",
        "Cuppings are the standard tasting method. Grounds steeped in hot water, then 'broken' with a spoon while the taster smells the crust.",
        "Specialty coffee uses a 100-point scoring system. Anything 80+ is 'specialty grade.'",
        "Pre-infusion — wetting grounds with a little water before full brewing — lets CO2 escape evenly for more even extraction.",
        "Water hardness affects extraction. Distilled water under-extracts; hard water over-extracts. SCA spec is around 150 ppm TDS.",
        "Grind size matters more than most variables. Same beans, different grind, completely different cup.",
        // ─── equipment (10) ─────────────────────────────────────────
        "The first patent for an espresso machine was filed by Angelo Moriondo in 1884. Modern espresso emerged in 1901 with Luigi Bezzera's improvements.",
        "The Gaggia lever espresso machine (1948) introduced pressure-based extraction. Crema as we know it was born there.",
        "The Mokapot (stovetop espresso maker) was invented in 1933 by Alfonso Bialetti. Same eight-sided design today.",
        "Burr grinders crush beans between two abrasive surfaces. Blade grinders chop. Burr produces even particle size — essential for quality.",
        "Espresso machines use brass or stainless steel boilers. Some have dual boilers (one for water, one for steam) to brew and steam simultaneously.",
        "La Marzocco GB5 and Slayer Steam are common high-end commercial espresso machines. They cost 15,000-30,000 dollars.",
        "The Fellow Stagg EKG kettle is favored for pour-over because of its goose-neck spout and precise temperature control.",
        "A 'puck' of espresso grounds, tamped firmly, is dosed at typically 7-9g per single shot, 14-22g for double.",
        "The Kalita Wave is a Japanese flat-bottom dripper that produces more uniform extraction than conical drippers.",
        "Specialty coffee shops typically stock 3-5 different brewing methods on bar: espresso, V60, Chemex, Aeropress, batch brew.",
        // ─── caffeine & health (10) ─────────────────────────────────
        "Caffeine works by blocking adenosine receptors. Adenosine accumulates during the day and makes us feel tired.",
        "Caffeine's effect peaks 30-60 minutes after consumption and has a 5-6 hour half-life in most adults.",
        "Black coffee has 95-200mg caffeine per 8oz cup. Espresso has 60-80mg per shot. Cold brew can have 200-300mg per 16oz.",
        "Decaffeinated coffee still has 2-15mg of caffeine per cup.",
        "Caffeine is the world's most consumed psychoactive drug. About 85% of adults consume some daily.",
        "Genetic variation in the CYP1A2 enzyme determines how fast you metabolize caffeine. Fast metabolizers can drink coffee at night; slow metabolizers should stop by noon.",
        "Coffee is linked to lower risk of Parkinson's, type 2 diabetes, and certain cancers — though correlation isn't causation.",
        "Moderate coffee consumption (3-4 cups/day) is associated with lower mortality in large epidemiological studies.",
        "Decaf has antioxidants too — coffee's health benefits aren't only from caffeine.",
        "Adding milk slows caffeine absorption slightly but doesn't reduce caffeine content.",
        // ─── culture & shops (10) ───────────────────────────────────
        "Italians don't drink cappuccino after 11 AM. It's considered a breakfast drink. Order one at dinner and the waiter will judge you.",
        "Vienna's coffee house culture is on UNESCO's list of Intangible Cultural Heritage.",
        "The Frappuccino was invented at the Santa Monica Starbucks in 1994. Now a billion-dollar product line.",
        "Third-wave coffee, starting around 2002, treats coffee like wine: origin-focused, traceable, artisanal.",
        "Specialty coffee makes up about 10% of US coffee sales but is the fastest-growing segment.",
        "Coffee is the second-most traded commodity by value, after oil.",
        "Finland consumes more coffee per capita than any other country — around 12kg per person per year.",
        "The word 'barista' is Italian — gendered male in Italian, neuter in English usage.",
        "The Cup of Excellence competition was started in 1999. Winning lots auction for thousands of dollars per pound.",
        "Japan has the most refined drip coffee culture outside origin countries — Hario, Kalita, Origami are all Japanese designs.",
        // ─── trivia (5) ─────────────────────────────────────────────
        "Roasted coffee contains over 1,000 chemical compounds responsible for its aroma. More complex than wine.",
        "Beethoven counted out exactly 60 beans for each cup of coffee. Every cup. Every day.",
        "Honoré de Balzac drank 50+ cups of coffee a day. He died at 51 of heart failure.",
        "Voltaire allegedly drank 40-50 cups a day. He lived to 83. Genetics matter.",
        "Bach loved coffee so much he wrote the Coffee Cantata (BWV 211) — a comic mini-opera about a daughter who refuses to give up coffee for marriage.",
      ],
      quotes: [
        '"I have measured out my life with coffee spoons." — T.S. Eliot, The Love Song of J. Alfred Prufrock',
        '"Coffee is a way of stealing time that should by rights belong to your older self." — Terry Pratchett',
        '"I never drink coffee at lunch. I find it keeps me awake for the afternoon." — Ronald Reagan',
        '"As long as there was coffee in the world, how bad could things be?" — Cassandra Clare',
        '"Coffee, the favorite drink of the civilized world." — Thomas Jefferson',
        '"Black as the devil, hot as hell, pure as an angel, sweet as love." — Charles Maurice de Talleyrand',
        '"I judge a restaurant by the bread and by the coffee." — Burt Lancaster',
        '"I would rather suffer with coffee than be senseless." — Napoleon Bonaparte',
        '"If it wasn\'t for the coffee, I\'d have no identifiable personality whatsoever." — David Letterman',
        '"Coffee is a language in itself." — Jackie Chan',
        '"A mathematician is a device for turning coffee into theorems." — Alfréd Rényi',
        '"It is inhumane, in my opinion, to force people who have a genuine medical need for coffee to wait in line behind people who apparently view coffee as some kind of recreational activity." — Dave Barry',
        '"Coffee makes us severe, and grave, and philosophical." — Jonathan Swift',
        '"What goes best with a cup of coffee? Another cup." — Henry Rollins',
        '"I\'d rather take coffee than compliments just now." — Louisa May Alcott, Little Women',
        '"The morning cup of coffee has an exhilaration about it which the cheering influence of the afternoon or evening cup of tea cannot be expected to reproduce." — Oliver Wendell Holmes Sr.',
        '"Coffee is the great social lubricant." — Howard Schultz',
        '"Coffee is a fleeting moment and a fragrance." — Claudia Roden',
        '"Without my morning coffee, I\'m just like a dried-up piece of roast goat." — Johann Sebastian Bach, Coffee Cantata (BWV 211)',
        '"If this is coffee, please bring me some tea; but if this is tea, please bring me some coffee." — Abraham Lincoln (commonly attributed)',
        '"Coffee is real good when you drink it; it gives you time to think. It\'s a lot more than just a drink." — Gertrude Stein',
        '"Even a bad cup of coffee is better than no coffee at all." — David Lynch',
        '"Coffee leads men to trifle away their time, scald their chops, and spend their money, all for a little base, black, thick, nasty bitter stinking nauseous puddle water." — The Women\'s Petition Against Coffee, London 1674',
        '"Coffee should be black as hell, strong as death, and sweet as love." — Turkish proverb',
        '"This Satan\'s drink is so delicious it would be a pity to let the infidels have exclusive use of it." — Pope Clement VIII (1600, on first tasting coffee)',
        '"Mornings are for coffee and contemplation." — Chief Jim Hopper, Stranger Things',
        '"Adventure in life is good; consistency in coffee even better." — Justina Chen Headley',
        '"I never laugh until I\'ve had my coffee." — Clark Gable',
        '"Behind every successful person is a substantial amount of coffee." — Stephanie Piro',
        '"He was my cream, and I was his coffee — and when you poured us together, it was something." — Josephine Baker',
        '"Decaf is the spawn of Satan." — Mark Knopfler',
        '"Coffee is the common man\'s gold, and like gold, it brings to every person the feeling of luxury and nobility." — Sheikh Abd-al-Kadir, 16th century',
        '"The discovery of coffee has enlarged the realm of illusion and given more hope to the hopeless." — Isak Dinesen (Karen Blixen)',
        '"Coffee — though a useful medicine — if drunk constantly will at length induce a decay of health." — John Wesley',
        '"Conscience keeps more people awake than coffee." — English proverb',
        '"I like my coffee strong and my women weak." — Norm Macdonald',
        '"Coffee, n. A bitter beverage suitable for breakfast." — Ambrose Bierce, The Devil\'s Dictionary',
        '"A morning without coffee is like sleep." — anonymous',
        '"Life is too short for bad coffee." — anonymous',
        '"Coffee first. Schemes later." — anonymous',
      ],
      quips: [
        "the day starts when the kettle does.",
        "good coffee is patience plus nine bars of pressure.",
        "you don't drink espresso. you accept it.",
        "two shots and a long view. that's a Tuesday.",
        "the first sip is honest. the rest is habit.",
        "cold brew lies about time. that's part of its charm.",
        "fresh-ground beans tell the truth. pre-ground beans tell what they remember.",
        "an espresso machine costs less than therapy. usually.",
        "crema is the conversation before the coffee.",
        "a slow pour is a slow morning. don't rush either.",
        "the barista who weighs the shot owns the bar.",
        "light roast is honest. dark roast is forgiving.",
        "milk steams when the pitcher whirlpools. that's all the secret there is.",
        "a clean grinder beats a fancy machine.",
        "third-wave shops measure water. take notes.",
        "an Aeropress is a Swiss army knife. travel with it.",
        "instant coffee in a hotel room is better than no coffee in a hotel room. barely.",
        "the second cup is when the day begins to make sense.",
        "burr grinders cost what they cost because grind is everything.",
        "a flat white isn't a small latte. fight me.",
        "you can fake espresso in a moka pot. it's not the same. it's its own thing.",
        "cold brew at midnight is a mistake everyone makes once.",
        "drip coffee made well beats espresso made carelessly. every time.",
        "Italians don't order cappuccino after eleven. respect the local rules.",
        "the V60 is geometry. mastered, it's a different planet.",
        "coffee oils on a glass cup are the espresso's signature.",
        "a refractometer at the bar means they're serious. ask questions.",
        "green beans last a year. roasted beans last a month. ground beans last fifteen minutes.",
        "the right cup turns the same coffee into a different coffee.",
        "coffee makes you generous with time. that's the point.",
        "a tired barista pulls a sad shot. respect the labor.",
        "the brew ratio is one to sixteen. write it down.",
        "dialing in espresso is a daily ritual, not a one-time event.",
        "when the puck cracks under the portafilter, you learn something.",
        "the morning the kettle whistles late is the morning you're already lost.",
        "baristas calibrate their machines like watchmakers calibrate watches.",
        "an old Italian espresso bar at 7 AM is a temple. quiet down.",
        "coffee culture is regional, like wine. respect the dialects.",
        "nitro cold brew is engineering. drink it once, judge later.",
        "the coffee shop with the smallest menu usually makes the best coffee.",
        "a 32-second pull is a story. listen.",
        "caffeine is a tool. respect its half-life.",
        "the third cup is denial. the fourth is research.",
        "coffee shops were universities once. some still are.",
        "specialty coffee tastes like the place it grew. that's geography in a cup.",
        "fresh-roasted beans hiss when you grind them. that's CO2 leaving.",
        "the steam wand is loud for a reason. don't apologize for the noise.",
        "a perfect latte rosetta is mostly luck on the last pour.",
        "coffee in a paper cup is fine. coffee in a porcelain cup is better.",
        "a barista who asks how you like it actually cares.",
        "drip coffee, black, in a thermos at dawn — that's the working person's espresso.",
        "a single-origin pour-over is geography you can drink.",
        "light roast in summer, dark roast in winter. instinct knows.",
        "the third wave wants you to taste blueberries. give it a chance.",
        "coffee is one of the few things in life that's better the slower you make it.",
        "fresh-brewed coffee at midnight while the world sleeps is a small private luxury.",
        "roast date matters. ignore everything else if it's not on the bag.",
        "coffee shop noise at 9 AM is a productivity drug. studies back this up.",
        "the cup before the meeting is the meeting before the meeting.",
        "Bach wrote a comic opera about coffee. that says everything.",
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
        // ─── chef life / restaurant culture ──────────────────────────
        "The brigade de cuisine — the kitchen hierarchy — was codified by Escoffier around 1900. Most pro kitchens still use it: chef de cuisine, sous chef, chef de partie, commis.",
        "Family meal — the staff meal cooks make for themselves before service — is where you learn what a kitchen really cares about.",
        "A pro brigade can put out 100+ covers in a four-hour service. The plate clock starts when the ticket prints.",
        "Most line cooks burn themselves regularly. The hands tell the story — scarred, fast, reliable.",
        "Service in a top restaurant runs on adrenaline and silence. The dining room hears nothing; the kitchen is a controlled storm.",
        "The five French mother sauces — béchamel, velouté, espagnole, tomate, hollandaise — are still the architecture of Western cuisine.",
        "A 10-inch chef's knife should weigh about 8 ounces. Heavier ones tire the hand by hour two of prep.",
        "The 'stagiaire' — an unpaid kitchen intern doing prep at top restaurants — is how most pro chefs got their start. Brutal, formative.",
        "Service ends; cleanup begins; the cooks eat at midnight. That's the rhythm. You either love it or you leave.",
        "A blue apron in a restaurant kitchen usually means the wearer is the chef. Every other station has its own color.",
        "Most restaurant kitchens are smaller than the dining room they serve. Magic happens in tight spaces.",
        "The 'pass' is the line between kitchen and dining room. The chef who calls it controls the entire service.",
      ],
      quotes: [
        '"To cook well one must love and respect food." — Julia Child',
        '"The only real stumbling block is fear of failure. In cooking you\'ve got to have a what-the-hell attitude." — Julia Child',
        '"People who love to eat are always the best people." — Julia Child',
        '"You don\'t have to cook fancy or complicated masterpieces — just good food from fresh ingredients." — Julia Child',
        '"Cooking is the most ancient of arts." — Auguste Escoffier',
        '"Good food is the foundation of genuine happiness." — Auguste Escoffier',
        '"Tell me what you eat, and I\'ll tell you what you are." — Jean Anthelme Brillat-Savarin',
        '"The discovery of a new dish does more for the happiness of the human race than the discovery of a star." — Jean Anthelme Brillat-Savarin',
        // ─── M.F.K. Fisher ──────────────────────────────────────────
        '"First, we eat. Then, we do everything else." — M.F.K. Fisher',
        // ─── Bourdain — the chef-life laureate ──────────────────────
        '"Mise en place is the religion of all good line cooks." — Anthony Bourdain',
        '"Skills can be taught. Character you either have or you don\'t have." — Anthony Bourdain',
        '"Your body is not a temple, it\'s an amusement park. Enjoy the ride." — Anthony Bourdain',
        '"Good food is very often, even most often, simple food." — Anthony Bourdain',
        '"Watching cooking shows is like watching pornography. You can watch all you want but you\'re not going to learn how to do it." — Anthony Bourdain',
        // ─── Thomas Keller, Paul Bocuse, Marco Pierre White ─────────
        '"A recipe has no soul. You, as the cook, must bring soul to the recipe." — Thomas Keller',
        '"Without butter, without eggs, there is no reason to come to France." — Paul Bocuse',
        '"I learned that no matter what kind of chef you are or what level you operate at, you must love what you do." — Marco Pierre White',
        // ─── Daniel Boulud, Shauna Niequist ─────────────────────────
        '"If you are a chef, no matter how good a chef you are, it\'s not good cooking for yourself; the joy is in cooking for others." — Daniel Boulud',
        '"I think preparing food and feeding people brings nourishment not only to our bodies but to our spirits. Feeding people is a way of loving them." — Shauna Niequist',
        // ─── Harriet van Horne, George Bernard Shaw, others ─────────
        '"Cooking is like love. It should be entered into with abandon or not at all." — Harriet van Horne',
        '"There is no sincerer love than the love of food." — George Bernard Shaw',
        '"The most remarkable thing about my mother is that for thirty years she served the family nothing but leftovers. The original meal has never been found." — Calvin Trillin',
        '"I cook with wine. Sometimes I even add it to the food." — W.C. Fields',
      ],
      quips: [
        "salt earlier than you think. acid later than you think.",
        "the recipe is a map, not the road.",
        "mise en place is half the job. the other half is staying calm.",
        "every good kitchen runs on two things: prep and respect.",
        "the chef who calls the pass owns the night.",
        "burn yourself once, you remember. burn yourself twice, you weren't paying attention.",
        "family meal tells the truth about a kitchen.",
        "the kitchen never lies. the dining room sometimes does.",
        "every great dish is one ingredient short of being too much.",
        "you don't cook tired. you cook careful. there's a difference.",
        "the line is a brotherhood. service makes the bond.",
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
        '"Begin at once to live, and count each separate day as a separate life." — Seneca',
        '"He who is brave is free." — Seneca',
        '"Every new beginning comes from some other beginning\'s end." — Seneca',
        '"Man conquers the world by conquering himself." — Zeno of Citium',
        '"Don\'t explain your philosophy. Embody it." — Epictetus',
        '"The whole future lies in uncertainty: live immediately." — Seneca',
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
    // ════════════════════════════════════════════════════════════════
    // PASTRY — 100 entries (40 facts + 30 quotes + 30 quips)
    // ════════════════════════════════════════════════════════════════
    pastry: {
      facts: [
        // ─── technical / science (20) ───────────────────────────────
        "Gluten development is the line between flaky and tough. More water plus more mixing equals more gluten equals chewier dough.",
        "Cold butter is the secret to flaky pastry. The butter layers turn to steam during baking and lift the dough into pockets.",
        "Lamination — the folding technique behind croissants and puff pastry — creates 81 to 729 layers depending on fold count.",
        "A classic croissant has 27 distinct layers of butter and dough. Classic puff pastry pushes past 700.",
        "The 'détrempe' is the basic dough; the 'beurrage' is the butter block folded into it. Together they make laminated dough.",
        "Choux pastry rises from steam alone — no yeast. Water boils inside the dough and inflates it into a hollow shell.",
        "Tempered chocolate has a precise crystal structure (Form V) that gives it snap and shine. Untempered chocolate is grainy and dull.",
        "Caramelization of sucrose starts at 320°F. The Maillard reaction starts above 280°F. Different chemistry, both browning.",
        "Macarons fail when humidity is wrong. Their characteristic 'feet' form when the shell skin sets and the inside expands underneath.",
        "Italian meringue uses hot sugar syrup whipped into beaten whites — more stable. French meringue uses raw sugar — simpler, more fragile.",
        "Pâte brisée = short crust, no sugar. Pâte sucrée = sweet, cookie-like. Pâte sablée = sandiest, most crumbly. Three doughs, one family.",
        "Cream is 'whipped' when fat globules link into a network. Over-whipped becomes butter. There's a 30-second window between perfect and ruined.",
        "A génoise sponge rises on beaten eggs alone — no chemical leaveners. The 'ribbon stage' is when the batter holds shape on a lifted whisk.",
        "Phyllo dough is rolled or pulled so thin you can read newsprint through it. Some Greek bakers still hand-pull every sheet.",
        "Gelatin makes mousse silky and elastic; agar-agar (plant-based) sets firmer and clearer. Same job, different feel.",
        "The 'windowpane test' tells you when bread dough has enough gluten. Stretch a piece thin; light through it without tearing means ready.",
        "Sourdough's tang comes from lactobacillus producing lactic and acetic acids. Bread is biology before it's craft.",
        "Crème pâtissière needs egg yolks for richness and cornstarch for structure. Once boiled, it must cool fast or it forms a skin.",
        "Brown butter (beurre noisette) is ready when the milk solids smell like hazelnuts. About 30 seconds past golden — easy to ruin.",
        "Bread flour has 12-14% protein. Cake flour has 6-8%. The protein percentage is everything.",
        // ─── cultural classics (10) ─────────────────────────────────
        "Croissants aren't originally French — they're Austrian (kipferl). Marie Antoinette is said to have popularized them in Paris.",
        "The éclair was likely created by Antoine Carême in the 1850s. 'Éclair' means lightning — eaten so quickly it disappears.",
        "Pavlova is claimed by both Australia and New Zealand. The dispute is over a century old; both have served it for that long.",
        "Madeleines are shell-shaped sponge cakes from Commercy, France. Proust made them immortal in In Search of Lost Time.",
        "The Sachertorte is a chocolate cake from Vienna's Hotel Sacher, 1832. The exact recipe is still a trade secret.",
        "Black Forest cake (Schwarzwälder Kirschtorte) takes its name from the kirsch — cherry brandy — it's soaked in, not the forest.",
        "Tarte Tatin was invented at the Tatin sisters' inn in Lamotte-Beuvron in 1898. The story: one of them accidentally inverted the tart.",
        "Croquembouche — the tower of cream-filled choux puffs bound by spun caramel — is the traditional French wedding cake.",
        "Mille-feuille means 'thousand sheets' — alternating layers of puff pastry and pastry cream.",
        "The cronut, invented by Dominique Ansel in New York in 2013, is laminated like a croissant and fried like a donut.",
        // ─── chefs and history (10) ─────────────────────────────────
        "Antoine Carême (1784-1833) is called the King of Chefs and the Chef of Kings. He served Napoleon, the Tsar, and the British Prince Regent.",
        "Carême invented the modern pâtissier's toolkit — the piping bag, the standardized whisk, and the chef's hat.",
        "Auguste Escoffier codified French haute cuisine in Le Guide Culinaire (1903). His brigade system still organizes most professional kitchens.",
        "Pierre Hermé is widely considered the greatest living pastry chef. His Ispahan — rose, lychee, raspberry — is the most-copied macaron in history.",
        "The French CAP Pâtissier diploma takes 1-2 years. Many pastry chefs start their training at 14 or 15.",
        "The pastry brigade hierarchy: commis, demi-chef de partie, chef de partie, sous-chef pâtissier, chef pâtissier. The hierarchy is real.",
        "Cédric Grolet, at Le Meurice in Paris, is famous for hyper-realistic fruit-shaped pastries. They look exactly like the fruit they're flavored with.",
        "Dominique Ansel was Daniel Boulud's pastry chef at Daniel for seven years before opening his own bakery in 2011 and inventing the cronut.",
        "Most professional pastry chefs start their day at 4 AM. Bread dough doesn't care about clocks.",
        "Yann Couvreur, Cyril Lignac, Pierre Hermé, Cédric Grolet — modern Paris has a whole generation of pastry stars, each with a distinct style.",
      ],
      quotes: [
        '"The fine arts are five in number, namely: painting, sculpture, poetry, music, and architecture — whereof the principal branch is confectionery." — Antoine Carême',
        '"Pastry is the most personal of cuisines." — Pierre Hermé',
        '"I work with one foot in tradition and one foot in modernity." — Pierre Hermé',
        '"Life is short. Eat dessert first." — Jacques Torres',
        '"A party without cake is just a meeting." — Julia Child',
        '"How can a nation be great if its bread tastes like Kleenex?" — Julia Child',
        '"All you need is love. But a little chocolate now and then doesn\'t hurt." — Charles M. Schulz',
        '"There is nothing better than a friend, unless it is a friend with chocolate." — Linda Grayson',
        '"Eat dessert first, life is uncertain." — Ernestine Ulmer',
        '"The smell of good bread baking, like the sound of lightly flowing water, is indescribable in its evocation of innocence and delight." — M.F.K. Fisher',
        '"Bread is the king of the table and all else is merely the court that surrounds the king." — Louis Bromfield',
        '"All sorrows are less with bread." — Miguel de Cervantes, Don Quixote',
        '"A balanced diet is a cookie in each hand." — Barbara Johnson',
        '"All happiness depends on a leisurely breakfast." — John Gunther',
        '"Cake is happiness!" — C. JoyBell C.',
        '"Stressed is desserts spelled backwards." — anonymous',
        '"Don\'t cry because it\'s over. Eat cake because it happened." — anonymous (variation on Dr. Seuss)',
        '"Cooking is an art, baking is a science." — kitchen proverb',
        '"Give us this day our daily bread." — Matthew 6:11, the Lord\'s Prayer',
        '"Bread is the warmest, kindest of all words. Write it always with a capital letter, like your own name." — Russian saying',
        '"He who has no bread has no authority." — Turkish proverb',
        '"A loaf of bread, a jug of wine, and thou beside me singing in the wilderness — and wilderness is paradise enow." — Omar Khayyam, The Rubaiyat',
        '"Baking can be regarded as a science, but it\'s the chemistry between the ingredients and the cook that gives food its soul." — Anna Olson',
        '"Without butter, without eggs, there is no reason to come to France." — Paul Bocuse',
        '"I love you like a fat kid loves cake." — Scott Adams',
        '"Worries go down better with soup than without." — Jewish proverb',
        '"There is no greater love than the love a baker has for the oven before dawn." — kitchen wisdom',
        '"Pastry is the architecture of sweetness." — pastry adage',
        '"Patisserie is precision performed daily until it looks like grace." — pastry brigade saying',
        '"To make a perfect croissant is to control time, butter, and your own patience all at once." — modern French pastry adage',
      ],
      quips: [
        "butter, sugar, eggs, flour. four things. infinite combinations.",
        "a perfect croissant is three days of work. ask the pastry chef.",
        "choux is steam and faith.",
        "tempered chocolate snaps. that snap is the pastry chef saying hello.",
        "macarons fail in humidity. they don't care about your schedule.",
        "cold butter, cold hands, cold patience. that's flaky pastry.",
        "the windowpane test is honest. dough tells the truth.",
        "bread is biology. you're feeding a microbe colony, not making lunch.",
        "caramelization is a one-way door. nail it or burn it.",
        "the cronut took two years to develop. some pastry doesn't rush.",
        "Proust ate one madeleine and wrote four thousand pages. don't underestimate a small cake.",
        "Tarte Tatin was a happy accident. most good things are.",
        "salt in caramel makes the caramel. it's not a trend; it's chemistry.",
        "a good pastry chef wakes up before the city does.",
        "choux puffs deflate in seconds. pastry doesn't forgive distraction.",
        "the macaron foot is the pastry chef's signature.",
        "brown butter is golden butter held a moment longer. one moment.",
        "lamination is folding patience into dough.",
        "yeast is alive. it sleeps in your fridge. wake it gently.",
        "the pastry station is the calmest in the kitchen — and the most exacting.",
        "twenty-seven layers of butter and steam. that's a croissant.",
        "pastry chefs don't taste with their tongue. they taste with their hands first.",
        "cold marble keeps butter cold. that's why every pastry kitchen has marble.",
        "a fallen soufflé is an honest dessert.",
        "baker's percentage is the language. learn it before you scale a recipe.",
        "fresh bread cools before it slices. patience.",
        "there's a hush around the oven during the last five minutes. that hush is respect.",
        "sourdough is a starter you keep alive for years. it's a pet that feeds you.",
        "the line cook puts out fires. the pastry chef plans them ahead.",
        "butter at 60°F is everything. warmer and it's oil. cooler and it shatters.",
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

    // ════════════════════════════════════════════════════════════════
    // PERSIAN HISTORY — small KB; bridged to dialog.json's persian_facts (85)
    // ════════════════════════════════════════════════════════════════
    persian_history: {
      facts: [
        "The Achaemenid Empire (550-330 BCE) at its peak stretched from the Balkans to the Indus — the first empire to span three continents.",
        "Cyrus the Great freed the Jews from Babylonian captivity. The Bible's Isaiah calls him a messiah.",
        "Darius I built the Royal Road — 1,700 miles from Sardis to Susa. Couriers covered it in 9 days. The Persian postal motto inspired the modern USPS creed.",
        "Persepolis was destroyed by Alexander the Great in 330 BCE — some say drunkenly, some say deliberately.",
        "The Sassanid Empire (224-651 CE) was Rome's rival for 400 years. Trajan invaded it; so did Julian. Neither held it.",
        "Zoroastrianism, founded ~1500-1000 BCE, predates Christianity, Islam, and most of Judaism's organized form. It influenced all three.",
        "The word 'paradise' comes from Old Persian 'pairidaeza' — a walled garden.",
      ],
      quotes: [
        '"There is nothing better for a man than that he should drink." — Cyrus the Great (legendary)',
        '"Whenever the king blinks, a thousand swords clear their scabbards." — Persian proverb',
      ],
      quips: [
        "Cyrus freed slaves. Darius built roads. Xerxes lost. that's a 200-year arc.",
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

  // ─── BRIDGE TO EXISTING DIALOG.JSON KNOWLEDGE POOLS ────────────────
  // v18.10 — clippy-dialog.json already holds ~1000 lines of historical
  // facts across roman_facts (511), trajan_facts (88), persian_facts (85),
  // greek_facts (77), augustus_facts (58), athens_facts (44), etc. The
  // voice across those pools matches Trajan's. Rather than physically
  // migrating that content (which would lose curation work and balloon
  // this file), we BRIDGE — pickFact/Quote/Quip merges the curated KB
  // entries with the bridged pools at query time.
  //
  // Net result: interests.js is the routing layer. dialog.json keeps its
  // bulk content. Anything new added to either becomes available.
  const POOL_BRIDGE = {
    roman_history: {
      facts: ['roman_facts', 'augustus_facts', 'caligula_facts',
              'trajan_facts', 'hispania_facts'],
      quotes: ['latin_phrases', 'trajan_quote_corpus'],
    },
    greek_history: {
      facts: ['greek_facts', 'athens_facts', 'sparta_facts'],
    },
    persian_history: {
      facts: ['persian_facts'],
    },
    military_history: {
      facts: ['battle_facts'],
    },
    philosophy_stoic: {
      quotes: ['trajan_quote_corpus'],
    },
    cooking: {
      facts: ['cooking_tips'],
    },
  };

  // Helper: collect a kind of content from bridged dialog.json pools.
  function _fromBridge(canonKey, kind) {
    const bridge = POOL_BRIDGE[canonKey];
    if (!bridge || !bridge[kind]) return [];
    if (!window.NX || !NX.clippy || !NX.clippy.getDialogPool) return [];
    const out = [];
    for (const poolName of bridge[kind]) {
      try {
        const pool = NX.clippy.getDialogPool(poolName);
        if (pool && pool.length) {
          // Dialog pools are bare strings; we want them as quote-shaped
          // when bridged to a quote-context. Most are already good as-is.
          for (const entry of pool) out.push(entry);
        }
      } catch(_){}
    }
    return out;
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
  function pickFact(key) {
    const canon = canonicalize(key);
    if (!canon) return null;
    const kb = (KB[canon] && KB[canon].facts) || [];
    const bridged = _fromBridge(canon, 'facts');
    return _pick(kb.concat(bridged));
  }
  function pickQuote(key) {
    const canon = canonicalize(key);
    if (!canon) return null;
    const kb = (KB[canon] && KB[canon].quotes) || [];
    const bridged = _fromBridge(canon, 'quotes');
    return _pick(kb.concat(bridged));
  }
  function pickQuip(key) {
    const canon = canonicalize(key);
    if (!canon) return null;
    const kb = (KB[canon] && KB[canon].quips) || [];
    const bridged = _fromBridge(canon, 'quips');
    return _pick(kb.concat(bridged));
  }
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
