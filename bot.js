const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

const USERNAME = "AniNewsAndFacts";
const TWEET_ID = "2096530470947430402";

// ============================================================
// INVIO WEBHOOK
// ============================================================

async function sendDiscord(content) {
  console.log("Invio a Discord:");
  console.log(content);

  const response = await fetch(WEBHOOK, {
    method: "POST",

    headers: {
      "Content-Type": "application/json"
    },

    body: JSON.stringify({
      username: "Anime News & Facts TEST",
      content
    })
  });

  const responseText = await response.text();

  console.log(
    `Discord risposta: HTTP ${response.status}`
  );

  if (responseText) {
    console.log(
      `Discord body: ${responseText}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Discord error ${response.status}: ${responseText}`
    );
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  if (!WEBHOOK) {
    console.error(
      "DISCORD_WEBHOOK_URL non impostata!"
    );

    process.exit(1);
  }

  console.log("========================================");
  console.log("TEST VIDEO DISCORD");
  console.log("========================================");

  // ==========================================================
  // RECUPERA IL TWEET SPECIFICO
  // ==========================================================

  const apiUrl =
    `https://api.vxtwitter.com/${USERNAME}/status/${TWEET_ID}`;

  console.log(`Recupero tweet: ${apiUrl}`);

  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `VXTwitter HTTP ${response.status}: ${errorText}`
    );
  }

  const tweet = await response.json();

  console.log("Tweet recuperato.");
  console.log(`ID: ${tweet.tweetID}`);
  console.log(`Testo: ${tweet.text}`);
  console.log(`URL: ${tweet.tweetURL}`);

  // ==========================================================
  // CERCA IL VIDEO
  // ==========================================================

  const mediaExtended =
    Array.isArray(tweet.media_extended)
      ? tweet.media_extended
      : [];

  console.log(
    `Media extended trovati: ${mediaExtended.length}`
  );

  for (const media of mediaExtended) {
    console.log(
      `MEDIA: type=${media.type} | url=${media.url}`
    );
  }

  const video = mediaExtended.find(
    (media) =>
      media &&
      media.type === "video" &&
      media.url
  );

  let videoUrl = video?.url || null;

  // ==========================================================
  // FALLBACK mediaURLs
  // ==========================================================

  if (!videoUrl && Array.isArray(tweet.mediaURLs)) {
    videoUrl = tweet.mediaURLs.find((url) => {
      const value = String(url).toLowerCase();

      return (
        value.includes(".mp4") ||
        value.includes("video.twimg.com")
      );
    }) || null;
  }

  if (!videoUrl) {
    console.error(
      "ERRORE: nessun URL video trovato."
    );

    console.log(
      JSON.stringify(tweet, null, 2)
    );

    process.exit(1);
  }

  console.log("========================================");
  console.log("VIDEO TROVATO");
  console.log(videoUrl);
  console.log("========================================");

  // ==========================================================
  // CREA URL FXTWITTER
  // ==========================================================

  const fxTwitterUrl =
    `https://fxtwitter.com/${USERNAME}/status/${TWEET_ID}`;

  // ==========================================================
  // TEST 1
  // ==========================================================
  //
  // Questo serve esclusivamente per confermare
  // che il webhook Discord riceva messaggi.
  //

  console.log("");
  console.log(">>> TEST 1: messaggio semplice");

  await sendDiscord(
    "🧪 TEST 1/3 — Webhook Discord funzionante."
  );

  console.log("TEST 1 inviato.");

  // Piccola pausa
  await new Promise(
    (resolve) => setTimeout(resolve, 1500)
  );

  // ==========================================================
  // TEST 2
  // ==========================================================
  //
  // FxTwitter dovrebbe creare automaticamente
  // l'embed del video su Discord.
  //

  console.log("");
  console.log(">>> TEST 2: FxTwitter");
  console.log(fxTwitterUrl);

  await sendDiscord(
    `🧪 TEST 2/3 — Video tramite FxTwitter\n${fxTwitterUrl}`
  );

  console.log("TEST 2 inviato.");

  await new Promise(
    (resolve) => setTimeout(resolve, 1500)
  );

  // ==========================================================
  // TEST 3
  // ==========================================================
  //
  // URL MP4 diretto ottenuto da VXTwitter.
  //

  console.log("");
  console.log(">>> TEST 3: MP4 diretto");
  console.log(videoUrl);

  await sendDiscord(
    `🧪 TEST 3/3 — MP4 diretto\n${videoUrl}`
  );

  console.log("TEST 3 inviato.");

  console.log("");
  console.log("========================================");
  console.log("TEST COMPLETATO");
  console.log("========================================");
}

main().catch((err) => {
  console.error("");
  console.error("TEST FALLITO:");
  console.error(err);

  process.exit(1);
});
