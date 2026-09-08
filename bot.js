const fs = require("fs");

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const API_URL =
  "https://api.fxtwitter.com/2/profile/AniNewsAndFacts/statuses?count=100";

const STATE_FILE = "state.json";

if (!WEBHOOK) {
  throw new Error("DISCORD_WEBHOOK_URL non configurato");
}

async function getPosts() {
  const response = await fetch(API_URL, {
    headers: {
      "User-Agent": "AnimeNewsDiscordBot/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`FxTwitter API error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.results) {
    throw new Error("Nessun risultato ricevuto da FxTwitter");
  }

  return data.results;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { ids: [] };
  }

  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

function saveState(ids) {
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({ ids: ids.slice(-200) }, null, 2) + "\n"
  );
}

function cleanText(text) {
  return text
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

function getMedia(post) {
  if (!post.media) return null;

  // Prima scelta: immagini
  if (post.media.all) {
    const photo = post.media.all.find(
      media => media.type === "photo"
    );

    if (photo?.url) return photo.url;

    // Se è un video, usiamo la thumbnail
    const video = post.media.all.find(
      media => media.type === "video" || media.type === "gif"
    );

    if (video?.thumbnail_url) {
      return video.thumbnail_url;
    }
  }

  if (post.media.photos?.length) {
    return post.media.photos[0].url;
  }

  return null;
}

async function sendToDiscord(post) {
  const author = post.author || {};

  const authorName =
    author.name || "Anime News And Facts";

  const username =
    author.screen_name || "AniNewsAndFacts";

  const avatar =
    author.avatar_url || undefined;

  const image = getMedia(post);

  const embed = {
    title: "📰 ANIME NEWS",
    url: post.url,
    description: truncate(cleanText(post.text || ""), 4000),

    color: 0x5865F2,

    author: {
      name: `${authorName} (@${username})`,
      url: `https://x.com/${username}`,
      ...(avatar ? { icon_url: avatar } : {})
    },

    footer: {
      text: "Anime News & Facts • X"
    },

    timestamp: post.created_at
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

    throw new Error(
      `Discord error ${response.status}: ${error}`
    );
  }
}

async function main() {
  console.log("Controllo AniNewsAndFacts...");

  const posts = await getPosts();

  if (!posts.length) {
    console.log("Nessun post trovato.");
    return;
  }

  const state = loadState();

  /*
   * I post vengono ordinati dal più vecchio
   * al più recente, così Discord li riceve
   * nell'ordine corretto.
   */
  const sorted = [...posts].sort(
    (a, b) =>
      Number(a.created_timestamp) -
      Number(b.created_timestamp)
  );

  /*
   * Prima esecuzione:
   * pubblichiamo solo l'ultimo post attuale,
   * evitando di mandare in Discord 100 vecchi post.
   */
  if (state.ids.length === 0) {
    const latest = sorted[sorted.length - 1];

    console.log(
      `Prima esecuzione: pubblico il post ${latest.id}`
    );

    await sendToDiscord(latest);

    saveState(sorted.map(post => post.id));

    console.log("Configurazione iniziale completata.");
    return;
  }

  const known = new Set(state.ids);

  const newPosts = sorted.filter(
    post => !known.has(post.id)
  );

  if (!newPosts.length) {
    console.log("Nessun nuovo post.");
    return;
  }

  console.log(
    `Trovati ${newPosts.length} nuovi post.`
  );

  for (const post of newPosts) {
    console.log(
      `Pubblico: ${post.id}`
    );

    await sendToDiscord(post);

    state.ids.push(post.id);

    // Piccola pausa per evitare raffiche
    await new Promise(resolve =>
      setTimeout(resolve, 1000)
    );
  }

  saveState(state.ids);

  console.log("Completato.");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
