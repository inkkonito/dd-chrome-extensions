// Robust removal of any cookie named "datadome" that applies to the active tab's site.

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    return flashBadge("!");
  }

  const url = new URL(tab.url);
  const hostname = url.hostname;

  const candidates = domainCandidates(hostname);

  try {
    const all = await chrome.cookies.getAll({ name: "datadome" });
    const targetCookies = all.filter((c) =>
      candidates.some((d) => domainMatchesCookie(d, c.domain))
    );

    if (targetCookies.length === 0) {
      return flashBadge("0");
    }

    const removed = await removeCookiesFor(url.protocol, targetCookies);

    setTimeout(async () => {
      const remaining = (await chrome.cookies.getAll({ name: "datadome" }))
        .filter((c) => candidates.some((d) => domainMatchesCookie(d, c.domain)));
      if (remaining.length) {
        await removeCookiesFor(url.protocol, remaining);
      }
    }, 300);

    flashBadge(String(removed));
  } catch (e) {
    console.error("Remove DataDome Cookie error:", e);
    flashBadge("!");
  }
});

function domainCandidates(hostname) {
  const parts = hostname.split(".");
  const cands = new Set([hostname]);
  if (parts.length >= 2) {
    cands.add(parts.slice(-2).join("."));
  }
  if (parts.length >= 3) {
    cands.add(parts.slice(-3).join("."));
  }
  return Array.from(cands);
}

function domainMatchesCookie(candidateHost, cookieDomain) {
  const cd = (cookieDomain || "").replace(/^\./, "").toLowerCase();
  const ch = candidateHost.toLowerCase();
  return cd === ch || ch.endsWith(`.${cd}`) || cd.endsWith(`.${ch}`);
}

async function removeCookiesFor(protocol, cookies) {
  let count = 0;
  const removals = cookies.map((c) => {
    const scheme = c.secure ? "https" : (protocol.replace(":", "") || "https");
    const host = (c.domain || "").replace(/^\./, "");
    const removalUrl = `${scheme}://${host}${c.path || "/"}`;
    const details = { url: removalUrl, name: c.name };
    if (c.storeId) details.storeId = c.storeId;
    if (c.partitionKey) details.partitionKey = c.partitionKey;
    return chrome.cookies.remove(details)
      .then((res) => { if (res && res.name === c.name) count++; })
      .catch((err) => console.debug("Failed to remove", details, err));
  });
  await Promise.allSettled(removals);
  return count;
}

function flashBadge(text) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: "#444" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1500);
}
