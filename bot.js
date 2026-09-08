async function sendToDiscord(post) {
  const author = post.author || {};

  const authorName = author.name || "Anime News And Facts";
  const username = author.screen_name || "AniNewsAndFacts";
  const avatar = author.avatar_url || undefined;
  const image = getMedia(post);

  // Garantisce che il testo non sia vuoto (Discord rifiuta description "")
  const textContent = cleanText(post.text || "");
  const description = textContent.length > 0 ? truncate(textContent, 4000) : " ";

  // Normalizza la data in formato ISO 8601 per Discord
  let isoTimestamp;
  if (post.created_at) {
    isoTimestamp = new Date(post.created_at).toISOString();
  } else if (post.created_timestamp) {
    isoTimestamp = new Date(post.created_timestamp * 1000).toISOString();
  } else {
    isoTimestamp = new Date().toISOString();
  }

  // Costruisce l'URL valido del post
  const postUrl = post.url || `https://x.com/${username}/status/${post.id}`;

  const embed = {
    title: "📰 ANIME NEWS",
    url: postUrl,
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
