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
  return text
    .replace(/<[^>]*>?/gm, "") // Rimuove tag HTML del feed RSS
    .replace(/https:\/\/t\.co\/\w+/g, "") // Rimuove t.co link
    .trim();
}

function truncate(text, length) {
  if (text.length <= length) return text;
  return text.slice(0, length - 3) + "...";
}

async function getPosts() {
  const rssUrls = [
    "https://rsshub.app/twitter/user/AniNewsAndFacts",
    "https://nitter.privacydev.net/AniNewsAndFacts/rss",
    "https://nitter.poast.org/AniNewsAndFacts/rss"
  ];

  for (const url of rssUrls) {
    try {
      console.log(`Tentativo di connessione a: ${url}`);
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });

      if (!response.ok) {
        console.log(`Risposta non valida da ${url}: ${response.status}`);
        continue;
      }

      const xmlText = await response.text();
      const items = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;

      while ((match = itemRegex.exec(xmlText)) !== null) {
        const itemContent = match[1];

        const title = (itemContent.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || itemContent.match(/<title>([\s\S]*?)<\/title>/))?.[1] || "";
        const link = (itemContent.match(/<link>([\s\S]*?)<\/link>/))?.[1] || "";
        const pubDate = (itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/))?.[1] || "";
        const description = (itemContent.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || itemContent.match(/<description>([\s\S]*?)<\/description>/))?.[1] || "";

        // Estrae l'ID univoco del tweet dal link
        const tweetId = link.split("/status/")[1]?.split("#")[0] || link.split("/").pop();

        // Estrae la prima immagine allegata se presente
        const imgMatch = description.match(/<img[^>]+src=["']([^"']+)["']/);
        const imageUrl = imgMatch ? imgMatch[1] : null;

        const cleanDesc = cleanText(description);

        if (tweetId) {
          items.push({
            id: String(tweetId),
            text: cleanDesc || cleanText(title),
            url: `https://x.com/AniNewsAndFacts/status/${tweetId}`,
            created_at: pubDate,
            author: {
              name: "Anime News And Facts",
              screen_name: "AniNewsAndFacts"
            },
            media: imageUrl
          });
        }
      }

      if (items.length > 0) {
        console.log(`Recuperati ${items.length} post da RSS.`);
        return items;
      }
    } catch (err) {
      console.error(`Errore durante la chiamata a ${url}:`, err.message);
    }
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

  // Filtra i post già salvati in state.json
  const newPosts = posts.filter((p) => !state.ids.includes(p.id));

  if (newPosts.length === 0) {
    console.log("Nessun nuovo post da pubblicare.");
    return;
  }

  // Ordina dal più vecchio al più recente per inviarli in ordine cronologico
  const sortedPosts = [...newPosts].reverse();

  for (const post of sortedPosts) {
    console.log(`Pubblico post ID: ${post.id}`);
    await sendToDiscord(post);
    state.ids.push(post.id);
  }

  saveState(state.ids);
}

main().catch(console.error);
