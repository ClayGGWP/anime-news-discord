import fs from "node:fs";

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const API_URL = "https://api.fxtwitter.com/AniNewsAndFacts";
const STATE_FILE = "state.json";

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, "utf8");
      return JSON.parse(data);
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

function getMedia(post) {
  if (post.media && post.media.photos && post.media.photos.length > 0) {
    return post.media.photos[0].url;
  }
  if (post.media && post.media.mosaic && post.media.mosaic.formats) {
    return post.media.mosaic.formats.jpeg || post.media.mosaic.formats.webp;
  }
  return undefined;
}

async function getPosts() {
  const response = await fetch(API_URL);
  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();

  // Supporta sia la risposta v1 (data.tweet) sia le liste (data.tweets)
  if (data.tweet) {
    return [data.tweet];
  }
  if (data.tweets && Array.isArray(data.tweets)) {
    return data.tweets;
  }
  
  return [];
}

async function sendToDiscord(post) {
  const author = post.author || {};

  const authorName = author.name || "Anime News And Facts";
  const username = author.screen_name || "AniNewsAndFacts";
  const avatar = author.avatar_url || undefined;
  const image = getMedia(post);

  const textContent = cleanText(post.text || "");
  const description = textContent.length > 0 ? truncate(textContent, 4000) : " ";

  let isoTimestamp;
  if (post.created_at) {
    isoTimestamp = new Date(post.created_at).toISOString();
  } else if (post.created_timestamp) {
    isoTimestamp = new Date(post.created_timestamp * 1000).toISOString();
  } else {
    isoTimestamp = new Date().toISOString();
  }

  const postUrl = post.url || `https://x.com/${username}/status/${post.id}`;

  const embed = {
    title: "📰 ANIME NEWS",
    url: postUrl,
    description: description,
    color: 0x5865f2,
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

  if (image) {
    embed.image = {
      url: image
    };
  }

  const payload = {
    username: "Anime News & Facts",
    ...(avatar ? { avatar_url: avatar } : {}),
    embeds: [embed]
  };

  const response = await fetch(WEBHOOK, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Discord error ${response.status}: ${error}`);
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
    console.log("Nessun post trovato.");
    return;
  }

  // Ordina dal meno recente al più recente
  const sorted = [...posts].sort((a, b) => (a.id > b.id ? 1 : -1));

  // Prima esecuzione: invia l'ultimo post e salva gli ID
  if (state.ids.length === 0) {
    const latest = sorted[sorted.length - 1];
    console.log(`Prima esecuzione: pubblico il post ${latest.id}`);
    await sendToDiscord(latest);
    saveState(sorted.map((p) => p.id));
    return;
  }

  // Esecuzioni successive: invia solo i nuovi post
  const newPosts = sorted.filter((p) => !state.ids.includes(p.id));

  if (newPosts.length === 0) {
    console.log("Nessun nuovo post.");
    return;
  }

  for (const post of newPosts) {
    console.log(`Pubblico post: ${post.id}`);
    await sendToDiscord(post);
    state.ids.push(post.id);
  }

  saveState(state.ids);
}

main().catch(console.error);
