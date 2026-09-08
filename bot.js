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
  const username = "AniNewsAndFacts";

  try {
    const url = `https://api.vxtwitter.com/${username}?with_tweets=true`;

    console.log(`Tentativo di connessione a: ${url}`);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!response.ok) {
      console.log(`Risposta non valida: ${response.status}`);
      console.log(await response.text());
      return [];
    }

    const data = await response.json();

    console.log("Risposta VXTwitter ricevuta.");

    if (!data.latest_tweets || !Array.isArray(data.latest_tweets)) {
      console.log("VXTwitter non ha restituito latest_tweets.");
      console.log(data);
      return [];
    }

    return data.latest_tweets.map((tweet) => ({
      id: String(tweet.tweetID || tweet.id),
      text: tweet.text || "",
      url:
        tweet.tweetURL ||
        `https://x.com/${username}/status/${tweet.tweetID}`,

      created_at: tweet.date || null,

      author: {
        name: tweet.user_name || "Anime News And Facts",
        screen_name: tweet.user_screen_name || username,
        avatar_url: tweet.user_profile_image_url || null
      },

      media:
        tweet.mediaURLs && tweet.mediaURLs.length > 0
          ? tweet.mediaURLs[0]
          : null
    }));
  } catch (err) {
    console.error("Errore VXTwitter:", err.message);
    return [];
  }
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
