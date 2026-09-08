import fs from "node:fs";

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const STATE_FILE = "state.json";

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Errore lettura state.json:", e);
  }
  return { ids: [] };
}

function saveState(ids) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ids }, null, 2));
  } catch (e) {
    console.error("Errore scrittura state.json:", e);
  }
}

function cleanText(text) {
  return text.replace(/https:\/\/t\.co\/\w+/g, "").trim();
}

function truncate(text, length) {
  if (text.length <= length) return text;
  return text.slice(0, length - 3) + "...";
}

async function getPosts() {
  const url = "https://syndication.twitter.com/srv/timeline-profile/history?screen_name=AniNewsAndFacts";

  try {
    console.log(`Tentativo di connessione a: ${url}`);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!response.ok) {
      console.log(`Risposta non valida: ${response.status}`);
      return [];
    }

    const html = await response.text();

    // Estrae i dati JSON contenuti nello script __NEXT_DATA__
    const jsonMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!jsonMatch) {
      console.log("Impossibile trovare i dati della timeline nell'HTML.");
      return [];
    }

    const jsonData = JSON.parse(jsonMatch[1]);
    const entries = jsonData?.props?.pageProps?.timeline?.entries || [];

    const posts = [];

    for (const entry of entries) {
      if (entry.type !== "tweet") continue;

      const tweetData = entry.content?.tweet;
      if (!tweetData) continue;

      // Estrazione dei media (immagini)
      const mediaPhotos = tweetData.mediaDetails?.filter(m => m.type === "photo") || [];
      const imageUrl = mediaPhotos.length > 0 ? mediaPhotos[0].media_url_https : null;

      posts.push({
        id: String(tweetData.id_str || tweetData.id),
        text: tweetData.text || "",
        url: `https://x.com/AniNewsAndFacts/status/${tweetData.id_str || tweetData.id}`,
        created_at: tweetData.created_at,
        author: {
          name: tweetData.user?.name || "Anime News And Facts",
          screen_name: tweetData.user?.screen_name || "AniNewsAndFacts",
          avatar_url: tweetData.user?.profile_image_url_https
        },
        media: imageUrl
      });
    }

    console.log(`Recuperati ${posts.length} post reali.`);
    return posts;

  } catch (err) {
    console.error(`Errore durante il recupero dei post:`, err.message);
  }

  return [];
}

async function sendToDiscord(post) {
  const author = post.author || {};
  const authorName = author.name || "Anime News And Facts";
  const username = author.screen_name || "AniNewsAndFacts";
  const avatar = author.avatar_url || undefined;

  const textContent = cleanText(post.text || "");
  const description = textContent.length > 0 ? truncate(textContent, 4000) : " ";

  let isoTimestamp;
  if (post.created_at) {
    isoTimestamp = new Date(post.created_at).toISOString();
  } else {
    isoTimestamp = new Date().toISOString();
  }

  const embed = {
    title: "📰 ANIME NEWS",
    url: post.url,
    description: description,
    color: 0x5865F2,
    author: {
      name: `${authorName} (@${username})`,
      url: `https://x.com/${username}`,
      ...(avatar ? { icon_url: avatar } : {})
    },
    footer: {
      text: "Anime News & Facts • X"
    },
    timestamp: isoTimestamp
  };

  if (post.media) {
    embed.image = { url: post.media };
  }

  const payload = {
    username: "Anime News & Facts",
    ...(avatar ? { avatar_url: avatar } : {}),
    embeds: [embed]
  };

  const response = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Discord error ${response.status}: ${await response.text()}`);
  }
}

async function main() {
  if (!WEBHOOK) {
    console.error("DISCORD_WEBHOOK_URL non impostata!");
    process.exit(1);
  }

  const state = loadState();
  const posts = await getPosts();

  if (!posts.length) {
    console.log("Nessun post recuperato dalle API.");
    return;
  }

  // Filtra i post non ancora presenti in state.json
  const newPosts = posts.filter((p) => !state.ids.includes(p.id));

  if (newPosts.length === 0) {
    console.log("Nessun nuovo post da pubblicare.");
    return;
  }

  // Ordina per inviare prima i post meno recenti
  const sortedPosts = [...newPosts].reverse();

  for (const post of sortedPosts) {
    console.log(`Pubblico post ID: ${post.id}`);
    await sendToDiscord(post);
    state.ids.push(post.id);
  }

  saveState(state.ids);
}

main().catch(console.error);
