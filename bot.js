import fs from "node:fs";

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const STATE_FILE = "state.json";

const USERNAME = "AniNewsAndFacts";

// Il workflow gira ogni 5 minuti.
// 10 minuti lascia un piccolo margine se una run parte in ritardo.
const MAX_AGE_MS = 10 * 60 * 1000;

// Quanti tweet chiedere alla timeline.
const POST_COUNT = 20;

// ============================================================
// STATE
// ============================================================

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

      if (Array.isArray(data.ids)) {
        return data;
      }
    }
  } catch (e) {
    console.error("Errore lettura state.json:", e);
  }

  return { ids: [] };
}

function saveState(ids) {
  try {
    // Manteniamo solo gli ultimi 200 ID.
    // Non serve avere uno state.json infinito.
    const uniqueIds = [...new Set(ids)].slice(-200);

    fs.writeFileSync(STATE_FILE, JSON.stringify({ ids: uniqueIds }, null, 2));
  } catch (e) {
    console.error("Errore scrittura state.json:", e);
  }
}

// ============================================================
// UTILITY
// ============================================================

function cleanText(text) {
  if (!text) return "";

  return text.replace(/https:\/\/t\.co\/\w+/g, "").trim();
}

function truncate(text, length) {
  if (text.length <= length) {
    return text;
  }

  return text.slice(0, length - 3) + "...";
}

function getFxTwitterUrl(postUrl) {
  if (!postUrl) return null;

  return postUrl
    .replace("https://x.com/", "https://fxtwitter.com/")
    .replace("https://twitter.com/", "https://fxtwitter.com/");
}

// ============================================================
// RECUPERA POST DA FXTWITTER
// ============================================================

async function getPosts() {
  const url =
    `https://api.fxtwitter.com/2/user/${USERNAME}/tweets` +
    `?count=${POST_COUNT}`;

  try {
    console.log(`Connessione a: ${url}`);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "AnimeNewsDiscordBot/1.0",
      },
    });

    if (!response.ok) {
      console.error(
        `FxTwitter HTTP ${response.status}:`,
        await response.text()
      );

      return [];
    }

    const data = await response.json();

    if (!Array.isArray(data.results)) {
      console.log("FxTwitter non ha restituito results.");
      return [];
    }

    console.log(`FxTwitter ha restituito ${data.results.length} post.`);

    const now = Date.now();

    const posts = [];

    for (const tweet of data.results) {
      if (!tweet || !tweet.id) {
        continue;
      }

      // --------------------------------------------------------
      // DATA
      // --------------------------------------------------------

      let createdAt = tweet.created_at || null;

      let tweetTime = createdAt ? new Date(createdAt).getTime() : NaN;

      // Se created_at non è interpretabile, proviamo timestamp.
      if (
        !Number.isFinite(tweetTime) &&
        Number.isFinite(tweet.created_timestamp)
      ) {
        tweetTime = tweet.created_timestamp * 1000;
        createdAt = new Date(tweetTime).toISOString();
      }

      if (!Number.isFinite(tweetTime)) {
        console.log(`Post ${tweet.id}: data non valida, ignorato.`);

        continue;
      }

      const age = now - tweetTime;

      // --------------------------------------------------------
      // FILTRO TEMPORALE
      // --------------------------------------------------------

      if (age < 0) {
        console.log(`Post ${tweet.id}: data futura, ignorato.`);

        continue;
      }

      if (age > MAX_AGE_MS) {
        console.log(
          `Post ${tweet.id}: troppo vecchio (${Math.round(
            age / 60000
          )} min), ignorato.`
        );

        continue;
      }

      // --------------------------------------------------------
      // AUTHOR
      // --------------------------------------------------------

      const author = tweet.author || {};

      // --------------------------------------------------------
      // MEDIA
      // --------------------------------------------------------

      let media = null;
      let mediaType = null;
      let thumbnail = null;

      const allMedia = tweet.media?.all || [];

      if (Array.isArray(tweet.media?.videos) && tweet.media.videos.length) {
        const video = tweet.media.videos[0];

        media = video.url || null;
        mediaType = "video";
        thumbnail = video.thumbnail_url || null;
      } else if (
        Array.isArray(tweet.media?.photos) &&
        tweet.media.photos.length
      ) {
        const photo = tweet.media.photos[0];

        media = photo.url || null;
        mediaType = "image";
      } else if (Array.isArray(allMedia) && allMedia.length) {
        const first = allMedia[0];

        media = first.url || null;

        if (first.type === "video" || first.type === "gif") {
          mediaType = "video";
          thumbnail = first.thumbnail_url || null;
        } else {
          mediaType = "image";
        }
      }

      posts.push({
        id: String(tweet.id),

        text: tweet.text || "",

        url: tweet.url || `https://x.com/${USERNAME}/status/${tweet.id}`,

        created_at: createdAt,

        author: {
          name: author.name || "Anime News And Facts",

          screen_name: author.screen_name || USERNAME,

          avatar_url: author.avatar_url || null,
        },

        media,
        mediaType,
        thumbnail,
      });
    }

    console.log(`Post entro la finestra temporale: ${posts.length}`);

    return posts;
  } catch (err) {
    console.error("Errore durante la chiamata a FxTwitter:", err.message);

    return [];
  }
}

// ============================================================
// DISCORD
// ============================================================

async function sendToDiscord(post) {
  const author = post.author || {};

  const authorName = author.name || "Anime News And Facts";

  const username = author.screen_name || USERNAME;

  const avatar = author.avatar_url || undefined;

  const textContent = cleanText(post.text || "");

  const description = textContent.length > 0 ? truncate(textContent, 4000) : " ";

  let isoTimestamp;

  try {
    isoTimestamp = post.created_at
      ? new Date(post.created_at).toISOString()
      : new Date().toISOString();
  } catch {
    isoTimestamp = new Date().toISOString();
  }

  // ==========================================================
  // VIDEO
  // ==========================================================

  if (post.mediaType === "video") {
    const fxUrl = getFxTwitterUrl(post.url);

    const payload = {
      username: "Anime News & Facts",

      ...(avatar ? { avatar_url: avatar } : {}),

      content: fxUrl || post.url,
    };

    console.log(`Invio VIDEO tramite FxTwitter: ${fxUrl}`);

    const response = await fetch(WEBHOOK, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Discord error ${response.status}: ${await response.text()}`
      );
    }

    return;
  }

  // ==========================================================
  // IMMAGINE / TESTO
  // ==========================================================

  const embed = {
    title: "📰 ANIME NEWS",

    url: post.url,

    description,

    color: 0x5865f2,

    author: {
      name: `${authorName} (@${username})`,

      url: `https://x.com/${username}`,

      ...(avatar ? { icon_url: avatar } : {}),
    },

    footer: {
      text: "Anime News & Facts • X",
    },

    timestamp: isoTimestamp,
  };

  if (post.mediaType === "image" && post.media) {
    embed.image = {
      url: post.media,
    };
  }

  const payload = {
    username: "Anime News & Facts",

    ...(avatar ? { avatar_url: avatar } : {}),

    embeds: [embed],
  };

  const response = await fetch(WEBHOOK, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(
      `Discord error ${response.status}: ${await response.text()}`
    );
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  if (!WEBHOOK) {
    console.error("DISCORD_WEBHOOK_URL non impostata!");

    process.exit(1);
  }

  const state = loadState();

  console.log(`State: ${state.ids.length} ID salvati.`);

  const posts = await getPosts();

  if (!posts.length) {
    console.log("Nessun post recente trovato.");

    return;
  }

  // ----------------------------------------------------------
  // FILTRA QUELLI GIÀ PUBBLICATI
  // ----------------------------------------------------------

  const newPosts = posts.filter((post) => !state.ids.includes(post.id));

  if (!newPosts.length) {
    console.log("Nessun nuovo post da pubblicare.");

    return;
  }

  // ----------------------------------------------------------
  // DAL PIÙ VECCHIO AL PIÙ NUOVO
  // ----------------------------------------------------------

  const sortedPosts = [...newPosts].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  console.log(`Nuovi post da pubblicare: ${sortedPosts.length}`);

  // ----------------------------------------------------------
  // INVIO
  // ----------------------------------------------------------

  for (const post of sortedPosts) {
    console.log(
      `Pubblico ${post.id} | ${post.created_at} | ${post.mediaType || "text"}`
    );

    try {
      await sendToDiscord(post);

      state.ids.push(post.id);

      console.log(`Post ${post.id} inviato correttamente.`);
    } catch (err) {
      console.error(`Errore invio post ${post.id}:`, err.message);

      // Non lo aggiungiamo allo state se Discord fallisce.
      // Così verrà riprovato alla prossima esecuzione.
    }
  }

  saveState(state.ids);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
