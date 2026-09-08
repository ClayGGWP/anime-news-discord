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
  const sources = [
    {
      url: "https://rsshub.app/twitter/user/AniNewsAndFacts",
      type: "rsshub"
    },
    {
      url: "https://api.vxtwitter.com/AniNewsAndFacts",
      type: "vxtwitter"
    },
    {
      url: "https://nitter.net/AniNewsAndFacts/rss",
      type: "nitter"
    },
    {
      url: "https://nitter.cz/AniNewsAndFacts/rss",
      type: "nitter"
    }
  ];

  for (const src of sources) {
    try {
      console.log(`Tentativo di connessione a: ${src.url}`);
      const response = await fetch(src.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }
      });

      if (!response.ok) {
        console.log(`Risposta non valida da ${src.url}: ${response.status}`);
        continue;
      }

      if (src.type === "vxtwitter") {
        const data = await response.json();
        // Se restituisce un singolo tweet valido con id specifico
        if (data && data.tweet_id) {
          return [{
            id: String(data.tweet_id),
            text: data.text || "",
            url: data.tweetURL || `https://x.com/AniNewsAndFacts/status/${data.tweet_id}`,
            created_at: data.date,
            author: {
              name: data.user_name || "Anime News And Facts",
              screen_name: data.user_screen_name || "AniNewsAndFacts",
              avatar_url: data.user_profile_image_url
            },
            media: data.mediaURLs && data.mediaURLs.length > 0 ? data.mediaURLs[0] : null
          }];
        }
        continue;
      }

      // Parsing XML RSS per RSSHub / Nitter
      const xmlText = await response.text();
      if (!xmlText.includes("<item>")) continue;

      const items = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;

      while ((match = itemRegex.exec(xmlText)) !== null) {
        const itemContent = match[1];

        const title = (itemContent.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || itemContent.match(/<title>([\s\S]*?)<\/title>/))?.[1] || "";
        const link = (itemContent.match(/<link>([\s\S]*?)<\/link>/))?.[1] || "";
        const pubDate = (itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/))?.[1] || "";
        const description = (itemContent.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || itemContent.match(/<description>([\s\S]*?)<\/description>/))?.[1] || "";

        // Estrazione ID tweet
        const tweetId = link.split("/status/")[1]?.split("#")[0] || link.split("/").pop();

        // Estrazione Immagine
        const imgMatch = description.match(/<img[^>]+src=["']([^"']+)["']/);
        const imageUrl = imgMatch ? imgMatch[1] : null;

        const cleanDesc = description.replace(/<[^>]*>?/gm, "").trim();

        if (tweetId && tweetId.length > 5) {
          items.push({
            id: String(tweetId),
            text: cleanDesc || title,
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
        console.log(`Recuperati ${items.length} post da ${src.url}`);
        return items;
      }
    } catch (err) {
      console.error(`Errore durante la chiamata a ${src.url}:`, err.message);
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
