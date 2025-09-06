// background.js - Remove only the active site's 'datadome' cookie.
// - Never removes cookies for *.datadome.co unless the active tab is on datadome.co
// - Shows a badge with the number of cookies removed
// - Logs removals and posts a message to the page console for immediate feedback

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab || !tab.url || !/^https?:\/\//i.test(tab.url)) {
      return flashBadge("!");
    }

    const url = new URL(tab.url);
    const hostname = url.hostname;

    const candidates = domainCandidates(hostname);
    const hostIsDataDomeCo = candidates.some((d) => /\.?datadome\.co$/i.test(d));

    const all = await chrome.cookies.getAll({ name: "datadome" });

    // Filter to cookies that apply to the active site's host/superdomains
    const targetCookies = all.filter((c) => {
      const isForActiveSite = candidates.some((d) => domainMatchesCookie(d, c.domain));
      if (!isForActiveSite) return false;

      // Do NOT remove *.datadome.co cookies unless the active tab is on datadome.co
      const isDataDomeCoCookie = /\.?datadome\.co$/i.test((c.domain || "").replace(/^\./, ""));
      if (isDataDomeCoCookie && !hostIsDataDomeCo) return false;

      return true;
    });

    if (targetCookies.length === 0) {
      flashBadge("0");
      await safePageConsole(tab.id, "No matching 'datadome' cookies found for this site.");
      return;
    }

    const removed = await removeCookiesFor(url.protocol, targetCookies);

    // Retry once to catch race conditions / parallel set
    setTimeout(async () => {
      try {
        const remaining = (await chrome.cookies.getAll({ name: "datadome" })).filter((c) => {
          const isForActiveSite = candidates.some((d) => domainMatchesCookie(d, c.domain));
          if (!isForActiveSite) return false;
          const isDataDomeCoCookie = /\.?datadome\.co$/i.test((c.domain || "").replace(/^\./, ""));
          if (isDataDomeCoCookie && !hostIsDataDomeCo) return false;
          return true;
        });
        if (remaining.length) {
          const again = await removeCookiesFor(url.protocol, remaining);
          if (again) {
            await safePageConsole(tab.id, `Removed ${again} additional 'datadome' cookie(s) on retry.`);
          }
        }
      } catch (_) { /* ignore */ }
    }, 300);

    flashBadge(String(removed));
    await safePageConsole(
      tab.id,
      `Removed ${removed} 'datadome' cookie(s). Tip: DevTools → Application → Storage → Cookies needs a manual refresh to reflect changes.`
    );
  } catch (e) {
    console.error("Remove DataDome Cookie error:", e);
    flashBadge("!");
  }
});

// Background visibility for removals.
chrome.cookies.onChanged.addListener((info) => {
  if (info.removed && info.cookie?.name === "datadome") {
    console.log("[Remove DataDome Cookie] Removed:", {
      domain: info.cookie.domain,
      path: info.cookie.path,
      storeId: info.cookie.storeId,
      partitionKey: info.cookie.partitionKey || null,
      hostOnly: info.cookie.hostOnly || false,
      secure: info.cookie.secure || false,
      httpOnly: info.cookie.httpOnly || false,
      sameSite: info.cookie.sameSite || "unspecified"
    });
  }
});

function domainCandidates(hostname) {
  const parts = hostname.split(".");
  const cands = new Set([hostname]);
  if (parts.length >= 2) cands.add(parts.slice(-2).join("."));
  if (parts.length >= 3) cands.add(parts.slice(-3).join("."));
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

async function safePageConsole(tabId, message) {
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [message],
      func: (msg) => console.log(`[Remove DataDome Cookie] ${msg}`)
    });
  } catch (_) {
    // Tab might be restricted (chrome://, Chrome Web Store); ignore.
  }
}
